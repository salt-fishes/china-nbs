import { invalidRange } from './errors.js';
import { formatNumber } from './format.js';
import type { NbsProvider } from './provider.js';
import type { DataPoint, Period, ResolvedIndicator, SeriesPeriod, Shard } from './types.js';

interface OrdinalRange {
  start: number;
  end: number;
}

interface ShardRange {
  cid: string;
  indicId: string;
  start: number;
  end: number;
  label?: string;
}

export interface SeriesResult {
  points: DataPoint[];
  notes: string[];
  partial: boolean;
}

const DEFAULT_MAX_POINTS = 240;

function ordinalOf(period: Period, year: number, index: number): number {
  if (period === 'year') return year;
  if (period === 'quarter') return year * 4 + (index - 1);
  return year * 12 + (index - 1);
}

function codeOf(period: Period, ordinal: number): string {
  if (period === 'year') return `${ordinal}YY`;
  if (period === 'quarter') {
    const year = Math.floor(ordinal / 4);
    const quarter = (ordinal % 4) + 1;
    return `${year}${String(quarter).padStart(2, '0')}SS`;
  }
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}${String(month).padStart(2, '0')}MM`;
}

function currentOrdinal(period: Period, now = new Date()): number {
  const year = now.getFullYear();
  if (period === 'year') return year;
  if (period === 'quarter') return year * 4 + Math.floor(now.getMonth() / 3);
  return year * 12 + now.getMonth();
}

function parseYear(value: string | number): number | undefined {
  const match = String(value).match(/(\d{4})/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseOrdinal(
  period: Period,
  value: string | number,
  edge: 'start' | 'end',
): number | undefined {
  const text = String(value).trim();
  if (!text) return undefined;
  const year = parseYear(text);
  if (year === undefined) return undefined;

  if (period === 'year') return year;

  if (period === 'quarter') {
    const qMatch = text.match(/[Qq]\s*([1-4])/);
    const ssMatch = text.match(/^(\d{4})\s*(\d{2})SS$/);
    const q = qMatch?.[1]
      ? Number(qMatch[1])
      : ssMatch?.[2]
        ? Number(ssMatch[2])
        : edge === 'start'
          ? 1
          : 4;
    if (q < 1 || q > 4) return undefined;
    return ordinalOf('quarter', year, q);
  }

  const monthMatch = text.match(/(?:-|\/|年)\s*(\d{1,2})/);
  const mmMatch = text.match(/^(\d{4})(\d{2})MM$/);
  const month = monthMatch?.[1]
    ? Number(monthMatch[1])
    : mmMatch?.[2]
      ? Number(mmMatch[2])
      : edge === 'start'
        ? 1
        : 12;
  if (month < 1 || month > 12) return undefined;
  return ordinalOf('month', year, month);
}

export function resolveRange(
  period: Period,
  start: string | number | undefined,
  end: string | number | undefined,
  now = new Date(),
): OrdinalRange {
  const current = currentOrdinal(period, now);
  const endOrdinal = end === undefined ? current : parseOrdinal(period, end, 'end');
  if (endOrdinal === undefined) {
    throw invalidRange(
      `无法解析结束时间：${String(end)}`,
      period === 'year'
        ? '年度请用 2025 或 2015'
        : period === 'quarter'
          ? '季度请用 2025Q1 或 2025'
          : '月度请用 2025-01 或 2025',
    );
  }

  let startOrdinal = start === undefined ? undefined : parseOrdinal(period, start, 'start');
  if (startOrdinal === undefined) {
    const span = period === 'year' ? 9 : period === 'quarter' ? 7 : 11;
    startOrdinal = endOrdinal - span;
  }

  if (startOrdinal > endOrdinal) {
    throw invalidRange(
      `开始时间晚于结束时间：${String(start)} > ${String(end)}`,
      '请检查 start/end 或 --start/--end。',
    );
  }

  return { start: startOrdinal, end: endOrdinal };
}

function shardRange(shard: Shard, period: Period): ShardRange {
  const start =
    shard.startYear === undefined
      ? Number.NEGATIVE_INFINITY
      : ordinalOf(period, shard.startYear, 1);
  const end =
    shard.endYear === undefined
      ? Number.POSITIVE_INFINITY
      : ordinalOf(period, shard.endYear, period === 'year' ? 1 : period === 'quarter' ? 4 : 12);
  return {
    cid: shard.cid,
    indicId: shard.indicId,
    start,
    end,
    label: shard.label,
  };
}

function buildShardRanges(indicator: ResolvedIndicator, range: OrdinalRange): ShardRange[] {
  if (!indicator.shards || indicator.shards.length === 0) {
    return [
      {
        cid: indicator.cid,
        indicId: indicator.indicId,
        start: range.start,
        end: range.end,
      },
    ];
  }

  return indicator.shards
    .map((shard) => shardRange(shard, indicator.frequency))
    .map((shard) => ({
      ...shard,
      start: Math.max(shard.start, range.start),
      end: Math.min(shard.end, range.end),
    }))
    .filter((shard) => shard.start <= shard.end)
    .sort((a, b) => a.start - b.start);
}

/** Convert an API period code into a canonical period and display name. */
export function parsePeriodCode(code: string): { period: string; name: string } {
  const year = code.match(/^(\d{4})YY$/);
  if (year?.[1]) return { period: year[1], name: `${year[1]}年` };

  const quarter = code.match(/^(\d{4})(\d{2})SS$/);
  if (quarter?.[1] && quarter[2]) {
    const q = Number(quarter[2]);
    if (q >= 1 && q <= 4) {
      return { period: `${quarter[1]}Q${q}`, name: `${quarter[1]}年第${q}季度` };
    }
  }

  const month = code.match(/^(\d{4})(\d{2})MM$/);
  if (month?.[1] && month[2]) {
    const m = Number(month[2]);
    if (m >= 1 && m <= 12) {
      return { period: `${month[1]}-${String(m).padStart(2, '0')}`, name: `${month[1]}年${m}月` };
    }
  }

  return { period: code, name: code };
}

function parseValue(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '');
  if (
    !text ||
    text === '—' ||
    text === '--' ||
    text === '-' ||
    text === 'null' ||
    text === 'None'
  ) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function pointFromPeriod(
  period: SeriesPeriod,
  indicator: ResolvedIndicator,
  fallbackRegion: string,
  indicId = indicator.indicId,
): DataPoint | undefined {
  const value = period.values.find((item) => item.id === indicId) ?? period.values[0] ?? undefined;
  if (!value) return undefined;
  const canonical = parsePeriodCode(period.code);
  const rawValue = value.value ?? '';
  return {
    period: canonical.period,
    periodName: period.name || canonical.name,
    value: parseValue(rawValue),
    rawValue,
    display: formatNumber(rawValue),
    unit: value.unit ?? indicator.unit,
    region: value.regionName || indicator.region || fallbackRegion,
  };
}

function sortKey(period: string): number {
  const year = Number(period.slice(0, 4));
  if (period.includes('Q')) {
    const q = Number(period.split('Q')[1] ?? 1);
    return year * 4 + (q - 1);
  }
  if (period.includes('-')) {
    const month = Number(period.split('-')[1] ?? 1);
    return year * 12 + (month - 1);
  }
  return year;
}

export interface FetchSeriesOptions {
  start?: string | number;
  end?: string | number;
  maxPoints?: number;
  signal?: AbortSignal;
  noCache?: boolean;
}

/** Fetch and merge a series, including shard ranges. */
export async function fetchSeries(
  provider: NbsProvider,
  indicator: ResolvedIndicator,
  period: Period,
  options: FetchSeriesOptions = {},
): Promise<SeriesResult> {
  const range = resolveRange(period, options.start, options.end);
  const shardRanges = buildShardRanges(indicator, range);
  const notes: string[] = [];
  let partial = false;

  if (shardRanges.length === 0) {
    return {
      points: [],
      notes: [`没有覆盖 ${String(options.start ?? '')}–${String(options.end ?? '')} 的分片`],
      partial: false,
    };
  }

  const pointsByPeriod = new Map<string, DataPoint>();
  let successes = 0;
  let firstError: unknown;

  for (const shard of shardRanges) {
    const dts =
      shard.start === shard.end
        ? codeOf(period, shard.start)
        : `${codeOf(period, shard.start)}-${codeOf(period, shard.end)}`;
    try {
      const periods = await provider.getSeries({
        cid: shard.cid,
        indicId: shard.indicId,
        dts,
        region: {
          text: indicator.region ?? '全国',
          value: indicator.regionCode ?? '000000000000',
        },
        signal: options.signal,
        noCache: options.noCache,
      });
      successes += 1;
      for (const periodData of periods) {
        const point = pointFromPeriod(
          periodData,
          indicator,
          indicator.region ?? '全国',
          shard.indicId,
        );
        if (!point) continue;
        const existing = pointsByPeriod.get(point.period);
        if (!existing || existing.value === null || point.value !== null) {
          pointsByPeriod.set(point.period, point);
        }
      }
    } catch (error) {
      partial = true;
      firstError ??= error;
      notes.push(`分片 ${dts} 请求失败，已返回其余分片的数据。`);
    }
  }

  if (successes === 0 && firstError) throw firstError;

  const sorted = [...pointsByPeriod.values()].sort((a, b) => sortKey(a.period) - sortKey(b.period));
  const beforeTrim = sorted.length;
  while (sorted.length > 0 && sorted[sorted.length - 1]?.value === null) {
    sorted.pop();
  }
  if (sorted.length < beforeTrim) {
    notes.push('末尾尚未发布的数据点已省略。');
  }
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  const points = sorted.length > maxPoints ? sorted.slice(-maxPoints) : sorted;
  if (points.length < sorted.length) {
    notes.push(`数据点较多，仅返回最近 ${maxPoints} 个。`);
  }

  return { points, notes, partial };
}
