import { TtlCache } from './cache.js';
import {
  circuitOpenError,
  NbsError,
  parseError,
  timeoutError,
  upstreamBlocked,
  upstreamError,
} from './errors.js';
import { RateLimiter, sleep } from './rate-limiter.js';
import type { NbsApiResponse } from './types.js';

const DEFAULT_BASE_URL = 'https://data.stats.gov.cn/dg/website/publicrelease/web/external';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 5_000;

export interface CircuitBreakerOptions {
  /** Consecutive retryable failures before the circuit opens. Defaults to 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before a half-open trial. Defaults to 30000 ms. */
  cooldownMs?: number;
}

export interface NbsClientOptions {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  jitterMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  cache?: TtlCache;
  limiter?: RateLimiter;
  fetchImpl?: typeof fetch;
  /**
   * Optional undici dispatcher, e.g. `new ProxyAgent('http://127.0.0.1:7890')`.
   * Kept as `unknown` so the core package stays dependency-free.
   */
  dispatcher?: unknown;
  /** Set to false to disable the circuit breaker. */
  circuitBreaker?: CircuitBreakerOptions | false;
  /** Clock override for tests. Defaults to Date.now. */
  now?: () => number;
  logger?: (message: string, detail?: unknown) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  cacheKey?: string;
  cacheTtlMs?: number;
  noCache?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

interface AbortBundle {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function createAbortBundle(parent: AbortSignal | undefined, timeoutMs: number): AbortBundle {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort(abortError());
  if (parent) {
    if (parent.aborted) controller.abort(abortError());
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out.', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | undefined> | undefined,
): string {
  const url = new URL(joinUrl(baseUrl, path));
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * HTTP client for the NBS public-release API.
 *
 * - serialized rate limiting (default 2s between request starts)
 * - per-request timeout and whole-query abort signal
 * - one retry for retryable upstream errors
 * - TTL+LRU cache with in-flight de-duplication
 * - parses JSON even when the server sends `Content-Type: text/html`
 */
export class NbsClient {
  readonly baseUrl: string;
  readonly cache: TtlCache;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly jitterMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly dispatcher?: unknown;
  private readonly logger?: (message: string, detail?: unknown) => void;
  private readonly sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly limiter: RateLimiter;
  private readonly circuitEnabled: boolean;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(options: NbsClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.jitterMs = options.jitterMs ?? 250;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.cache = options.cache ?? new TtlCache();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.dispatcher = options.dispatcher;
    this.logger = options.logger;
    this.sleepImpl = options.sleep ?? sleep;
    const circuit = options.circuitBreaker === false ? undefined : (options.circuitBreaker ?? {});
    this.circuitEnabled = circuit !== undefined;
    this.circuitFailureThreshold = Math.max(1, circuit?.failureThreshold ?? 5);
    this.circuitCooldownMs = Math.max(0, circuit?.cooldownMs ?? 30_000);
    this.now = options.now ?? Date.now;
    this.limiter =
      options.limiter ??
      new RateLimiter({
        minIntervalMs: options.minIntervalMs,
        jitterMs: options.jitterMs,
        sleep: options.sleep,
      });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const cacheKey = options.cacheKey;
    const ttl = options.cacheTtlMs ?? 0;
    if (cacheKey && ttl > 0) {
      return this.cache.getOrLoad(cacheKey, ttl, () => this.requestWithRetry<T>(path, options), {
        noCache: options.noCache,
      });
    }
    return this.requestWithRetry<T>(path, options);
  }

  private async requestWithRetry<T>(path: string, options: RequestOptions): Promise<T> {
    this.assertCircuitClosed(path);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.limiter.run(
          () => this.requestOnce<T>(path, options),
          options.signal,
        );
        this.consecutiveFailures = 0;
        return result;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof NbsError && error.retryable;
        if (!retryable || attempt >= this.maxRetries || options.signal?.aborted) {
          this.recordFailure(error);
          break;
        }
        const wait = this.retryDelayMs + Math.floor(Math.random() * this.jitterMs);
        this.logger?.('retrying request', { path, attempt: attempt + 1, wait });
        await this.sleepImpl(wait, options.signal);
      }
    }
    throw lastError;
  }

