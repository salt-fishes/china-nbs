import { TtlCache } from './cache.js';
import { fetchCatalog } from './catalog.js';
import { NbsClient, type NbsClientOptions } from './client.js';
import { compareRegions } from './compare.js';
import { invalidArgument, NbsError, timeoutError, toQueryError } from './errors.js';
import { render } from './format.js';
import { NbsProviderImpl } from './nbs-provider.js';
import type { NbsProvider } from './provider.js';
import { RateLimiter } from './rate-limiter.js';
import {
  inferRegionFromText,
  NATIONAL_REGION,
  regionSuggestions,
  resolveRegion,
} from './regions.js';
import { inferPeriod, type ResolveOutcome, resolveIndicator } from './resolver.js';
import { fetchSeries } from './series.js';
import type {
  Action,
  IndicatorCandidate,
  IndicatorMeta,
  Period,
  QueryOptions,
  QueryResult,
  ResolvedIndicator,
  SourceMeta,
} from './types.js';

const SOURCE_NAME = '国家统计局' as const;
const SOURCE_URL = 'https://data.stats.gov.cn/' as const;

// Shared across query() calls so cache and serialized rate limiting actually
// apply to a long-lived process (qbot, CLI server, etc.).
const SHARED_CACHE = new TtlCache({ maxEntries: 200 });
const SHARED_LIMITER = new RateLimiter({ minIntervalMs: 2_000, jitterMs: 250 });

function sourceNow(): SourceMeta {
  return {
    name: SOURCE_NAME,
    url: SOURCE_URL,
    retrievedAt: new Date().toISOString(),
  };
}

function indicatorMeta(indicator: ResolvedIndicator): IndicatorMeta {
  return {
    id: `${indicator.cid}:${indicator.indicId}`,
    name: indicator.name,
    displayName: indicator.displayName,
    unit: indicator.unit,
    frequency: indicator.frequency,
    region: indicator.region,
    measure: indicator.measure,
    note: indicator.note,
  };
}

function ambiguousResult(
  action: Action,
  source: SourceMeta,
  candidates: IndicatorCandidate[],
): QueryResult {
  return {
    ok: false,
    action,
    source,
    candidates,
    error: {
      code: 'AMBIGUOUS',
      message: '找到多个可能的指标，无法确定要查哪一个',
      retryable: false,
      hint: '请从 candidates 中选择一个，把它的 id 作为 indicatorId 再查；CLI 可用 --select <序号> 或 --json 查看 id。',
    },
  };
}

function notFoundResult(
  action: Action,
  source: SourceMeta,
  query: string,
  suggestions: string[],
): QueryResult {
  return {
    ok: false,
    action,
    source,
    error: {
      code: 'NOT_FOUND',
      message: `没有找到与“${query}”匹配的指标`,
      retryable: false,
      hint: `换一个更具体的指标名，或试试：${suggestions.slice(0, 6).join('、')}`,
      details: { suggestions },
    },
  };
}

function resolutionResult(
  action: Action,
  source: SourceMeta,
  query: string,
  resolution: ResolveOutcome,
): QueryResult | undefined {
  if (resolution.kind === 'ambiguous')
    return ambiguousResult(action, source, resolution.candidates);
  if (resolution.kind === 'notFound') {
    return notFoundResult(action, source, query, resolution.suggestions);
  }
  return undefined;
}

