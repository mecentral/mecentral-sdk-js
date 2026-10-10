/**
 * MeCentral — the client.
 *
 *   import { MeCentral } from '@mecentral/sdk';
 *   const mc = new MeCentral(process.env.MECENTRAL_API_KEY);
 *   const { documents } = await mc.vault.listDocuments({ limit: 20 });
 *
 * Authentication is the X-API-Key header. Keys are mec_sbx_… (sandbox),
 * mec_prd_… (production) or mec_dev_… (legacy). The People Graph endpoints
 * additionally need a member connection token (mec_tok_…) obtained through
 * `connections.request` + `connections.verify`; pass it as `connectionToken`
 * or derive a bound client with `withConnection(token)`.
 */

import { Transport } from './http.js';
import {
  ConnectionsResource,
  CustodyResource,
  IntegrationsResource,
  PeopleResource,
  VaultResource,
  WebhooksResource,
} from './resources.js';
import type { ClientOptions, ProvisionSandboxParams, ProvisionSandboxResponse } from './types.js';
import { MeCentralError, ConnectionError } from './errors.js';

export const SDK_VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'https://api.mecentral.org/v1';

const KEY_PATTERN = /^mec_(sbx|prd|dev)_[0-9a-f]{32,64}$/;

function resolveFetch(custom?: typeof fetch): typeof fetch {
  const f = custom ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) {
    throw new TypeError('No fetch implementation found. Use Node 18+ or pass { fetch } in the client options.');
  }
  return f;
}

export class MeCentral {
  readonly baseUrl: string;
  readonly vault: VaultResource;
  readonly custody: CustodyResource;
  readonly connections: ConnectionsResource;
  readonly people: PeopleResource;
  readonly webhooks: WebhooksResource;
  readonly integrations: IntegrationsResource;

  private readonly apiKey: string;
  private readonly options: ClientOptions;

  constructor(apiKey: string, options: ClientOptions = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new TypeError('MeCentral(apiKey): an API key is required');
    }
    if (!KEY_PATTERN.test(apiKey)) {
      throw new TypeError('MeCentral(apiKey): keys look like mec_sbx_… or mec_prd_… followed by 32–64 hex characters');
    }
    this.apiKey = apiKey;
    this.options = options;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

    const headers: Record<string, string> = {
      'X-API-Key': apiKey,
      Accept: 'application/json',
      'User-Agent': `mecentral-sdk-js/${SDK_VERSION}`,
      ...(options.headers ?? {}),
    };
    if (options.connectionToken) {
      headers['Authorization'] = `Bearer ${options.connectionToken}`;
    }

    const transport = new Transport({
      baseUrl: this.baseUrl,
      headers,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: Math.max(0, options.maxRetries ?? 2),
      fetch: resolveFetch(options.fetch),
    });

    this.vault = new VaultResource(transport);
    this.custody = new CustodyResource(transport);
    this.connections = new ConnectionsResource(transport);
    this.people = new PeopleResource(transport);
    this.webhooks = new WebhooksResource(transport);
    this.integrations = new IntegrationsResource(transport);
  }

  /**
   * A client bound to one connected member. Same key and options, plus the
   * member's mec_tok_… on every request. Use it for `people.*`.
   */
  withConnection(connectionToken: string): MeCentral {
    return new MeCentral(this.apiKey, { ...this.options, connectionToken });
  }

  /**
   * Self-service provisioning for build sessions: SANDBOX by default, or
   * PRODUCTION (mec_prd_) with `mode: 'production'` plus an `operator_reason`
   * when the door's operator has switched production on. Authenticates with
   * the operator token, not an API key, so it is static. The door answers
   * only to allowlisted source addresses. The raw key is in the response and
   * nowhere else.
   */
  static async provisionSandbox(params: ProvisionSandboxParams): Promise<ProvisionSandboxResponse> {
    const { token, baseUrl, fetch: customFetch, ...body } = params;
    const f = resolveFetch(customFetch);
    const url = `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/integrations/provision`;
    let res: Response;
    try {
      res = await f(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': `mecentral-sdk-js/${SDK_VERSION}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ConnectionError(`Connection failed: ${(err as Error)?.message ?? err}`, err);
    }
    const text = await res.text();
    let decoded: unknown = text;
    try {
      decoded = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    if (!res.ok) throw MeCentralError.fromResponse(res.status, decoded, res.headers);
    return decoded as ProvisionSandboxResponse;
  }
}
