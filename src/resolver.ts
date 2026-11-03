import { expandAliases, hasAny, MEASURE_TERMS, normalize, queryTokens } from './aliases.js';
import { catalogCode } from './catalog-codes.js';
import { type CuratedEntry, cleanQuery, findCurated } from './curated.js';
import { invalidArgument, NbsError, notFound } from './errors.js';
import type { NbsProvider } from './provider.js';
import { type RegionRecord, scopeOf } from './regions.js';
import type {
  IndicatorCandidate,
  IndicatorRecord,
  Period,
  QueryOptions,
  ResolvedIndicator,
  SearchRecord,
  Shard,
  TreeRecord,
} from './types.js';

const PERIOD_CODE: Record<Period, string> = {
  year: '3',
  quarter: '2',
  month: '1',
};

const SUGGESTIONS = [
  'GDP',
  'CPI',
  'PPI',
  '人口',
  '社会消费品零售总额',
  '固定资产投资',
  '城镇调查失业率',
  '居民人均可支配收入',
];

/** Short words that distinguish otherwise similar indicators. */
const QUALIFIER_TERMS = [
  '城镇',
  '农村',
  '夏收',
  '秋收',
  '税收',
  '支出',
  '收入',
  '利润',
  '营业收入',
  '总产量',
  '销售额',
  '销售面积',
  '房地产',
  '进口',
  '出口',
  '国有',
  '民间',
  '新建',
  '扩建',
  '改建',
  '住宅',
];

export type ResolveOutcome =
  | { kind: 'resolved'; indicator: ResolvedIndicator }
  | { kind: 'ambiguous'; candidates: IndicatorCandidate[] }
  | { kind: 'notFound'; suggestions: string[] };

function rawNormalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,，.。;；:：、!?！？"'“”‘’\-_/\\|]/g, '')
    .trim();
}

function containsTerm(text: string, term: string): boolean {
  return rawNormalize(text).includes(rawNormalize(term));
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => containsTerm(text, term));
}

function periodCode(period: Period): string {
  return PERIOD_CODE[period];
}

function displayNameFor(record: SearchRecord): string {
  return record.showName.trim() || record.name || '';
}

function measureFor(record: SearchRecord): string | undefined {
  const text = record.showName;
  const measures = [
    '累计值',
    '当季值',
    '当月值',
    '上年同月=100',
    '上年同期=100',
    '上年=100',
    '不变价',
    '现价',
    '贡献率',
    '拉动',
    '人均',
    '环比',
    '同比',
    '指数',
    '构成',
  ];
  const found = measures.filter((measure) => text.includes(measure));
  return found.length > 0 ? found.join(' / ') : undefined;
}

function toCandidate(record: SearchRecord, score: number, reasons: string[]): IndicatorCandidate {
  return {
    id: `${record.cid}:${record.indicId}`,
    name: record.name ?? record.showName,
    displayName: displayNameFor(record),
    unit: record.unit,
    frequency: record.frequency,
    region: record.region,
    measure: measureFor(record),
    score,
    reasons,
  };
}

function toResolved(record: SearchRecord, source: ResolvedIndicator['source']): ResolvedIndicator {
  return {
    cid: record.cid,
    indicId: record.indicId,
    name: record.name ?? record.showName,
    displayName: displayNameFor(record),
    unit: record.unit,
    frequency: record.frequency ?? 'year',
    region: record.region,
    regionCode: record.regionCode,
    measure: measureFor(record),
    source,
  };
}

function fromCurated(entry: CuratedEntry, region: RegionRecord): ResolvedIndicator {
  return {
    cid: entry.cid,
    indicId: entry.indicId,
    name: entry.name,
    displayName: entry.displayName,
    unit: entry.unit,
    frequency: entry.frequency,
    region: region.text,
    regionCode: region.value,
    measure: entry.measure,
    note: entry.note,
    shards: entry.shards,
    source: 'curated',
  };
}

function latestFirst(a: SearchRecord, b: SearchRecord): SearchRecord {
  if (a.dt !== b.dt) return a.dt > b.dt ? a : b;
  if (a.name && !b.name) return a;
  if (b.name && !a.name) return b;
  return a;
}

