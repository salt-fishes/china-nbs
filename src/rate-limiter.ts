export interface RateLimiterOptions {
  minIntervalMs?: number;
  jitterMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Abortable sleep used by the limiter and retry logic. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Serialized rate limiter. Every caller joins one queue; request starts are
 * spaced by at least `minIntervalMs` plus jitter.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;
  private readonly sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;
  private queueTail: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? 2_000;
    this.jitterMs = options.jitterMs ?? 250;
    this.sleepImpl = options.sleep ?? sleep;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.queueTail;
    let release!: () => void;
    this.queueTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      const elapsed = Date.now() - this.lastRequestAt;
      const wait = this.minIntervalMs + Math.floor(Math.random() * this.jitterMs) - elapsed;
      if (wait > 0) await this.sleepImpl(wait, signal);
      this.lastRequestAt = Date.now();
      return await fn();
    } finally {
      release();
    }
  }
}
