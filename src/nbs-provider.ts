import type { NbsClient } from './client.js';
import type {
  IndicatorParams,
  NbsProvider,
  SearchParams,
  SearchResult,
  SeriesParams,
  TreeParams,
} from './provider.js';
import type {
  IndicatorRecord,
  NbsDataPeriod,
  NbsIndicatorItem,
  NbsSearchData,
  NbsSearchItem,
  NbsTreeItem,
  Period,
  ProvinceRecord,
  SearchRecord,
  SeriesPeriod,
  TreeRecord,
} from './types.js';

const ROOT_ID = '69c574ab128a44e595cc0b24502b771b';

const TTL = {
  search: 10 * 60 * 1000,
  series: 30 * 60 * 1000,
  tree: 24 * 60 * 60 * 1000,
  indicators: 24 * 60 * 60 * 1000,
  provinces: 7 * 24 * 60 * 60 * 1000,
};

const PERIOD_CODE: Record<Period, string> = {
  year: '3',
  quarter: '2',
  month: '1',
};

function periodFromDtType(dtType: string): Period | undefined {
  if (dtType === 'YY') return 'year';
  if (dtType === 'SS') return 'quarter';
  if (dtType === 'MM') return 'month';
  return undefined;
}

function isLikelyUnit(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 20) return false;
  if (/^\d{4}(-\d{4})?$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (text.includes('=')) return true;
  if (/[%％]/.test(text)) return true;
  if (text === '人') return true;
  return /(亿元|万元|千元|元|美元|欧元|港元|百分点|万吨|亿吨|万千瓦|亿千瓦|万千瓦时|亿千瓦时|万人|亿人|人次|万平方米|亿平方米|平方公里|公顷|亩|台|辆|艘|架|张|件|部|所|个|户|头|只|吨|米|公里|升|立方米|年|岁|天|小时|分钟|秒)/.test(
    text,
  );
}

/** Extract the last plausible unit from a show_name like "国内生产总值 (亿元) ". */
export function extractUnit(showName: string): string | undefined {
  const matches = [...showName.matchAll(/[（(]([^（）()]*)[）)]/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const candidate = matches[index];
    if (candidate && isLikelyUnit(candidate)) return candidate;
  }
  if (/[%％]\s*$/.test(showName)) return '%';
  return undefined;
}

function parseYear(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{4})/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function mapSearchItem(item: NbsSearchItem): SearchRecord {
  const frequency = periodFromDtType(item.dt_type);
  const showName = item.show_name.trim();
  return {
    cid: item.cid,
    indicId: item.indic_id,
    name: item.i_name?.trim() || item.ek_name?.trim() || showName,
    showName,
    unit: extractUnit(showName),
    ...(frequency === undefined ? {} : { frequency }),
    dt: item.dt,
    dtName: item.dt_name,
    region: item.da_name || '全国',
    regionCode: item.da,
    value: item.value,
    typeValue: item.type_value,
    explain: item.explain,
    treePath: item.treeinfo_globalid,
  };
}

function mapTreeItem(item: NbsTreeItem): TreeRecord {
  return {
    id: item._id,
    name: item.name.trim(),
    parentId: item.treeinfo_pid || undefined,
    level: item.treeinfo_level,
    isLeaf: item.isLeaf,
    startYear: parseYear(item.sdate),
    endYear: parseYear(item.edate),
  };
}

function mapIndicator(item: NbsIndicatorItem, cid: string): IndicatorRecord {
  const measure =
    item.kj1_name?.trim() ||
    item.kj2_name?.trim() ||
    item.kj3_name?.trim() ||
    item.dp_name?.trim() ||
    undefined;
  return {
    id: item._id,
    cid: item.catalogid || cid,
    name: item._name.trim(),
    showName: item.i_showname.trim(),
    unit: item.du_name && item.du_name !== '无' ? item.du_name.trim() : undefined,
    measure,
    startDate: item.daterange_sdate ?? undefined,
    endDate: item.daterange_edate ?? undefined,
    note: item.i_annotation ?? undefined,
  };
}

function mapSeries(periods: NbsDataPeriod[]): SeriesPeriod[] {
  return periods.map((period) => ({
    code: period.code,
    name: period.name,
    values: period.values.map((value) => ({
      id: value._id,
      name: value._name,
      showName: value.i_showname,
      unit: value.du_name && value.du_name !== '无' ? value.du_name : undefined,
      value: value.value,
      region: value.da,
      regionName: value.da_name,
    })),
  }));
}

/** Default provider backed by data.stats.gov.cn. */
export class NbsProviderImpl implements NbsProvider {
  private readonly client: NbsClient;

  constructor(client: NbsClient) {
    this.client = client;
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const code = params.code ?? (params.period ? PERIOD_CODE[params.period] : '');
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    const cacheKey = `search:${code}:${page}:${pageSize}:${params.keyword}`;
    const data = await this.client.request<NbsSearchData>('/query', {
      query: {
        search: params.keyword,
        pagenum: page,
        pageSize,
        code,
      },
      cacheKey,
      cacheTtlMs: TTL.search,
      noCache: params.noCache,
      signal: params.signal,
    });
    return {
      records: (data.data ?? []).map(mapSearchItem),
      count: data.count ?? 0,
    };
  }

  async getTree(params: TreeParams): Promise<TreeRecord[]> {
    const cacheKey = `tree:${params.code}:${params.pid ?? ''}`;
    const data = await this.client.request<NbsTreeItem[]>('/new/queryIndexTreeAsync', {
      query: {
        pid: params.pid ?? '',
        code: params.code,
      },
      cacheKey,
      cacheTtlMs: TTL.tree,
      noCache: params.noCache,
      signal: params.signal,
    });
    return (data ?? []).map(mapTreeItem);
  }

  async getIndicators(params: IndicatorParams): Promise<IndicatorRecord[]> {
    const cacheKey = `indicators:${params.cid}`;
    const data = await this.client.request<{ total: number; list: NbsIndicatorItem[] }>(
      '/new/queryIndicatorsByCid',
      {
        query: {
          cid: params.cid,
          dt: '',
          name: '',
        },
        cacheKey,
        cacheTtlMs: TTL.indicators,
        noCache: params.noCache,
        signal: params.signal,
      },
    );
    return (data.list ?? []).map((item) => mapIndicator(item, params.cid));
  }

  async getSeries(params: SeriesParams): Promise<SeriesPeriod[]> {
    const cacheKey = `series:${params.cid}:${params.indicId}:${params.dts}:${params.region.value}`;
    const data = await this.client.request<NbsDataPeriod[]>('/stream/esData', {
      method: 'POST',
      body: {
        cid: params.cid,
        indicatorIds: [params.indicId],
        daCatalogId: '',
        das: [{ text: params.region.text, value: params.region.value }],
        showType: '1',
        dts: [params.dts],
        rootId: ROOT_ID,
      },
      cacheKey,
      cacheTtlMs: TTL.series,
      noCache: params.noCache,
      signal: params.signal,
    });
    return mapSeries(data ?? []);
  }

  async getProvinces(signal?: AbortSignal): Promise<ProvinceRecord[]> {
    return this.client.request<ProvinceRecord[]>('/getAllProvince', {
      cacheKey: 'provinces',
      cacheTtlMs: TTL.provinces,
      signal,
    });
  }
}

export { PERIOD_CODE, ROOT_ID };
