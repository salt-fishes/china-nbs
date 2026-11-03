import type {
  IndicatorRecord,
  Period,
  ProvinceRecord,
  SearchRecord,
  SeriesPeriod,
  TreeRecord,
} from './types.js';

export interface SearchParams {
  keyword: string;
  period?: Period;
  code?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
  noCache?: boolean;
}

export interface SearchResult {
  records: SearchRecord[];
  count: number;
}

export interface TreeParams {
  pid?: string;
  code: string;
  signal?: AbortSignal;
  noCache?: boolean;
}

export interface IndicatorParams {
  cid: string;
  signal?: AbortSignal;
  noCache?: boolean;
}

export interface SeriesParams {
  cid: string;
  indicId: string;
  dts: string;
  region: { text: string; value: string };
  signal?: AbortSignal;
  noCache?: boolean;
}

export interface NbsProvider {
  search(params: SearchParams): Promise<SearchResult>;
  getTree(params: TreeParams): Promise<TreeRecord[]>;
  getIndicators(params: IndicatorParams): Promise<IndicatorRecord[]>;
  getSeries(params: SeriesParams): Promise<SeriesPeriod[]>;
  getProvinces(signal?: AbortSignal): Promise<ProvinceRecord[]>;
}
