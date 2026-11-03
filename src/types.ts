/** Public action names. */
export type Action = 'search' | 'series' | 'compare' | 'catalog';

/** Data frequency. */
export type Period = 'year' | 'quarter' | 'month';

/** Rendering format. The core query API always returns QueryResult; use render(). */
export type Format = 'json' | 'text' | 'table';

/** Options accepted by query(). */
export interface QueryOptions {
  /** Defaults to "search". */
  action?: Action;
  /** Indicator keyword, e.g. "GDP", "CPI", "广东 GDP". */
  query?: string;
  /** Single region. Defaults to "全国". */
  region?: string;
  /** Regions used by action=compare. */
  regions?: string[];
  /** Data frequency. Inferred from start/end/query when omitted. */
  period?: Period;
  /** Inclusive range start, e.g. 2015, 2025Q1, 2025-01. */
  start?: string | number;
  /** Inclusive range end. */
  end?: string | number;
  /** Search / latest point count. Defaults to 5 for search, 8 for candidates. */
  limit?: number;
  /** Maximum series points. Defaults to 240. */
  maxPoints?: number;
  /** Per-request timeout in milliseconds. Defaults to 20000. */
  timeoutMs?: number;
  /** Whole-query timeout in milliseconds. Defaults to 45000. */
  totalTimeoutMs?: number;
  /** Abort the query from the caller side. */
  signal?: AbortSignal;
  /**
   * Opaque candidate id from QueryResult.candidates[].id.
   * Use this to resolve an AMBIGUOUS result without re-searching.
   */
  indicatorId?: string;
  /**
   * Catalog tree code. Scope × frequency:
   * 1=全国月度, 2=全国季度, 3=全国年度, 4=分省月度, 5=分省季度,
   * 6=分省年度, 7=主要城市月度价格, 8=主要城市年度, 9=港澳台月度.
   */
  code?: string;
  /** Catalog parent node id. Empty means the root. */
  pid?: string;
  /** Catalog expansion depth, 1..3. Defaults to 1. */
  depth?: number;
  /** Disable the in-memory cache for this call. */
  noCache?: boolean;
  /** Custom fetch implementation (proxy, testing, adapters). */
  fetchImpl?: typeof fetch;
  /** Optional undici dispatcher passed to fetch, e.g. `new ProxyAgent(url)`. */
  dispatcher?: unknown;
  /** Emit debug information through the optional logger. */
  debug?: boolean;
  /** Optional logger for debug output. */
  logger?: (message: string, detail?: unknown) => void;
}

/** Source attribution included in every result. */
export interface SourceMeta {
  name: '国家统计局';
  url: 'https://data.stats.gov.cn/';
  /** ISO-8601 timestamp in UTC. */
  retrievedAt: string;
}

/** Error payload returned by query(). */
export interface QueryError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  hint?: string;
  details?: unknown;
}

/** Stable error codes. */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'INVALID_RANGE'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_ACTION'
  | 'RATE_LIMITED'
  | 'UPSTREAM_BLOCKED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'CIRCUIT_OPEN'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'PARSE_ERROR';

/** Indicator metadata shown to callers. Internal ids are exposed for selection/debugging only. */
export interface IndicatorMeta {
  /** Opaque selection token: `${cid}:${indicId}`. */
  id: string;
  name: string;
  displayName: string;
  unit?: string;
  frequency?: Period;
  region?: string;
  /** Human-readable measure, e.g. 当季值 / 累计值 / 上年同月=100. */
  measure?: string;
  note?: string;
}

/** A candidate returned when the resolver is not confident. */
export interface IndicatorCandidate extends IndicatorMeta {
  score: number;
  reasons: string[];
}

/** One data point. */
export interface DataPoint {
  /** Canonical period: 2025, 2025Q3, 2025-10. */
  period: string;
  periodName: string;
  value: number | null;
  rawValue: string;
  display: string;
  unit?: string;
  region?: string;
}

/** One region's series in a compare result. */
export interface CompareSeries {
  region: string;
  regionCode: string;
  points: DataPoint[];
}

/** One catalog tree node. */
export interface CatalogNode {
  id: string;
  name: string;
  level: number;
  isLeaf: boolean;
  parentId?: string;
  startYear?: number;
  endYear?: number;
}