  private assertCircuitClosed(path: string): void {
    if (!this.circuitEnabled || this.circuitOpenedAt === null) return;
    const elapsed = this.now() - this.circuitOpenedAt;
    if (elapsed >= this.circuitCooldownMs) {
      // Half-open: allow one trial; a single failure opens the circuit again.
      this.circuitOpenedAt = null;
      this.consecutiveFailures = Math.max(0, this.circuitFailureThreshold - 1);
      return;
    }
    throw circuitOpenError(this.circuitCooldownMs - elapsed, this.consecutiveFailures, path);
  }

  private recordFailure(error: unknown): void {
    if (!this.circuitEnabled) return;
    if (!(error instanceof NbsError) || !error.retryable) return;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitFailureThreshold && this.circuitOpenedAt === null) {
      this.circuitOpenedAt = this.now();
      this.logger?.('circuit opened', { failures: this.consecutiveFailures });
    }
  }

  private async requestOnce<T>(path: string, options: RequestOptions): Promise<T> {
    const url = buildUrl(this.baseUrl, path, options.query);
    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const bundle = createAbortBundle(options.signal, timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://data.stats.gov.cn/',
      'User-Agent': this.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Client-Name': 'china-nbs',
      ...options.headers,
    };

    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json;charset=UTF-8';
    }

    this.logger?.('request', { method, url, body });
    try {
      let response: Response;
      try {
        const init: RequestInit & { dispatcher?: unknown } = {
          method,
          headers,
          body,
          signal: bundle.signal,
        };
        if (this.dispatcher !== undefined) {
          (init as unknown as { dispatcher?: unknown }).dispatcher = this.dispatcher;
        }
        response = await this.fetchImpl(url, init);
      } catch (error) {
        if (bundle.timedOut()) throw timeoutError(timeoutMs);
        if (options.signal?.aborted) {
          throw new NbsError('ABORTED', '查询已取消', { retryable: false });
        }
        throw error;
      }

      const text = await response.text();
      if (response.status === 403) throw upstreamBlocked(response.status, text.slice(0, 300));
      if (response.status === 429) {
        throw new NbsError('UPSTREAM_RATE_LIMITED', '国家统计局接口返回 429', {
          retryable: true,
          hint: '请求过于频繁；请等待后重试。',
          details: { status: response.status },
        });
      }
      if (response.status >= 500) {
        throw upstreamError(response.status, `国家统计局接口返回 ${response.status}`, {
          bodySnippet: text.slice(0, 300),
        });
      }
      if (!response.ok) {
        throw new NbsError('UPSTREAM_ERROR', `国家统计局接口返回 ${response.status}`, {
          retryable: false,
          hint: '接口路径可能已变化；请查看 docs/contracts.md。',
          details: { status: response.status, bodySnippet: text.slice(0, 300) },
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw parseError('接口返回的不是 JSON', {
          status: response.status,
          contentType: response.headers.get('content-type'),
          bodySnippet: text.slice(0, 300),
        });
      }

      if (!parsed || typeof parsed !== 'object') {
        throw parseError('接口返回结构不是对象', { bodySnippet: text.slice(0, 300) });
      }

      const envelope = parsed as Partial<NbsApiResponse<T>>;
      if (envelope.success === false) {
        throw upstreamError(response.status, envelope.message || '国家统计局接口返回失败', {
          state: envelope.state,
        });
      }
      if (envelope.state !== undefined && envelope.state !== 20000) {
        throw upstreamError(response.status, envelope.message || `接口状态码 ${envelope.state}`, {
          state: envelope.state,
        });
      }
      if (!('data' in envelope)) {
        throw parseError('接口返回缺少 data 字段', { bodySnippet: text.slice(0, 300) });
      }
      return envelope.data as T;
    } catch (error) {
      if (bundle.timedOut()) throw timeoutError(timeoutMs);
      throw error;
    } finally {
      bundle.cleanup();
    }
  }
}
