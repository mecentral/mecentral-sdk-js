/**
 * Error types raised by the MeCentral SDK.
 *
 * Every HTTP failure becomes a MeCentralError (or one of its subclasses)
 * carrying the status code, the API's `error` message, and the decoded body.
 * Transport failures (DNS, TLS, timeout) become ConnectionError with status 0.
 */

export interface MeCentralErrorOptions {
  status: number;
  message: string;
  code?: string | null;
  body?: unknown;
  retryAfter?: number | null;
  requestId?: string | null;
}

export class MeCentralError extends Error {
  /** HTTP status code; 0 for transport failures. */
  readonly status: number;
  /** Machine code from the API body (`code`), when one was sent. */
  readonly code: string | null;
  /** Decoded response body, or the raw text when it was not JSON. */
  readonly body: unknown;
  /** Seconds to wait before retrying, from Retry-After or the body. */
  readonly retryAfter: number | null;
  readonly requestId: string | null;

  constructor(opts: MeCentralErrorOptions) {
    super(opts.message);
    this.name = new.target.name;
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.body = opts.body;
    this.retryAfter = opts.retryAfter ?? null;
    this.requestId = opts.requestId ?? null;
  }

  /**
   * Build the most specific error class for a response.
   */
  static fromResponse(status: number, body: unknown, headers: Headers | null): MeCentralError {
    let message = `HTTP ${status}`;
    let code: string | null = null;
    let retryAfter: number | null = null;

    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.error === 'string' && b.error) message = b.error;
      else if (typeof b.message === 'string' && b.message) message = b.message;
      if (typeof b.code === 'string') code = b.code;
      if (typeof b.retry_after === 'number') retryAfter = b.retry_after;
    } else if (typeof body === 'string' && body.trim()) {
      message = body.trim().slice(0, 200);
    }

    const ra = headers?.get('retry-after');
    if (ra && /^\d+$/.test(ra)) retryAfter = parseInt(ra, 10);
    const requestId = headers?.get('x-request-id') ?? null;

    const opts: MeCentralErrorOptions = { status, message, code, body, retryAfter, requestId };
    if (status === 401) return new AuthenticationError(opts);
    if (status === 403) return new PermissionError(opts);
    if (status === 404) return new NotFoundError(opts);
    if (status === 400 || status === 422) return new ValidationError(opts);
    if (status === 429) return new RateLimitError(opts);
    if (status >= 500) return new ServerError(opts);
    return new MeCentralError(opts);
  }
}

/** 401 — the key is missing, malformed, revoked, or expired. */
export class AuthenticationError extends MeCentralError {}

/** 403 — the key is valid but lacks the scope, IP, or endpoint allowance. */
export class PermissionError extends MeCentralError {}

/**
 * 404 — the resource does not exist for THIS integration. The API never
 * distinguishes "never existed" from "belongs to someone else".
 */
export class NotFoundError extends MeCentralError {}

/** 400 / 422 — the request was malformed; nothing was applied. */
export class ValidationError extends MeCentralError {}

/** 429 — per-key rate limit. `retryAfter` says how long to wait. */
export class RateLimitError extends MeCentralError {}

/** 5xx — the API failed. Safe to retry for reads; check state before re-sending writes. */
export class ServerError extends MeCentralError {}

/** The request never produced an HTTP response (DNS, TLS, timeout, abort). */
export class ConnectionError extends MeCentralError {
  constructor(message: string, cause?: unknown) {
    super({ status: 0, message, body: cause });
  }
}

/** A webhook delivery failed signature or timestamp verification. */
export class SignatureVerificationError extends MeCentralError {
  constructor(message: string) {
    super({ status: 0, message });
  }
}

/** A deposit job did not complete within the polling window. */
export class DepositTimeoutError extends MeCentralError {
  readonly jobId: string;
  readonly lastStatus: unknown;
  constructor(jobId: string, lastStatus: unknown) {
    super({ status: 0, message: `Deposit job ${jobId} did not complete in time`, body: lastStatus });
    this.jobId = jobId;
    this.lastStatus = lastStatus;
  }
}
