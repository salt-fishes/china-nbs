import type { ErrorCode, QueryError } from './types.js';

/** Error with a stable code and a user-facing hint. */
export class NbsError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; hint?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'NbsError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export function isNbsError(error: unknown): error is NbsError {
  return error instanceof NbsError;
}

export function toQueryError(error: unknown): QueryError {
  if (isNbsError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'ABORTED',
      message: '查询已取消',
      retryable: false,
      hint: '如果这是超时导致的，请增大 totalTimeoutMs 或稍后重试。',
    };
  }

  return {
    code: 'UPSTREAM_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    hint: '这是未预期的错误；请稍后重试，或运行 CLI 时加 --debug 查看详情。',
  };
}

export function invalidArgument(message: string, hint?: string): NbsError {
  return new NbsError('INVALID_ARGUMENT', message, { hint });
}

export function notFound(message: string, hint?: string, details?: unknown): NbsError {
  return new NbsError('NOT_FOUND', message, { hint, details });
}

export function ambiguous(message: string, hint?: string, details?: unknown): NbsError {
  return new NbsError('AMBIGUOUS', message, { hint, details });
}

export function invalidRange(message: string, hint?: string): NbsError {
  return new NbsError('INVALID_RANGE', message, { hint });
}

export function upstreamBlocked(status: number, bodySnippet?: string): NbsError {
  return new NbsError('UPSTREAM_BLOCKED', `国家统计局接口返回 ${status}，可能被 WAF 拦截`, {
    retryable: false,
    hint: '不要循环重试。稍后再试，或改用 web 搜索新闻/解读；不要把旧 EasyQuery 当作 fallback。',
    details: bodySnippet ? { bodySnippet } : undefined,
  });
}

export function upstreamError(status: number, message: string, details?: unknown): NbsError {
  return new NbsError('UPSTREAM_ERROR', message || `国家统计局接口返回 ${status}`, {
    retryable: status >= 500 || status === 429,
    hint: '接口可能处于试运行期或不稳定；已自动重试一次，仍失败可稍后再试。',
    details,
  });
}

export function parseError(message: string, details?: unknown): NbsError {
  return new NbsError('PARSE_ERROR', message, {
    retryable: false,
    hint: '接口结构可能已改版；请查看 docs/contracts.md 并用最新响应更新解析器。',
    details,
  });
}

export function timeoutError(timeoutMs: number): NbsError {
  return new NbsError('TIMEOUT', `请求超时（${timeoutMs}ms）`, {
    retryable: true,
    hint: '国家统计局接口在试运行期可能较慢；可增大 timeoutMs 或稍后重试。',
  });
}

export function circuitOpenError(retryAfterMs: number, failures: number, path?: string): NbsError {
  return new NbsError('CIRCUIT_OPEN', '上游连续失败，熔断器已打开', {
    retryable: true,
    hint: `请等待约 ${Math.ceil(retryAfterMs / 1000)} 秒后再试，或检查网络/代理配置。`,
    details: {
      path,
      failures,
      retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)),
    },
  });
}