async function dispatch(
  provider: NbsProvider,
  options: QueryOptions,
  action: Action,
  source: SourceMeta,
): Promise<QueryResult> {
  if (action === 'catalog') {
    const catalog = await fetchCatalog(
      provider,
      options,
      options.code ?? '3',
      options.pid ?? '',
      options.depth ?? 1,
    );
    return {
      ok: true,
      action,
      source,
      nodes: catalog.nodes,
      ...(catalog.notes.length > 0 ? { notes: catalog.notes } : {}),
    };
  }

  const query = options.query?.trim();
  if (!query) {
    throw invalidArgument('缺少 query 参数', '示例：query({ query: "GDP", action: "series" })');
  }

  const region = options.region
    ? resolveRegion(options.region)
    : (inferRegionFromText(options.query) ?? NATIONAL_REGION);
  if (!region) {
    throw invalidArgument(
      `无法识别地区：${options.region ?? ''}`,
      `可用地区包括：${regionSuggestions(options.region ?? '').join('、') || '全国、广东、江苏、浙江'}`,
    );
  }

  const period: Period = inferPeriod(options);

  if (action === 'compare') {
    const compared = await compareRegions(provider, options, period);
    const early = resolutionResult(action, source, query, compared.resolution);
    if (early) return early;
    if (!compared.result) {
      throw new NbsError('UPSTREAM_ERROR', 'compare 没有返回结果', { retryable: true });
    }
    return {
      ok: true,
      action,
      source,
      indicator: indicatorMeta(compared.result.indicator),
      series: compared.result.series,
      ...(compared.result.notes.length > 0 ? { notes: compared.result.notes } : {}),
      ...(compared.result.partial ? { partial: true } : {}),
    };
  }

  const resolution = await resolveIndicator(provider, options, period, region);
  const early = resolutionResult(action, source, query, resolution);
  if (early) return early;
  if (resolution.kind !== 'resolved') {
    throw new NbsError('UPSTREAM_ERROR', '指标解析失败', { retryable: true });
  }

  const indicator = resolution.indicator;
  const notes: string[] = [];
  if (indicator.note) notes.push(indicator.note);

  if (action === 'search') {
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 5)));
    const result = await fetchSeries(provider, indicator, period, {
      start: options.start,
      end: options.end,
      maxPoints: Math.min(50, limit + 3),
      signal: options.signal,
      noCache: options.noCache,
    });
    const nonNull = result.points.filter((point) => point.value !== null);
    const points = nonNull.length > 0 ? nonNull.slice(-limit) : result.points.slice(-limit);
    notes.push(
      ...result.notes.filter(
        (note) => !note.startsWith('数据点较多') && !note.startsWith('末尾尚未发布'),
      ),
    );
    return {
      ok: true,
      action,
      source: sourceNow(),
      indicator: indicatorMeta(indicator),
      points,
      ...(notes.length > 0 ? { notes } : {}),
      ...(result.partial ? { partial: true } : {}),
    };
  }

  if (action === 'series') {
    const result = await fetchSeries(provider, indicator, period, {
      start: options.start,
      end: options.end,
      maxPoints: options.maxPoints,
      signal: options.signal,
      noCache: options.noCache,
    });
    notes.push(...result.notes);
    return {
      ok: true,
      action,
      source: sourceNow(),
      indicator: indicatorMeta(indicator),
      points: result.points,
      ...(notes.length > 0 ? { notes } : {}),
      ...(result.partial ? { partial: true } : {}),
    };
  }

  throw new NbsError('UNSUPPORTED_ACTION', `不支持的操作：${action}`, {
    retryable: false,
    hint: '可用 action：search、series、compare、catalog。',
  });
}

/** Create a default client/provider pair. */
export function createClient(options: NbsClientOptions = {}): NbsClient {
  return new NbsClient(options);
}

/** Run a query against an explicit provider (useful for tests and adapters). */
export async function queryWithProvider(
  provider: NbsProvider,
  options: QueryOptions = {},
  source: SourceMeta = sourceNow(),
): Promise<QueryResult> {
  const action = options.action ?? 'search';
  try {
    return await dispatch(provider, options, action, source);
  } catch (error) {
    return {
      ok: false,
      action,
      source: sourceNow(),
      error: toQueryError(error),
    };
  }
}

/**
 * Query China's National Bureau of Statistics data release database.
 *
 * The return value is always structured. Use `render(result, 'text' | 'table')`
 * for CLI/chat display.
 */
export async function query(options: QueryOptions = {}): Promise<QueryResult> {
  const action = options.action ?? 'search';
  const totalTimeoutMs = Math.max(1_000, options.totalTimeoutMs ?? 45_000);
  const controller = new AbortController();
  let totalTimedOut = false;

  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    totalTimedOut = true;
    controller.abort(new DOMException('Total query timeout', 'TimeoutError'));
  }, totalTimeoutMs);

  const client = createClient({
    timeoutMs: options.timeoutMs,
    cache: SHARED_CACHE,
    limiter: SHARED_LIMITER,
    fetchImpl: options.fetchImpl,
    dispatcher: options.dispatcher,
    logger: options.debug
      ? (options.logger ?? ((message, detail) => console.error(message, detail)))
      : undefined,
  });
  const provider = new NbsProviderImpl(client);

  try {
    return await dispatch(provider, { ...options, signal: controller.signal }, action, sourceNow());
  } catch (error) {
    if (totalTimedOut) {
      return {
        ok: false,
        action,
        source: sourceNow(),
        error: toQueryError(timeoutError(totalTimeoutMs)),
      };
    }
    return {
      ok: false,
      action,
      source: sourceNow(),
      error: toQueryError(error),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export { TtlCache } from './cache.js';
export type { CircuitBreakerOptions, NbsClientOptions } from './client.js';
export { NbsClient } from './client.js';
export { isNbsError, NbsError } from './errors.js';
export { NbsProviderImpl } from './nbs-provider.js';
export { RateLimiter } from './rate-limiter.js';
export { NATIONAL_REGION, PROVINCES, resolveRegion } from './regions.js';
export { inferPeriod } from './resolver.js';
export type {
  Action,
  CatalogNode,
  CompareSeries,
  DataPoint,
  ErrorCode,
  Format,
  IndicatorCandidate,
  IndicatorMeta,
  Period,
  QueryError,
  QueryOptions,
  QueryResult,
  SourceMeta,
} from './types.js';
export { render };
