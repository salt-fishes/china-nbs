import { describe, expect, it, vi } from 'vitest';
import { NbsClient } from '../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'text/html;charset=UTF-8' },
  });
}

describe('NbsClient', () => {
  it('parses JSON even when content-type is html and caches the result', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { value: 42 }, success: true, state: 20000, message: '成功' }),
    ) as unknown as typeof fetch;
    const client = new NbsClient({ fetchImpl, minIntervalMs: 0, jitterMs: 0, maxRetries: 0 });

    const first = await client.request<{ value: number }>('/query', {
      cacheKey: 'test',
      cacheTtlMs: 10_000,
    });
    const second = await client.request<{ value: number }>('/query', {
      cacheKey: 'test',
      cacheTtlMs: 10_000,
    });

    expect(first.value).toBe(42);
    expect(second.value).toBe(42);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps 403 to UPSTREAM_BLOCKED without retrying', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('blocked', { status: 403 }),
    ) as unknown as typeof fetch;
    const client = new NbsClient({ fetchImpl, minIntervalMs: 0, jitterMs: 0, maxRetries: 2 });

    await expect(client.request('/query')).rejects.toMatchObject({
      code: 'UPSTREAM_BLOCKED',
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 500 once and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('boom', { status: 500 });
      return jsonResponse({ data: { ok: true }, success: true, state: 20000, message: '成功' });
    }) as unknown as typeof fetch;
    const client = new NbsClient({
      fetchImpl,
      minIntervalMs: 0,
      jitterMs: 0,
      maxRetries: 1,
      retryDelayMs: 0,
    });

    const result = await client.request<{ ok: boolean }>('/query');
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps a non-JSON body to PARSE_ERROR', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>not json</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new NbsClient({ fetchImpl, minIntervalMs: 0, jitterMs: 0, maxRetries: 0 });

    await expect(client.request('/query')).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('maps an unsuccessful envelope to UPSTREAM_ERROR', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: null, success: false, state: 50000, message: '失败' }),
    ) as unknown as typeof fetch;
    const client = new NbsClient({ fetchImpl, minIntervalMs: 0, jitterMs: 0, maxRetries: 0 });

    await expect(client.request('/query')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });

  it('opens the circuit after repeated retryable failures and recovers after cooldown', async () => {
    let now = 0;
    const fetchImpl = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const client = new NbsClient({
      fetchImpl,
      minIntervalMs: 0,
      jitterMs: 0,
      maxRetries: 0,
      circuitBreaker: { failureThreshold: 2, cooldownMs: 1_000 },
      now: () => now,
    });

    await expect(client.request('/query')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    await expect(client.request('/query')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    await expect(client.request('/query')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = 1_000;
    await expect(client.request('/query')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(client.request('/query')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
  });

  it('passes an optional dispatcher to the fetch implementation', async () => {
    const dispatcher = { kind: 'proxy-agent' };
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
      return jsonResponse({ data: { ok: true }, success: true, state: 20000, message: '成功' });
    }) as unknown as typeof fetch;
    const client = new NbsClient({
      fetchImpl,
      dispatcher,
      minIntervalMs: 0,
      jitterMs: 0,
      maxRetries: 0,
    });

    await expect(client.request<{ ok: boolean }>('/query')).resolves.toEqual({ ok: true });
  });
});
