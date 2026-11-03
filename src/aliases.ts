/** Common Chinese abbreviations used by qbot users and analysts. */
export const ALIASES: Record<string, string[]> = {
  gdp: ['国内生产总值', '地区生产总值', '经济总量'],
  cpi: ['居民消费价格指数', '消费价格指数'],
  ppi: ['工业生产者出厂价格指数', '生产者价格指数'],
  社零: ['社会消费品零售总额', '零售总额'],
  固投: ['固定资产投资', '固定资产投资额'],
  人口: ['常住人口', '年末总人口', '总人口'],
  失业率: ['城镇调查失业率', '调查失业率'],
  收入: ['居民人均可支配收入', '可支配收入'],
  居民收入: ['居民人均可支配收入', '全体居民人均可支配收入'],
  工业增加值: ['规模以上工业增加值', '规上工业增加值'],
  规上工业增加值: ['规模以上工业增加值', '工业增加值'],
  财政收入: ['一般公共预算收入', '地方财政收入'],
  一般公共预算收入: ['地方财政一般公共预算收入', '财政收入'],
  粮食: ['粮食产量', '粮食总产量'],
  粮食产量: ['粮食总产量'],
  进出口: ['货物进出口总额', '进出口总额', '外贸总额'],
  房地产: ['房地产开发投资', '房地产投资'],
  建筑业: ['建筑业总产值', '建筑业产值'],
  农业: ['农林牧渔业总产值', '农业总产值'],
  能源: ['能源生产总量'],
};

/** Query words that carry no indicator-name signal. */
const STOP_WORDS = new Set([
  '中国',
  '全国',
  '国家',
  '统计',
  '统计局',
  '数据',
  '最新',
  '今年',
  '去年',
  '全年',
  '年度',
  '季度',
  '月度',
  '月份',
  '多少',
  '是多少',
  '查询',
  '查',
  '一下',
  '的',
  '了',
  '吗',
  '呢',
  '和',
  '与',
  '及',
  '请',
  '帮我',
  '看看',
]);

/** Normalize text for matching: lower-case, strip whitespace/punctuation and parentheses content. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s,，.。;；:：、!?！？"'“”‘’\-_/\\|]/g, '')
    .replace(/[年月日]/g, '')
    .trim();
}

/** Expand a user keyword with known aliases. The original query is always first. */
export function expandAliases(query: string): string[] {
  const normalized = normalize(query);
  const result = new Set<string>();
  if (normalized) result.add(normalized);

  for (const [key, values] of Object.entries(ALIASES)) {
    const normalizedKey = normalize(key);
    if (
      normalized === normalizedKey ||
      normalized.includes(normalizedKey) ||
      normalizedKey.includes(normalized)
    ) {
      for (const value of values) result.add(normalize(value));
    }
  }

  return [...result].filter(Boolean);
}

/** Split a query into meaningful tokens. */
export function queryTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const part of query.split(/[\s,，.。;；:：、!?！？"'“”‘’\-_/\\|]+/)) {
    const normalized = normalize(part);
    if (normalized.length >= 2 && !STOP_WORDS.has(normalized)) tokens.add(normalized);
  }
  const whole = normalize(query);
  if (whole.length >= 2 && !STOP_WORDS.has(whole)) tokens.add(whole);
  return [...tokens];
}

/** Remove province/region words from a keyword so "广东 GDP" resolves like "GDP". */
export function stripRegion(query: string, regionNames: string[]): string {
  let result = query;
  for (const name of regionNames) {
    const short = name.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|藏族|蒙古)/g, '');
    for (const candidate of [name, short]) {
      if (candidate.length >= 2) {
        result = result.replace(new RegExp(candidate, 'g'), ' ');
      }
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

export const MEASURE_TERMS = {
  total: ['总量', '总额', '多少', '产值', '增加值', '亿元', '元'],
  growth: ['增速', '增长', '同比', '环比', '涨幅', '下跌', '下降'],
  index: ['指数', '上年=100', '上年同月=100', '上年同期=100', '定基'],
  perCapita: ['人均', '每人'],
  contribution: ['贡献率', '拉动', '构成', '占比'],
  cumulative: ['累计', '年初至今'],
  current: ['当季', '当月', '单季'],
  constantPrice: ['不变价', '可比价'],
  currentPrice: ['现价', '当年价'],
} as const;

export function hasAny(text: string, terms: readonly string[]): boolean {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(normalize(term)));
}
