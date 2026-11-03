import { readFileSync } from 'node:fs';
import { extractUnit } from '../src/nbs-provider.js';
import type { NbsProvider, SearchParams, SearchResult } from '../src/provider.js';
import type {
  IndicatorRecord,
  NbsSearchData,
  NbsSearchItem,
  Period,
  ProvinceRecord,
  SearchRecord,
  SeriesPeriod,
  TreeRecord,
} from '../src/types.js';

export function loadFixture<T>(name: string): T {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

function periodFromDtType(dtType: string): Period | undefined {
  if (dtType === 'YY') return 'year';
  if (dtType === 'SS') return 'quarter';
  if (dtType === 'MM') return 'month';
  return undefined;
}

export function mapSearchItem(item: NbsSearchItem): SearchRecord {
  const showName = item.show_name.trim();
  const frequency = periodFromDtType(item.dt_type);
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

export function searchFixture(name: string): SearchResult {
  const envelope = loadFixture<{ data: NbsSearchData }>(name);
  return {
    records: envelope.data.data.map(mapSearchItem),
    count: envelope.data.count,
  };
}

export function seriesFixture(name: string): SeriesPeriod[] {
  const data = loadFixture<{
    data: Array<{ code: string; name: string; values: Array<Record<string, unknown>> }>;
  }>(name);
  return data.data.map((period) => ({
    code: period.code,
    name: period.name,
    values: period.values.map((value) => ({
      id: String(value._id ?? ''),
      name: String(value._name ?? ''),
      showName: String(value.i_showname ?? ''),
      unit: value.du_name === undefined ? undefined : String(value.du_name),
      value: String(value.value ?? ''),
      region: String(value.da ?? ''),
      regionName: String(value.da_name ?? ''),
    })),
  }));
}

export class StaticProvider implements NbsProvider {
  searchResult: SearchResult = { records: [], count: 0 };
  tree: Record<string, TreeRecord[]> = {};
  indicators: Record<string, IndicatorRecord[]> = {};
  series: Record<string, SeriesPeriod[]> = {};
  provinces: ProvinceRecord[] = [];
  searchCalls = 0;
  seriesCalls: string[] = [];

  async search(_params: SearchParams): Promise<SearchResult> {
    this.searchCalls += 1;
    return this.searchResult;
  }

  async getTree(params: { pid?: string; code: string }): Promise<TreeRecord[]> {
    return this.tree[`${params.code}:${params.pid ?? ''}`] ?? [];
  }

  async getIndicators(params: { cid: string }): Promise<IndicatorRecord[]> {
    return this.indicators[params.cid] ?? [];
  }

  async getSeries(params: {
    cid: string;
    indicId: string;
    dts: string;
    region: { text: string; value: string };
  }): Promise<SeriesPeriod[]> {
    this.seriesCalls.push(params.dts);
    const value =
      this.series[`${params.cid}:${params.region.value}:${params.dts}`] ??
      this.series[`${params.cid}:${params.region.value}`] ??
      this.series[`${params.cid}:${params.dts}`] ??
      this.series[params.cid];
    if (!value) {
      throw new Error(`no series fixture for ${params.cid}:${params.region.value}:${params.dts}`);
    }
    return value;
  }

  async getProvinces(): Promise<ProvinceRecord[]> {
    return this.provinces;
  }
}

export function indicator(
  id: string,
  cid: string,
  name: string,
  showName: string,
  unit?: string,
): IndicatorRecord {
  return { id, cid, name, showName, unit };
}
