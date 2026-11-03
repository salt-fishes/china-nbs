import { invalidArgument, NbsError } from './errors.js';
import type { NbsProvider } from './provider.js';
import { type RegionRecord, regionSuggestions, resolveRegion, scopeOf } from './regions.js';
import { type ResolveOutcome, resolveIndicator } from './resolver.js';
import { fetchSeries } from './series.js';
import type { CompareSeries, Period, QueryOptions, ResolvedIndicator } from './types.js';

export interface CompareResult {
  indicator: ResolvedIndicator;
  series: CompareSeries[];
  notes: string[];
  partial: boolean;
}

export interface CompareOutcome {
  resolution: ResolveOutcome;
  result?: CompareResult;
}

const MAX_REGIONS = 8;

/** Compare one indicator across provinces (or across the given regions). */
export async function compareRegions(
  provider: NbsProvider,
  options: QueryOptions,
  period: Period,
): Promise<CompareOutcome> {
  if (!options.regions || options.regions.length === 0) {
    throw invalidArgument('compare 需要 regions 参数', '示例：regions: ["广东", "江苏", "浙江"]');
  }
  if (options.regions.length > MAX_REGIONS) {
    throw invalidArgument(`compare 最多支持 ${MAX_REGIONS} 个地区`, '请减少地区数量或分多次查询。');
  }

  const regions: RegionRecord[] = [];
  for (const input of options.regions) {
    const region = resolveRegion(input);
    if (!region) {
      throw invalidArgument(
        `无法识别地区：${input}`,
        `可用地区包括：${regionSuggestions(input).join('、') || '广东、江苏、浙江、山东、河南'}`,
      );
    }
    regions.push(region);
  }

  const scopes = new Set(regions.map((region) => scopeOf(region)));
  if (scopes.size > 1) {
    throw invalidArgument('compare 不支持跨范围混比', '请全部使用全国、分省或主要城市，不要混合。');
  }
  if (scopes.has('city') && period !== 'year') {
    throw new NbsError('UNSUPPORTED_ACTION', '主要城市月度/季度对比暂未支持', {
      retryable: false,
      hint: '主要城市目前只有年度数据（code=8）。',
    });
  }

  const first = regions[0];
  if (!first) throw invalidArgument('compare 需要至少一个地区');

  const resolution = await resolveIndicator(provider, options, period, first);
  if (resolution.kind !== 'resolved') return { resolution };

  const base = resolution.indicator;
  const series: CompareSeries[] = [];
  const notes: string[] = [];
  let partial = false;

  for (const region of regions) {
    const indicator: ResolvedIndicator = {
      ...base,
      region: region.text,
      regionCode: region.value,
    };
    try {
      const result = await fetchSeries(provider, indicator, period, {
        start: options.start,
        end: options.end,
        maxPoints: options.maxPoints,
        signal: options.signal,
        noCache: options.noCache,
      });
      series.push({
        region: region.text,
        regionCode: region.value,
        points: result.points,
      });
      notes.push(...result.notes.map((note) => `${region.text}：${note}`));
      if (result.partial) partial = true;
    } catch (error) {
      partial = true;
      notes.push(
        `${region.text}：查询失败，${error instanceof Error ? error.message : String(error)}`,
      );
      if (series.length === 0) throw error;
    }
  }

  return {
    resolution,
    result: {
      indicator: base,
      series,
      notes,
      partial,
    },
  };
}
