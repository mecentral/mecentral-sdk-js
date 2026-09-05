/**
 * Webhook delivery verification.
 *
 * Every delivery carries:
 *   X-MeCentral-Event:     deposit.completed
 *   X-MeCentral-Timestamp: 1785000000
 *   X-MeCentral-Signature: sha256=<hex>
 *
 * where the signature is HMAC-SHA256 over "<timestamp>.<raw body>" keyed
 * with the endpoint secret returned once at registration. The timestamp is
 * inside the signed string so a captured delivery cannot be replayed later.
 *
 * Use the RAW request body. Re-serialising parsed JSON changes bytes and
 * breaks the signature.
 */

import { SignatureVerificationError } from './errors.js';
import type { Json, WebhookEvent } from './types.js';

export type HeaderBag = Record<string, string | string[] | undefined> | Headers;

export interface VerifyOptions {
  /** Seconds either side of now a delivery is accepted. Default 300. */
  toleranceSeconds?: number;
  /** Injectable clock (unix seconds) for tests. */
  now?: () => number;
}

function header(headers: HeaderBag, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(bag)) {
    if (k.toLowerCase() === want) {
      if (Array.isArray(v)) return v[0] ?? null;
      return v ?? null;
    }
  }
  return null;
}

function bodyToString(body: string | Uint8Array | ArrayBuffer): string {
  if (typeof body === 'string') return body;
  const u8 = body instanceof Uint8Array ? body : new Uint8Array(body);
  return new TextDecoder().decode(u8);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const key = await subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return new Uint8Array(sig);
  }
  // Older Node without a global WebCrypto.
  const nodeCrypto = await import('node:crypto');
  return new Uint8Array(nodeCrypto.createHmac('sha256', secret).update(message).digest());
}

export class Webhooks {
  /**
   * Verify a delivery and return the parsed event. Throws
   * SignatureVerificationError on any failure (missing header, bad
   * signature, stale timestamp, unparseable body).
   */
  static async constructEvent<T extends Json = Json>(
    rawBody: string | Uint8Array | ArrayBuffer,
    headers: HeaderBag,
    secret: string,
    opts: VerifyOptions = {},
  ): Promise<WebhookEvent<T>> {
    if (!secret) throw new SignatureVerificationError('Webhook secret is empty');

    const sigHeader = header(headers, 'X-MeCentral-Signature');
    const tsHeader = header(headers, 'X-MeCentral-Timestamp');
    const type = header(headers, 'X-MeCentral-Event');
    if (!sigHeader) throw new SignatureVerificationError('Missing X-MeCentral-Signature header');
    if (!tsHeader || !/^\d+$/.test(tsHeader)) throw new SignatureVerificationError('Missing or malformed X-MeCentral-Timestamp header');
    if (!type) throw new SignatureVerificationError('Missing X-MeCentral-Event header');

    const m = /^sha256=([0-9a-f]{64})$/i.exec(sigHeader.trim());
    if (!m) throw new SignatureVerificationError('Malformed X-MeCentral-Signature header');

    const tolerance = opts.toleranceSeconds ?? 300;
    const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);
    const ts = parseInt(tsHeader, 10);
    if (Math.abs(now - ts) > tolerance) {
      throw new SignatureVerificationError(`Timestamp outside tolerance (${Math.abs(now - ts)}s > ${tolerance}s)`);
    }

    const raw = bodyToString(rawBody);
    const expected = await hmacSha256(secret, `${ts}.${raw}`);
    if (!constantTimeEqual(expected, hexToBytes(m[1]!.toLowerCase()))) {
      throw new SignatureVerificationError('Signature mismatch');
    }

    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch {
      throw new SignatureVerificationError('Body is not valid JSON');
    }
    return { type, timestamp: ts, data, raw };
  }

  /** Boolean form of constructEvent for callers that do not want exceptions. */
  static async verify(rawBody: string | Uint8Array | ArrayBuffer, headers: HeaderBag, secret: string, opts: VerifyOptions = {}): Promise<boolean> {
    try {
      await Webhooks.constructEvent(rawBody, headers, secret, opts);
      return true;
    } catch (e) {
      if (e instanceof SignatureVerificationError) return false;
      throw e;
    }
  }

  /**
   * Produce the headers MeCentral would send for a body, for tests and for
   * simulating deliveries against your own receiver.
   */
  static async sign(rawBody: string, secret: string, opts: { event?: string; timestamp?: number } = {}): Promise<Record<string, string>> {
    const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
    const mac = await hmacSha256(secret, `${ts}.${rawBody}`);
    const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
    return {
      'X-MeCentral-Event': opts.event ?? 'deposit.completed',
      'X-MeCentral-Timestamp': String(ts),
      'X-MeCentral-Signature': `sha256=${hex}`,
    };
  }
}