/** The single public result shape. */
export interface QueryResult {
  ok: boolean;
  action: Action;
  indicator?: IndicatorMeta;
  points?: DataPoint[];
  series?: CompareSeries[];
  candidates?: IndicatorCandidate[];
  nodes?: CatalogNode[];
  source: SourceMeta;
  notes?: string[];
  partial?: boolean;
  error?: QueryError;
}

/** Internal normalized search record. */
export interface SearchRecord {
  cid: string;
  indicId: string;
  name: string | null;
  showName: string;
  unit?: string;
  frequency?: Period;
  dt: string;
  dtName: string;
  region: string;
  regionCode: string;
  value: string;
  typeValue: string;
  explain?: string | null;
  treePath?: string;
}

/** Internal tree record. */
export interface TreeRecord {
  id: string;
  name: string;
  parentId?: string;
  level: number;
  isLeaf: boolean;
  startYear?: number;
  endYear?: number;
}

/** Internal indicator record. */
export interface IndicatorRecord {
  id: string;
  cid: string;
  name: string;
  showName: string;
  unit?: string;
  period?: Period;
  measure?: string;
  startDate?: string;
  endDate?: string;
  note?: string;
}

/** A shard of a long series. */
export interface Shard {
  cid: string;
  indicId: string;
  startYear?: number;
  endYear?: number;
  label?: string;
}

/** Internal resolved indicator. */
export interface ResolvedIndicator {
  cid: string;
  indicId: string;
  name: string;
  displayName: string;
  unit?: string;
  frequency: Period;
  region?: string;
  regionCode?: string;
  measure?: string;
  note?: string;
  shards?: Shard[];
  /** Where the resolution came from. */
  source: 'curated' | 'search' | 'tree' | 'selection';
}

/** Request passed to the provider's series endpoint. */
export interface SeriesRequest {
  cid: string;
  indicId: string;
  dts: string;
  regionCode: string;
  regionName: string;
}

/** One period returned by the series endpoint. */
export interface SeriesPeriod {
  code: string;
  name: string;
  values: Array<{
    id: string;
    name: string;
    showName: string;
    unit?: string;
    value: string;
    region: string;
    regionName: string;
  }>;
}

/** Raw NBS API envelope. */
export interface NbsApiResponse<T> {
  data: T;
  success: boolean;
  state: number;
  message: string;
}

/** Raw search response data. */
export interface NbsSearchData {
  types: Array<{ name: string; code: string; dtType: string }>;
  data: NbsSearchItem[];
  count: number;
}

export interface NbsSearchItem {
  explain: string | null;
  indic_id: string;
  ek: string;
  type_text: string;
  show_name: string;
  i: string;
  type_value: string;
  da_name: string;
  dt: string;
  dt_name: string;
  treeinfo_globalid: string;
  i_name: string | null;
  dt_type: string;
  da: string;
  value: string;
  ek_name: string;
  cid: string;
}

/** Raw tree node. */
export interface NbsTreeItem {
  explain: string | null;
  sdate: string | null;
  _name: string;
  treeinfo_pid: string;
  treeinfo_level: number;
  type: string;
  edate: string | null;
  isLeaf: boolean;
  treeinfo_globalid: string;
  name: string;
  _id: string;
  publicrelease_web_catalog_id: string;
  treeinfo_icon: string | null;
}

/** Raw indicator list item (only fields we consume). */
export interface NbsIndicatorItem {
  _id: string;
  _name: string;
  i_showname: string;
  du_name?: string;
  dp?: string;
  dp_name?: string;
  catalogid: string;
  daterange_sdate?: string | null;
  daterange_edate?: string | null;
  i_annotation?: string | null;
  kj1_name?: string | null;
  kj2_name?: string | null;
  kj3_name?: string | null;
}

/** Raw data period. */
export interface NbsDataPeriod {
  code: string;
  name: string;
  values: NbsDataValue[];
}

export interface NbsDataValue {
  _id: string;
  _name: string;
  i_showname: string;
  du_name?: string;
  value: string;
  da: string;
  da_name: string;
  dp?: string;
  catalogid: string;
}

/** Province record. */
export interface ProvinceRecord {
  text: string;
  value: string;
}