function dedupeRecords(records: SearchRecord[]): SearchRecord[] {
  const map = new Map<string, SearchRecord>();
  for (const record of records) {
    const key = `${record.cid}:${record.indicId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...record });
      continue;
    }
    const latest = latestFirst(existing, record);
    map.set(key, {
      ...latest,
      name: latest.name ?? existing.name ?? record.name,
      unit: latest.unit ?? existing.unit ?? record.unit,
      frequency: latest.frequency ?? existing.frequency ?? record.frequency,
    });
  }
  return [...map.values()];
}

function scoreRecord(
  record: SearchRecord,
  query: string,
  period: Period,
  region: RegionRecord,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const text = `${record.name ?? ''} ${record.showName}`;
  const normalizedName = normalize(record.name ?? '');
  const normalizedShow = normalize(record.showName);
  const cleaned = cleanQuery(query);
  const fullQuery = canonicalName(cleaned);
  const aliases = expandAliases(cleaned).map(canonicalName).filter(Boolean);
  const tokens = queryTokens(cleaned);

  let exact = false;
  let contains = false;
  if (fullQuery) {
    if (normalizedName === fullQuery || normalizedShow === fullQuery) exact = true;
    else if (normalizedName.includes(fullQuery) || normalizedShow.includes(fullQuery))
      contains = true;
    else if (fullQuery.includes(normalizedName) && normalizedName.length >= 2) contains = true;
  }
  for (const alias of aliases) {
    if (!alias || alias === fullQuery) continue;
    // A shorter alias contained in the full query (e.g. 粮食产量 inside
    // 夏收粮食产量) must not make a less specific indicator look exact.
    if (fullQuery.includes(alias)) continue;
    if (normalizedName === alias || normalizedShow === alias) exact = true;
    else if (normalizedName.includes(alias) || normalizedShow.includes(alias)) contains = true;
  }
  if (exact) {
    score += 50;
    reasons.push('名称完全匹配 +50');
    if (normalizedShow === fullQuery) {
      score += 10;
      reasons.push('展示名完全匹配 +10');
    }
  } else if (contains) {
    score += 25;
    reasons.push('名称包含关键词 +25');
  } else if (normalizedName && fullQuery.includes(normalizedName)) {
    score += 15;
    reasons.push('名称被查询包含 +15');
  }

  const tokenHits = tokens.filter(
    (token) => normalizedName.includes(token) || normalizedShow.includes(token),
  );
  if (tokenHits.length > 0) {
    score += tokenHits.length * 6;
    reasons.push(`关键词命中 ${tokenHits.length} 个 +${tokenHits.length * 6}`);
  }
  if (tokens.length > 0 && tokenHits.length === tokens.length) {
    score += 12;
    reasons.push('全部关键词命中 +12');
  }

  if (!record.name) {
    score -= 5;
    reasons.push('缺少指标名 -5');
  }

  if (record.frequency === period) {
    score += 30;
    reasons.push('频率匹配 +30');
  } else {
    score -= 40;
    reasons.push('频率不匹配 -40');
  }
  if (record.typeValue === periodCode(period)) {
    score += 10;
    reasons.push('数据类型匹配 +10');
  }

  if (region.national) {
    if (record.region.includes('全国')) {
      score += 30;
      reasons.push('地区匹配 +30');
    } else {
      score -= 25;
      reasons.push('地区不匹配 -25');
    }
  } else {
    const short = region.text.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|藏族|蒙古)/g, '');
    if (record.region.includes(region.text) || record.region.includes(short)) {
      score += 30;
      reasons.push('地区匹配 +30');
    } else if (record.region.includes('全国')) {
      score -= 20;
      reasons.push('全国数据与分省查询不匹配 -20');
    }
  }

  const unit = record.unit ?? '';
  const qGrowth = hasAny(query, MEASURE_TERMS.growth);
  const qIndex = hasAny(query, MEASURE_TERMS.index);
  const qPerCapita = hasAny(query, MEASURE_TERMS.perCapita);
  const qContribution = hasAny(query, MEASURE_TERMS.contribution);
  const qCumulative = hasAny(query, MEASURE_TERMS.cumulative);
  const qCurrent = hasAny(query, MEASURE_TERMS.current);
  const qConstant = hasAny(query, MEASURE_TERMS.constantPrice);
  const isPriceIndex = /价格|CPI|物价|指数/i.test(query) || /价格/.test(text);

  if (qGrowth) {
    if (/%|=100/.test(`${unit} ${text}`) || containsAny(text, ['增长', '增速'])) {
      score += 20;
      reasons.push('增速口径 +20');
    }
    if (/亿元|万元/.test(unit)) {
      score -= 15;
      reasons.push('总量单位与增速不符 -15');
    }
  }
  if (qIndex) {
    if (/=100/.test(`${unit} ${text}`) || containsTerm(text, '指数')) {
      score += 20;
      reasons.push('指数口径 +20');
    }
    if (/亿元|万元/.test(unit)) {
      score -= 10;
      reasons.push('总量单位与指数不符 -10');
    }
    if (!containsTerm(text, '指数') && !/=100/.test(`${unit} ${text}`)) {
      score -= 25;
      reasons.push('名称不含指数 -25');
    }
  }
  if (qPerCapita) {
    if (containsTerm(text, '人均')) {
      score += 30;
      reasons.push('人均口径 +30');
    } else {
      score -= 15;
      reasons.push('非人均口径 -15');
    }
  }
  if (qContribution) {
    if (containsAny(text, MEASURE_TERMS.contribution)) {
      score += 25;
      reasons.push('贡献率口径 +25');
    } else {
      score -= 15;
      reasons.push('非贡献率口径 -15');
    }
  }
  if (qCumulative) {
    if (containsTerm(text, '累计')) {
      score += 20;
      reasons.push('累计口径 +20');
    }
    if (containsTerm(text, '当季') || containsTerm(text, '当月')) {
      score -= 10;
      reasons.push('当季口径与累计不符 -10');
    }
  }
  if (qCurrent) {
    if (containsAny(text, ['当季', '当月'])) {
      score += 20;
      reasons.push('当季/当月口径 +20');
    }
    if (containsTerm(text, '累计')) {
      score -= 10;
      reasons.push('累计口径与当季不符 -10');
    }
  }
  if (qConstant) {
    if (containsTerm(text, '不变价')) {
      score += 25;
      reasons.push('不变价口径 +25');
    }
  }

  const noMeasure =
    !qGrowth && !qIndex && !qPerCapita && !qContribution && !qCumulative && !qCurrent && !qConstant;
  if (noMeasure) {
    if (isPriceIndex) {
      if (/=100/.test(`${unit} ${text}`)) {
        score += 15;
        reasons.push('价格指数默认同比口径 +15');
      }
      if (unit === '%') {
        score -= 5;
        reasons.push('价格指数默认不选百分比 -5');
      }
    } else {
      if (/亿元|万元|元|万吨|万人|亿人/.test(unit)) {
        score += 15;
        reasons.push('默认总量单位 +15');
      }
      if (unit === '%') {
        score -= 10;
        reasons.push('默认不选百分比 -10');
      }
      if (unit.includes('=100')) {
        score -= 5;
        reasons.push('默认不选定基指数 -5');
      }
    }
  }

  if (!qContribution && containsAny(text, MEASURE_TERMS.contribution)) {
    score -= 25;
    reasons.push('未询问贡献率/拉动/构成 -25');
  }
  if (!qIndex && containsTerm(text, '指数')) {
    score -= 15;
    reasons.push('未询问指数 -15');
  }
  if (!qPerCapita && containsTerm(text, '人均')) {
    score -= 25;
    reasons.push('未询问人均 -25');
  }
  if (!qConstant && containsTerm(text, '不变价')) {
    score -= 20;
    reasons.push('未询问不变价 -20');
  }
  if (!qGrowth && containsAny(text, ['增长率', '增长速度'])) {
    score -= 10;
    reasons.push('未询问增速 -10');
  }
  const asksGrowth = qGrowth || /增长|增速|同比|环比/.test(cleaned);
  if (!asksGrowth && containsTerm(text, '增长')) {
    score -= 15;
    reasons.push('未询问增长 -15');
  }
  if (!cleaned.includes('单位面积') && containsTerm(text, '单位面积')) {
    score -= 20;
    reasons.push('未询问单位面积 -20');
  }
  for (const component of ['工资性', '经营净', '财产净', '转移净', '中位数']) {
    if (!cleaned.includes(component) && containsTerm(text, component)) {
      score -= 15;
      reasons.push(`未询问${component}收入 -15`);
    }
  }
  if (!qCumulative && containsTerm(text, '累计')) {
    score -= 5;
    reasons.push('未询问累计 -5');
  }
  if (!qCurrent && containsAny(text, ['当季', '当月'])) {
    score -= 5;
    reasons.push('未询问当季/当月 -5');
  }
  if (containsTerm(text, '环比')) {
    score -= 10;
    reasons.push('环比口径降权 -10');
  }
  if (!query.includes('支出法') && containsTerm(text, '支出法')) {
    score -= 15;
    reasons.push('未询问支出法 -15');
  }
  if (!query.includes('民族自治') && containsTerm(text, '民族自治')) {
    score -= 20;
    reasons.push('未询问民族自治地方 -20');
  }
  if (!query.includes('定基') && /1978年?=100|1985年?=100/.test(`${unit} ${text}`)) {
    score -= 20;
    reasons.push('非定基查询降权 -20');
  }
  if (!query.includes('抽样') && containsTerm(text, '抽样调查')) {
    score -= 15;
    reasons.push('未询问抽样调查 -15');
  }
  if (!query.includes('男') && containsTerm(text, '男性')) {
    score -= 10;
    reasons.push('未询问男性人口 -10');
  }
  if (!query.includes('女') && containsTerm(text, '女性')) {
    score -= 10;
    reasons.push('未询问女性人口 -10');
  }
  if (!query.includes('城镇') && containsTerm(text, '城镇人口')) {
    score -= 10;
    reasons.push('未询问城镇人口 -10');
  }
  if (!query.includes('乡村') && containsTerm(text, '乡村人口')) {
    score -= 10;
    reasons.push('未询问乡村人口 -10');
  }

  // Discriminate similar indicators by qualifier words. This is deliberately
  // light-weight: it should break ties, not override a clear name match.
  for (const term of QUALIFIER_TERMS) {
    const inQuery = containsTerm(query, term);
    const inText = containsTerm(text, term);
    if (inQuery && inText) {
      score += 12;
      reasons.push(`限定词 ${term} +12`);
    } else if (inQuery && !inText) {
      score -= 10;
      reasons.push(`缺少限定词 ${term} -10`);
    }
  }

  if (record.dt) {
    score += 5;
    reasons.push('有最新数据 +5');
  }

  return { score, reasons };
}

function decide(
  scored: Array<{ record: SearchRecord; score: number; reasons: string[] }>,
  source: ResolvedIndicator['source'] = 'search',
): ResolveOutcome {
  if (scored.length === 0) return { kind: 'notFound', suggestions: SUGGESTIONS };
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top) return { kind: 'notFound', suggestions: SUGGESTIONS };
  const second = sorted[1];
  const gap = second ? top.score - second.score : Number.POSITIVE_INFINITY;

  const confident =
    (top.score >= 80 && gap >= 10) ||
    (top.score >= 60 && gap >= 20) ||
    (top.score >= 45 && !second);

  if (confident) {
    return { kind: 'resolved', indicator: toResolved(top.record, source) };
  }

  if (top.score >= 30) {
    return {
      kind: 'ambiguous',
      candidates: sorted
        .slice(0, 3)
        .map((item) => toCandidate(item.record, item.score, item.reasons)),
    };
  }

  return { kind: 'notFound', suggestions: SUGGESTIONS };
}

async function resolveFromSearch(
  provider: NbsProvider,
  query: string,
  period: Period,
  region: RegionRecord,
  options: QueryOptions,
): Promise<ResolveOutcome> {
  const result = await provider.search({
    keyword: query,
    period,
    pageSize: 50,
    signal: options.signal,
    noCache: options.noCache,
  });

  const records = dedupeRecords(result.records);
  const scored = records
    .map((record) => {
      const { score, reasons } = scoreRecord(record, query, period, region);
      return { record, score, reasons };
    })
    .filter((item) => item.score > 0);

  return decide(scored);
}

function categoryHints(query: string): string[] {
  const text = normalize(query);
  const hints: string[] = [];
  if (/gdp|国内生产总值|地区生产总值|经济总量|生产总值/.test(text)) {
    hints.push('国民经济核算', '综合');
  }
  if (/cpi|消费价格|物价|ppi|生产者价格/.test(text)) hints.push('价格指数');
  if (/人口|常住人口/.test(text)) hints.push('人口');
  if (/社零|社会消费品|零售/.test(text)) hints.push('国内贸易', '社会消费品零售总额');
  if (/固投|固定资产投资|房地产/.test(text)) hints.push('固定资产投资', '房地产');
  if (/失业/.test(text)) hints.push('就业', '城镇调查失业率');
  if (/收入/.test(text)) hints.push('人民生活');
  if (/工业|增加值/.test(text)) hints.push('工业');
  if (/粮食|农业|农林牧渔/.test(text)) hints.push('农业');
  if (/进出口|外贸|贸易/.test(text)) hints.push('对外经济贸易', '国内贸易');
  if (/财政|预算/.test(text)) hints.push('财政');
  if (/建筑业/.test(text)) hints.push('建筑业');
  return [...new Set(hints)];
}

/** Normalize a tree node name so "居民消费价格分类指数" matches "居民消费价格指数". */
function canonicalName(text: string): string {
  return normalize(text).replace(/分类/g, '');
}

function treeNameMatches(name: string, query: string): boolean {
  const cleaned = cleanQuery(query);
  const normalizedName = canonicalName(name);
  if (!normalizedName) return false;
  const aliases = expandAliases(cleaned).map(canonicalName).filter(Boolean);
  if (aliases.some((alias) => normalizedName.includes(alias) || alias.includes(normalizedName))) {
    return true;
  }
  return queryTokens(cleaned).some((token) => normalizedName.includes(token));
}

/** Approximate name affinity using overlapping 2-grams, used to rank leaves. */
function nameAffinity(name: string, query: string): number {
  const node = canonicalName(name);
  const target = canonicalName(query);
  if (!node || !target) return 0;
  let score = 0;
  for (let index = 0; index < target.length - 1; index += 1) {
    const gram = target.slice(index, index + 2);
    if (node.includes(gram)) score += 1;
  }
  return score;
}

function treeRecord(
  indicator: IndicatorRecord,
  leaf: TreeRecord,
  period: Period,
  region: RegionRecord,
): SearchRecord {
  return {
    cid: indicator.cid,
    indicId: indicator.id,
    name: indicator.name,
    showName: indicator.showName,
    unit: indicator.unit,
    frequency: period,
    dt: '',
    dtName: '',
    region: region.text,
    regionCode: region.value,
    value: '',
    typeValue: periodCode(period),
    treePath: leaf.id,
  };
}

/** Matches a trailing range in a catalog leaf, e.g. "(2021-)", "(2016-2020)", "(-2015)". */
const SHARD_LABEL_RE = /\s*[（(]\s*(\d{4})?\s*[-–—至]\s*(\d{4})?\s*[）)]\s*$/;

export interface ParsedShardLabel {
  base: string;
  startYear?: number;
  endYear?: number;
}

export function parseShardLabel(name: string): ParsedShardLabel | undefined {
  const match = SHARD_LABEL_RE.exec(name);
  if (!match) return undefined;
  const startYear = match[1] ? Number(match[1]) : undefined;
  const endYear = match[2] ? Number(match[2]) : undefined;
  if (startYear === undefined && endYear === undefined) return undefined;
  const base = name.slice(0, match.index).trim();
  if (!base) return undefined;
  return {
    base,
    ...(startYear === undefined ? {} : { startYear }),
    ...(endYear === undefined ? {} : { endYear }),
  };
}

function shardComparable(text: string): string {
  return normalize(text.replace(SHARD_LABEL_RE, ''));
}

function isLaterShard(a: ParsedShardLabel, b: ParsedShardLabel): boolean {
  const aEnd = a.endYear ?? Number.POSITIVE_INFINITY;
  const bEnd = b.endYear ?? Number.POSITIVE_INFINITY;
  if (aEnd !== bEnd) return aEnd > bEnd;
  const aStart = a.startYear ?? Number.NEGATIVE_INFINITY;
  const bStart = b.startYear ?? Number.NEGATIVE_INFINITY;
  return aStart > bStart;
}

/**
 * Discover sibling catalog leaves that represent earlier/later ranges of the
 * same series. The upstream API models long series as separate cids whose leaf
 * names carry a range suffix; without this, a query silently returns only the
 * current shard.
 */
async function discoverShards(
  provider: NbsProvider,
  leaf: TreeRecord,
  record: SearchRecord,
  code: string,
  resolved: ResolvedIndicator,
  options: QueryOptions,
): Promise<Shard[] | undefined> {
  const parsed = parseShardLabel(leaf.name);
  if (!parsed || !leaf.parentId) return undefined;

  const siblings = await provider.getTree({
    pid: leaf.parentId,
    code,
    signal: options.signal,
    noCache: options.noCache,
  });
  const shardLeaves = siblings
    .map((node) => ({ node, range: parseShardLabel(node.name) }))
    .filter(
      (item): item is { node: TreeRecord; range: ParsedShardLabel } =>
        item.node.isLeaf && item.range !== undefined && item.range.base === parsed.base,
    )
    .sort((a, b) => (a.range.startYear ?? -Infinity) - (b.range.startYear ?? -Infinity));

  if (shardLeaves.length < 2) return undefined;

  const targetShow = shardComparable(record.showName);
  const targetName = shardComparable(record.name ?? '');
  const shards: Shard[] = [];
  for (const item of shardLeaves.slice(0, 8)) {
    const indicators = await provider.getIndicators({
      cid: item.node.id,
      signal: options.signal,
      noCache: options.noCache,
    });
    const match =
      indicators.find((indicator) => shardComparable(indicator.showName) === targetShow) ??
      (targetName
        ? indicators.find((indicator) => shardComparable(indicator.name) === targetName)
        : undefined);
    if (!match) continue;
    shards.push({
      cid: item.node.id,
      indicId: match.id,
      ...(item.range.startYear === undefined ? {} : { startYear: item.range.startYear }),
      ...(item.range.endYear === undefined ? {} : { endYear: item.range.endYear }),
      label: item.node.name,
    });
  }

  if (shards.length < 2) return undefined;
  if (!shards.some((shard) => shard.cid === resolved.cid && shard.indicId === resolved.indicId)) {
    shards.push({
      cid: resolved.cid,
      indicId: resolved.indicId,
      ...(parsed.startYear === undefined ? {} : { startYear: parsed.startYear }),
      ...(parsed.endYear === undefined ? {} : { endYear: parsed.endYear }),
      label: leaf.name,
    });
  }
  return shards.sort((a, b) => (a.startYear ?? -Infinity) - (b.startYear ?? -Infinity));
}

// Short-lived negative cache for NOT_FOUND only. Ambiguous results are not
// cached because candidate sets can change when upstream adds indicators.
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_MAX_ENTRIES = 200;
const negativeCache = new Map<string, { expiresAt: number; outcome: ResolveOutcome }>();

function negativeKey(query: string, period: Period, scope: string): string {
  return `${normalize(cleanQuery(query))}|${period}|${scope}`;
}

function readNegative(key: string): ResolveOutcome | undefined {
  const entry = negativeCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    negativeCache.delete(key);
    return undefined;
  }
  return entry.outcome;
}

function writeNegative(key: string, outcome: ResolveOutcome): void {
  negativeCache.delete(key);
  negativeCache.set(key, { expiresAt: Date.now() + NEGATIVE_TTL_MS, outcome });
  while (negativeCache.size > NEGATIVE_MAX_ENTRIES) {
    const oldest = negativeCache.keys().next().value;
    if (oldest === undefined) break;
    negativeCache.delete(oldest);
  }
}

/** Clear the resolver's NOT_FOUND cache (mainly for tests). */
export function clearResolverNegativeCache(): void {
  negativeCache.clear();
}

async function resolveFromTree(
  provider: NbsProvider,
  query: string,
  period: Period,
  region: RegionRecord,
  options: QueryOptions,
): Promise<ResolveOutcome> {
  const code = catalogCode(scopeOf(region), period);
  if (!code) {
    throw new NbsError('UNSUPPORTED_ACTION', '该地区/频率组合暂未支持', {
      retryable: false,
      hint: '主要城市目前只有年度数据（code=8）；月度 code=7 是 36/70 城市汇总价格指数，不是单城市数据。',
    });
  }
  const hints = categoryHints(query);
  const queue: Array<{ pid: string; depth: number; hinted: boolean }> = [
    { pid: '', depth: 0, hinted: false },
  ];
  const leaves: Array<{ node: TreeRecord; affinity: number }> = [];
  let treeRequests = 0;

  while (queue.length > 0 && treeRequests < 12 && leaves.length < 40) {
    const current = queue.shift();
    if (!current || current.depth > 4) continue;
    const nodes = await provider.getTree({
      pid: current.pid,
      code,
      signal: options.signal,
      noCache: options.noCache,
    });
    treeRequests += 1;

    for (const node of nodes) {
      const matches = treeNameMatches(node.name, query);
      const hinted = hints.some((hint) => node.name.includes(hint));
      const rootLevel = current.pid === '';
      const branchHinted = current.hinted || hinted;
      if (node.isLeaf && (matches || branchHinted)) {
        leaves.push({ node, affinity: nameAffinity(node.name, query) });
      } else if (
        !node.isLeaf &&
        (matches || hinted || rootLevel || current.hinted) &&
        current.depth < 4
      ) {
        queue.push({ pid: node.id, depth: current.depth + 1, hinted: branchHinted });
      }
    }
  }

  const scored: Array<{ record: SearchRecord; score: number; reasons: string[] }> = [];
  const leafByKey = new Map<string, TreeRecord>();
  const recordByKey = new Map<string, SearchRecord>();
  const shardGroups = new Map<
    string,
    {
      leaf: TreeRecord;
      record: SearchRecord;
      score: number;
      reasons: string[];
      range: ParsedShardLabel;
    }
  >();
  const selected = [...leaves]
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 5)
    .map((item) => item.node);
  for (const leaf of selected) {
    const indicators = await provider.getIndicators({
      cid: leaf.id,
      signal: options.signal,
      noCache: options.noCache,
    });
    const range = parseShardLabel(leaf.name);
    for (const indicator of indicators) {
      const record = treeRecord(indicator, leaf, period, region);
      const { score, reasons } = scoreRecord(record, query, period, region);
      if (!range) {
        scored.push({ record, score, reasons });
        leafByKey.set(`${record.cid}:${record.indicId}`, leaf);
        recordByKey.set(`${record.cid}:${record.indicId}`, record);
        continue;
      }
      // The same long series appears as several sibling leaves, one per year
      // range. Keep the latest range as the representative, then attach all
      // ranges as shards after resolution.
      const groupKey = `${range.base}|${shardComparable(record.showName)}|${record.unit ?? ''}`;
      const existing = shardGroups.get(groupKey);
      if (!existing || isLaterShard(range, existing.range)) {
        shardGroups.set(groupKey, { leaf, record, score, reasons, range });
      }
    }
  }
  for (const group of shardGroups.values()) {
    scored.push({ record: group.record, score: group.score, reasons: group.reasons });
    leafByKey.set(`${group.record.cid}:${group.record.indicId}`, group.leaf);
    recordByKey.set(`${group.record.cid}:${group.record.indicId}`, group.record);
  }

  if (scored.length === 0) return { kind: 'notFound', suggestions: SUGGESTIONS };
  const outcome = decide(scored, 'tree');
  if (outcome.kind === 'resolved') {
    const key = `${outcome.indicator.cid}:${outcome.indicator.indicId}`;
    const leaf = leafByKey.get(key);
    const record = recordByKey.get(key);
    if (leaf && record) {
      try {
        const shards = await discoverShards(
          provider,
          leaf,
          record,
          code,
          outcome.indicator,
          options,
        );
        if (shards) outcome.indicator.shards = shards;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // Shard discovery is best-effort; keep the primary shard on failure.
      }
    }
  }
  return outcome;
}

function parseSelection(indicatorId: string): { cid: string; indicId: string } | undefined {
  const [cid, indicId] = indicatorId.split(':');
  if (!cid || !indicId) return undefined;
  return { cid, indicId };
}

async function resolveSelection(
  provider: NbsProvider,
  indicatorId: string,
  period: Period,
  region: RegionRecord,
  options: QueryOptions,
): Promise<ResolveOutcome> {
  const parsed = parseSelection(indicatorId);
  if (!parsed) {
    throw notFound(
      'indicatorId 格式不正确',
      '请使用 QueryResult.candidates[].id，格式为 cid:indicId。',
    );
  }
  const indicators = await provider.getIndicators({
    cid: parsed.cid,
    signal: options.signal,
    noCache: options.noCache,
  });
  const found = indicators.find((indicator) => indicator.id === parsed.indicId);
  if (!found) {
    throw notFound('找不到指定的指标', '候选可能已过期；请重新搜索并选择新的 candidate id。');
  }
  return {
    kind: 'resolved',
    indicator: {
      cid: found.cid,
      indicId: found.id,
      name: found.name,
      displayName: found.showName,
      unit: found.unit,
      frequency: period,
      region: region.text,
      regionCode: region.value,
      measure: found.measure,
      source: 'selection',
    },
  };
}

/** Infer the data frequency from explicit period, start/end formats, or query words. */
export function inferPeriod(options: QueryOptions): Period {
  if (options.period) return options.period;
  const text = `${options.start ?? ''} ${options.end ?? ''} ${options.query ?? ''}`;
  if (/\d{4}\s*-\s*\d{1,2}/.test(text) || /月|月度|MM/.test(text)) return 'month';
  if (/\d{4}\s*Q[1-4]/i.test(text) || /\d{4}\s*SS/.test(text) || /季度|季/.test(text)) {
    return 'quarter';
  }
  return 'year';
}

/** Resolve a keyword to a concrete cid + indicator id. */
export async function resolveIndicator(
  provider: NbsProvider,
  options: QueryOptions,
  period: Period,
  region: RegionRecord,
): Promise<ResolveOutcome> {
  const query = options.query?.trim();
  if (options.indicatorId) {
    return resolveSelection(provider, options.indicatorId, period, region, options);
  }
  if (!query) {
    throw invalidArgument('缺少 query 参数', '示例：query({ query: "GDP", action: "series" })');
  }

  const scope = scopeOf(region);
  if (scope === 'city' && period !== 'year') {
    throw new NbsError('UNSUPPORTED_ACTION', '主要城市月度/季度数据暂未支持', {
      retryable: false,
      hint: '主要城市目前只有年度数据（code=8）；月度 code=7 是 36/70 城市汇总价格指数，不是单城市数据。',
    });
  }

  const curatedScope =
    scope === 'national' ? 'national' : scope === 'province' ? 'province' : 'city';
  const curated = findCurated(query, period, curatedScope);
  if (curated) {
    return { kind: 'resolved', indicator: fromCurated(curated, region) };
  }

  const key = negativeKey(query, period, scope);
  const cachedNegative = readNegative(key);
  if (cachedNegative) return cachedNegative;

  if (scope !== 'national') {
    const treeOutcome = await resolveFromTree(provider, query, period, region, options);
    if (treeOutcome.kind !== 'notFound') return treeOutcome;
    const outcome: ResolveOutcome = { kind: 'notFound', suggestions: SUGGESTIONS };
    writeNegative(key, outcome);
    return outcome;
  }

  const searchOutcome = await resolveFromSearch(provider, query, period, region, options);
  if (searchOutcome.kind === 'resolved') return searchOutcome;

  const hints = categoryHints(query);
  if (searchOutcome.kind === 'notFound' || hints.length > 0) {
    const treeOutcome = await resolveFromTree(provider, query, period, region, options);
    if (treeOutcome.kind === 'resolved') return treeOutcome;
    if (treeOutcome.kind === 'ambiguous') return treeOutcome;
  }

  if (searchOutcome.kind !== 'notFound') return searchOutcome;
  const outcome: ResolveOutcome = { kind: 'notFound', suggestions: SUGGESTIONS };
  writeNegative(key, outcome);
  return outcome;
}
