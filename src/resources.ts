/**
 * Resource groups. Each wraps one family of /v1 endpoints and does nothing
 * but shape the call: paths, methods, query strings, and a couple of
 * conveniences (bytes → base64, poll until a deposit settles).
 */

import { DepositTimeoutError } from './errors.js';
import type { Transport } from './http.js';
import type {
  ConnectionRequestResponse,
  ConnectionVerifyResponse,
  CreatePersonParams,
  CreateWebhookParams,
  CreateWebhookResponse,
  CustodyDisputeParams,
  CustodyEventParams,
  CustodyEventResponse,
  CustodyGrantParams,
  CustodyGrantResponse,
  CustodyReplaceParams,
  CustodyReplaceResponse,
  CustodyRevokeParams,
  DepositAccepted,
  DepositOnBehalfParams,
  DepositStatusResponse,
  DocumentResponse,
  FactSpec,
  FactsOutcome,
  Json,
  ListCustodyEventsParams,
  ListDocumentsParams,
  ListDocumentsResponse,
  Person,
  RecallParams,
  RecallResponse,
  RegisterSigningCertificateParams,
  RevokeSigningCertificateParams,
  RevokeSubjectBindingParams,
  SubjectUpdateParams,
  SubjectUpdateResponse,
  UpdatePersonParams,
  UpdateWebhookParams,
  WebhookEndpoint,
} from './types.js';

function toBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Node
  const B = (globalThis as { Buffer?: { from(a: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(u8).toString('base64');
  // Browser
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  }
  return btoa(s);
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

// ---------------------------------------------------------------- vault

export class VaultResource {
  constructor(private readonly t: Transport) {}

  /** GET /vault/documents — documents this integration's account owns. Scope: vault.read */
  listDocuments(params: ListDocumentsParams = {}): Promise<ListDocumentsResponse> {
    return this.t.request({ method: 'GET', path: '/vault/documents', query: { limit: params.limit, offset: params.offset } });
  }

  /** GET /vault/documents/{id} — metadata and custody facts for a document you deposited. Scope: vault.read */
  getDocument(documentId: string): Promise<DocumentResponse> {
    return this.t.request({ method: 'GET', path: `/vault/documents/${enc(documentId)}` });
  }

  /** GET /vault/documents/{id}/stream — the bytes. Scopes: vault.read + custody.read */
  downloadDocument(documentId: string): Promise<Uint8Array> {
    return this.t.request({ method: 'GET', path: `/vault/documents/${enc(documentId)}/stream`, raw: true, headers: { Accept: '*/*' } });
  }

  /**
   * POST /vault/deposit-on-behalf — file a document into its subject's vault.
   * Pass `content` (bytes) or `content_base64`. Returns 202 with a job_id;
   * use `waitForDeposit` or `depositStatus` to learn the outcome.
   * Scopes: vault.deposit_on_behalf, plus custody.grant when `grants` is non-empty.
   */
  depositOnBehalf(params: DepositOnBehalfParams & { content?: Uint8Array | ArrayBuffer }): Promise<DepositAccepted> {
    const { content, ...body } = params;
    if (content !== undefined && body.content_base64 === undefined) body.content_base64 = toBase64(content);
    if (body.content_base64 === undefined) throw new TypeError('depositOnBehalf needs `content` (bytes) or `content_base64`');
    return this.t.request({ method: 'POST', path: '/vault/deposit-on-behalf', body });
  }

  /** GET /vault/deposit-status?job_id= — the source of truth for a deposit. Scope: vault.deposit_on_behalf */
  depositStatus(jobId: string): Promise<DepositStatusResponse> {
    return this.t.request({ method: 'GET', path: '/vault/deposit-status', query: { job_id: jobId } });
  }

  /**
   * Poll deposit-status until the job is completed or failed.
   * Resolves with the final status; a failed job resolves too (check `status`),
   * so callers can read grant_errors and provenance either way.
   */
  async waitForDeposit(jobId: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<DepositStatusResponse> {
    const interval = Math.max(500, opts.intervalMs ?? 2000);
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    let last: DepositStatusResponse | null = null;
    for (;;) {
      last = await this.depositStatus(jobId);
      if (last.status === 'completed' || last.status === 'failed') return last;
      if (Date.now() + interval > deadline) throw new DepositTimeoutError(jobId, last);
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** POST /vault/recall — cancel, un-hold, or contain a deposit. Idempotent. Scope: vault.deposit_on_behalf */
  recallDeposit(params: RecallParams): Promise<RecallResponse> {
    return this.t.request({ method: 'POST', path: '/vault/recall', body: params });
  }

  /** POST /vault/subject-update — supply or correct a subject's date of birth. Scopes: vault.deposit_on_behalf + custody.grant */
  updateSubject(params: SubjectUpdateParams): Promise<SubjectUpdateResponse> {
    return this.t.request({ method: 'POST', path: '/vault/subject-update', body: params });
  }

  /** DELETE /vault/subject-bindings — revoke a TrueRoute binding token. Idempotent. Scope: vault.deposit_on_behalf */
  revokeSubjectBinding(params: RevokeSubjectBindingParams): Promise<Json> {
    return this.t.request({ method: 'DELETE', path: '/vault/subject-bindings', body: params });
  }
}

// -------------------------------------------------------------- custody

export class CustodyResource {
  constructor(private readonly t: Transport) {}

  /** POST /custody/grants — attach grants to deposited documents. Per-item failures are in grant_errors. Scope: custody.grant */
  grant(params: CustodyGrantParams): Promise<CustodyGrantResponse> {
    return this.t.request({ method: 'POST', path: '/custody/grants', body: params });
  }

  /** DELETE /custody/grants — revoke (tombstone) grants. Idempotent. Scope: custody.grant */
  revoke(params: CustodyRevokeParams): Promise<CustodyGrantResponse> {
    return this.t.request({ method: 'DELETE', path: '/custody/grants', body: params });
  }

  /** POST /custody/replace — end one custodian's authority and start another's atomically. Scope: custody.replace */
  replace(params: CustodyReplaceParams): Promise<CustodyReplaceResponse> {
    return this.t.request({ method: 'POST', path: '/custody/replace', body: params });
  }

  /** POST /custody/dispute — suspend every grant on a vault pending human review. Idempotent. Scope: custody.events */
  dispute(params: CustodyDisputeParams): Promise<Json & { custody_state: Json }> {
    return this.t.request({ method: 'POST', path: '/custody/dispute', body: params });
  }

  /** POST /custody/events — assert a life event and resolve every term bound to it. Scope: custody.events */
  assertEvent(params: CustodyEventParams): Promise<CustodyEventResponse> {
    return this.t.request({ method: 'POST', path: '/custody/events', body: params });
  }

  /** GET /custody/events — the custody ledger for a vault, as this integration may see it. Scope: custody.events */
  listEvents(params: ListCustodyEventsParams): Promise<Json & { events: Json[] }> {
    return this.t.request({ method: 'GET', path: '/custody/events', query: { ...params } });
  }
}

// ---------------------------------------------------------- connections

export class ConnectionsResource {
  constructor(private readonly t: Transport) {}

  /** POST /connections/request — ask a member to connect; MeCentral sends them an OTP. */
  request(email: string): Promise<ConnectionRequestResponse> {
    return this.t.request({ method: 'POST', path: '/connections/request', body: { email } });
  }

  /** POST /connections/verify — exchange the OTP for a member token (mec_tok_…). */
  verify(connectionId: string, otp: string): Promise<ConnectionVerifyResponse> {
    return this.t.request({ method: 'POST', path: '/connections/verify', body: { connection_id: connectionId, otp } });
  }
}

// --------------------------------------------------------------- people

/**
 * A connected member's People Graph. Every call needs a connection token;
 * build the client with `connectionToken` or use `client.withConnection()`.
 * Scope: people.write
 */
export class PeopleResource {
  constructor(private readonly t: Transport) {}

  /** GET /people */
  list(): Promise<Json & { people: Person[] }> {
    return this.t.request({ method: 'GET', path: '/people' });
  }

  /** POST /people — 201. A bad `relationship` code is reported, not fatal. */
  create(params: CreatePersonParams): Promise<Json & { person: Person; relationship: Json | null; relationship_error: string | null; facts: FactsOutcome }> {
    return this.t.request({ method: 'POST', path: '/people', body: params });
  }

  /** GET /people/{person_id} */
  get(personId: string): Promise<Json & { person: Person }> {
    return this.t.request({ method: 'GET', path: `/people/${enc(personId)}` });
  }

  /** PATCH /people/{person_id} — answers with the resulting state. */
  update(personId: string, params: UpdatePersonParams): Promise<Json & { person: Person }> {
    return this.t.request({ method: 'PATCH', path: `/people/${enc(personId)}`, body: params });
  }

  /** DELETE /people/{person_id} — tombstone. Idempotent (already_removed). */
  remove(personId: string, reason?: string): Promise<Json & { person_id: string; already_removed?: boolean }> {
    return this.t.request({ method: 'DELETE', path: `/people/${enc(personId)}`, body: reason ? { reason } : undefined });
  }

  /** GET /people/{person_id}/facts */
  listFacts(personId: string): Promise<Json & { person_id: string; facts: Json[] }> {
    return this.t.request({ method: 'GET', path: `/people/${enc(personId)}/facts` });
  }

  /** POST /people/{person_id}/facts — confirm facts; malformed ones land in `rejected`. */
  confirmFacts(personId: string, facts: FactSpec[]): Promise<Json & { person_id: string; facts: FactsOutcome }> {
    return this.t.request({ method: 'POST', path: `/people/${enc(personId)}/facts`, body: { facts } });
  }
}

// ------------------------------------------------------------- webhooks

/** Endpoint registration. Scope: webhooks.manage. Verification lives in `Webhooks` (webhooks.ts). */
export class WebhooksResource {
  constructor(private readonly t: Transport) {}

  /** GET /webhooks/endpoints */
  list(): Promise<Json & { data: WebhookEndpoint[] }> {
    return this.t.request({ method: 'GET', path: '/webhooks/endpoints' });
  }

  /** POST /webhooks/endpoints — 201. The `secret` in the response is shown once. */
  create(params: CreateWebhookParams): Promise<CreateWebhookResponse> {
    return this.t.request({ method: 'POST', path: '/webhooks/endpoints', body: params });
  }

  /** GET /webhooks/endpoints/{id} */
  get(endpointId: string): Promise<Json & { endpoint: WebhookEndpoint }> {
    return this.t.request({ method: 'GET', path: `/webhooks/endpoints/${enc(endpointId)}` });
  }

  /** PATCH /webhooks/endpoints/{id} — absent fields are untouched. */
  update(endpointId: string, params: UpdateWebhookParams): Promise<Json & { endpoint: WebhookEndpoint }> {
    return this.t.request({ method: 'PATCH', path: `/webhooks/endpoints/${enc(endpointId)}`, body: params });
  }

  /** DELETE /webhooks/endpoints/{id} */
  delete(endpointId: string): Promise<Json & { deleted: boolean }> {
    return this.t.request({ method: 'DELETE', path: `/webhooks/endpoints/${enc(endpointId)}` });
  }

  /** GET /webhooks/events — the catalog registration validates against. Any valid key. */
  eventTypes(): Promise<Json & { data: Array<{ type: string; description: string }>; wildcard: string }> {
    return this.t.request({ method: 'GET', path: '/webhooks/events' });
  }
}

// --------------------------------------------------------- integrations

/** Scope: vault.deposit_on_behalf */
export class IntegrationsResource {
  constructor(private readonly t: Transport) {}

  /** GET /integrations/signing-certificates */
  listSigningCertificates(): Promise<Json & { certificates: Json[] }> {
    return this.t.request({ method: 'GET', path: '/integrations/signing-certificates' });
  }

  /** POST /integrations/signing-certificates — only the fingerprint is kept. */
  registerSigningCertificate(params: RegisterSigningCertificateParams): Promise<Json> {
    return this.t.request({ method: 'POST', path: '/integrations/signing-certificates', body: params });
  }

  /** DELETE /integrations/signing-certificates — tombstone. */
  revokeSigningCertificate(params: RevokeSigningCertificateParams): Promise<Json> {
    return this.t.request({ method: 'DELETE', path: '/integrations/signing-certificates', body: params });
  }
}
