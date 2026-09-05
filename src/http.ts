/**
 * HTTP transport: one place that knows about headers, JSON, timeouts, and
 * retries. Every resource method goes through `request()`.
 *
 * Retry policy (see README "Retries"):
 *   - 429 is retried for every method, honouring Retry-After.
 *   - 503 is retried for every method (the edge refused before processing).
 *   - 502 / 504 and transport failures are retried for GET and DELETE only.
 *     A POST that timed out may have been processed; the caller decides.
 */

import { ConnectionError, MeCentralError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Return the raw bytes instead of decoding JSON. */
  raw?: boolean;
  /** Per-call override of the client timeout. */
  timeoutMs?: number;
  /** Per-call override of the client retry budget. */
  maxRetries?: number;
}

export interface TransportConfig {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set(['GET', 'DELETE']);
const MAX_BACKOFF_MS = 8000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(base + rel);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function backoffMs(attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null && retryAfter >= 0) return Math.min(retryAfter * 1000, 60_000);
  const base = 400 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(base + jitter, MAX_BACKOFF_MS);
}

async function decodeBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json') || text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export class Transport {
  private readonly cfg: TransportConfig;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(cfg: TransportConfig) {
    this.cfg = cfg;
    this.sleep = cfg.sleep ?? defaultSleep;
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = buildUrl(this.cfg.baseUrl, opts.path, opts.query);
    const headers: Record<string, string> = { ...this.cfg.headers, ...(opts.headers ?? {}) };
    let bodyText: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyText = JSON.stringify(opts.body);
    }
    const maxRetries = opts.maxRetries ?? this.cfg.maxRetries;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    const idempotent = IDEMPOTENT.has(opts.method);

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        // Never follow redirects: a JSON API that answers 3xx is misconfigured,
        // and a followed 301 silently turns a POST into a GET.
        res = await this.cfg.fetch(url, {
          method: opts.method,
          headers,
          body: bodyText,
          signal: controller.signal,
          redirect: 'manual',
        });
      } catch (err) {
        clearTimeout(timer);
        const aborted = err instanceof Error && err.name === 'AbortError';
        const conn = new ConnectionError(
          aborted ? `Request timed out after ${timeoutMs}ms` : `Connection failed: ${(err as Error)?.message ?? err}`,
          err,
        );
        if (idempotent && attempt < maxRetries) {
          await this.sleep(backoffMs(attempt, null));
          continue;
        }
        throw conn;
      }
      clearTimeout(timer);

      if (res.ok) {
        if (opts.raw) return new Uint8Array(await res.arrayBuffer()) as unknown as T;
        return (await decodeBody(res)) as T;
      }

      // Browsers report a manual redirect as an opaque status 0; Node keeps the 3xx.
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        const location = res.headers.get('location');
        throw new MeCentralError({
          status: res.status || 300,
          message: `Unexpected redirect from ${url}${location ? ` to ${location}` : ''}; the SDK never follows redirects`,
          body: null,
        });
      }

      const body = await decodeBody(res);
      const error = MeCentralError.fromResponse(res.status, body, res.headers);
      const retryable =
        res.status === 429 || res.status === 503 || (idempotent && (res.status === 502 || res.status === 504));
      if (retryable && attempt < maxRetries) {
        await this.sleep(backoffMs(attempt, error.retryAfter));
        continue;
      }
      throw error;
    }
  }
}
