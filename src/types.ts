/**
 * Wire types. Field names are exactly what the REST API sends and accepts
 * (snake_case), so the API reference and the SDK share one vocabulary.
 *
 * Responses are typed as "known fields plus anything else": the API adds
 * fields over time and the SDK must not hide them.
 */

export type Json = Record<string, unknown>;

export interface ClientOptions {
  /** Defaults to https://api.mecentral.org/v1 */
  baseUrl?: string;
  /** A member connection token (mec_tok_…) for the People Graph endpoints. */
  connectionToken?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  maxRetries?: number;
  /** Custom fetch (e.g. undici, a polyfill, or a test double). */
  fetch?: typeof fetch;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------- vault

export interface ListDocumentsParams {
  /** 1..100, default 10 */
  limit?: number;
  offset?: number;
}

export interface DocumentSummary extends Json {
  document_id?: string;
  filename?: string;
  display_name?: string;
  mime_type?: string;
  size?: number;
  created_at?: string;
}

export interface ListDocumentsResponse extends Json {
  success: true;
  integration: string;
  account_id: number;
  documents: DocumentSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentResponse extends Json {
  success: true;
  document: Json;
}

export type ExpiryPolicy =
  | { policy: 'until_revoked' }
  | { policy: 'fixed_date'; date: string }
  | { policy: 'age_based'; age: number }
  | { policy: 'life_event'; event: string };

export interface GrantSpec {
  /** Email address of the grantee. Never a bare user id. */
  user: string;
  /** e.g. co_owner, educational_delegate, guardian_full */
  scope: string;
  /** "YYYY-MM-DD HH:MM:SS"; clamped to 18 months. */
  expires_at?: string;
  purpose?: string;
  /** parent_guardian, co_parent, foster_parent, agency, trustee, … */
  relationship?: string;
  expiry?: ExpiryPolicy;
}

export interface ReleaseCondition {
  policy: 'fixed_date' | 'age_based' | 'life_event';
  date?: string;
  age?: number;
  event?: string;
  custodian_visibility?: 'metadata' | 'contents';
}

export type CollectionSpec =
  | string
  | { name: string; for?: Array<'subject' | string>; color?: string; description?: string };

export interface SubjectIdentity {
  full_name: string;
  /** YYYY-MM-DD */
  dob?: string;
}

export interface DepositOnBehalfParams {
  subject_email?: string;
  subject_binding_token?: string;
  subject_identity?: SubjectIdentity;
  subject_external_id?: string;
  subject_role?: string;
  filename: string;
  mime_type: string;
  /** Base64 of the file bytes. `depositOnBehalf` fills this from `content` when given. */
  content_base64?: string;
  display_name?: string;
  hold_expires_at?: string;
  tags?: string[];
  grants?: GrantSpec[];
  release?: ReleaseCondition;
  collections?: CollectionSpec[];
  proof_challenge?: { hint: string; answer: string };
  content_credential?: { signer: 'self' | 'third_party' };
  [extra: string]: unknown;
}

export interface DepositAccepted extends Json {
  success: true;
  job_id: string;
  status: 'pending';
  existing: boolean;
  document_id: string | null;
  poll: string;
  webhook_event: 'deposit.completed';
}

export type DepositJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AppliedGrant extends Json {
  user_id?: number;
  scope?: string;
  expires_at?: string | null;
  clamped?: boolean;
  already_active?: boolean;
  document_id?: string;
}

export interface GrantError extends Json {
  document_id?: string;
  user?: string;
  scope?: string;
  error: string;
}

export interface DepositStatusResponse extends Json {
  success: true;
  status: DepositJobStatus;
  job_id?: string;
  document_id?: string | null;
  owner_user_id?: number;
  held_vault?: boolean;
  subject_binding_token?: string;
  provisioned_grantees?: Array<{ user_id: number }>;
  grants?: AppliedGrant[];
  grant_errors?: GrantError[];
  collections?: Json[];
  collection_errors?: Json[];
  provenance?: Json;
  error?: string;
}

export interface RecallParams {
  job_id: string;
  reason?: string;
}

export interface RecallResponse extends Json {
  success: true;
  state: 'cancelled' | 'recalled_preclaim' | 'recalled_postclaim' | 'already_recalled' | 'already_expired' | string;
}

export interface SubjectUpdateParams {
  subject_email?: string;
  document_id?: string;
  /** YYYY-MM-DD */
  date_of_birth: string;
  full_name?: string;
  reason?: string;
}

export interface SubjectUpdateResponse extends Json {
  success: true;
  date_of_birth: string;
  grants_resolved: number;
  releases_resolved: number;
  custody_state: Json;
}

export interface RevokeSubjectBindingParams {
  binding_token: string;
  reason?: string;
}

// -------------------------------------------------------------- custody

export interface CustodyGrantParams {
  document_ids: string[];
  grants: GrantSpec[];
}

export interface CustodyRevokeParams {
  document_ids: string[];
  grants: Array<Pick<GrantSpec, 'user' | 'scope'>>;
  reason?: string;
}

export interface CustodyGrantResponse extends Json {
  success: true;
  documents: number;
  applied: number;
  grants: AppliedGrant[];
  grant_errors: GrantError[];
}

export interface CustodyReplaceParams {
  subject_email?: string;
  document_id?: string;
  /** Outgoing custodian's email */
  from: string;
  /** Incoming custodian's email */
  to: string;
  scope: string;
  relationship?: string;
  expiry?: ExpiryPolicy;
  reason?: string;
}

export interface CustodyReplaceResponse extends Json {
  success: true;
  documents: number;
  replaced: number;
  custody_state: Json;
  errors: Json[];
}

export interface CustodyDisputeParams {
  subject_email?: string;
  document_id?: string;
  reason: string;
}

export interface CustodyEventParams {
  subject_email?: string;
  document_id?: string;
  /** a-z, 0-9, underscore. graduation, marriage, emancipation, placement_end, court_order, majority, death, … */
  event: string;
  evidence?: string;
  note?: string;
}

export interface CustodyEventResponse extends Json {
  success: true;
  event: string;
  grants_ended: number;
  releases_met: number;
  custody_state: Json;
}

export interface ListCustodyEventsParams {
  subject_email?: string;
  document_id?: string;
  /** 1..200, default 50 */
  limit?: number;
}

// ---------------------------------------------------------- connections

export interface ConnectionRequestResponse extends Json {
  success: true;
  connection_id: string;
}

export interface ConnectionVerifyResponse extends Json {
  success: true;
  token: string;
  user_id: number;
  email: string;
}

// --------------------------------------------------------------- people

export interface FactSpec {
  key: string;
  value: string;
  /** default 'confirmed' */
  source?: string;
  note?: string;
}

export interface CreatePersonParams {
  full_name: string;
  /** YYYY-MM-DD */
  date_of_birth?: string;
  jurisdiction?: string;
  /** The NEW person's role toward the member, e.g. biological_child, spouse. */
  relationship?: string;
  facts?: FactSpec[];
}

export interface UpdatePersonParams {
  full_name?: string;
  date_of_birth?: string | null;
  jurisdiction?: string | null;
  relationship?: string | null;
}

export interface Person extends Json {
  person_id: string;
  full_name: string;
  date_of_birth?: string | null;
  jurisdiction?: string | null;
  is_self?: boolean;
  relationship?: string | null;
  facts?: Json[];
}

export interface FactsOutcome {
  applied: Json[];
  rejected: Json[];
}

// ------------------------------------------------------------- webhooks

export type WebhookEventType =
  | 'deposit.completed'
  | 'deposit.failed'
  | 'deposit.expired'
  | 'deposit.recalled'
  | 'custody.granted'
  | 'custody.revoked'
  | 'custody.expiring'
  | 'subject.bound'
  | 'vault.claimed'
  | '*';

export interface WebhookEndpoint extends Json {
  id: string;
  url: string;
  enabled_events: string[];
  description?: string | null;
  disabled?: boolean;
  created_at?: string;
}

export interface CreateWebhookParams {
  url: string;
  enabled_events: WebhookEventType[] | string[];
  description?: string;
}

export interface UpdateWebhookParams {
  url?: string;
  enabled_events?: WebhookEventType[] | string[];
  description?: string;
  disabled?: boolean;
}

export interface CreateWebhookResponse extends Json {
  success: true;
  endpoint: WebhookEndpoint;
  /** Returned once. Store it; it is the HMAC key for every delivery. */
  secret: string;
}

export interface WebhookEvent<T extends Json = Json> {
  /** From X-MeCentral-Event */
  type: string;
  /** Unix seconds, from X-MeCentral-Timestamp */
  timestamp: number;
  /** Decoded JSON body */
  data: T;
  /** The raw body as delivered */
  raw: string;
}

// --------------------------------------------------------- integrations

export interface RegisterSigningCertificateParams {
  certificate_pem: string;
  label?: string;
}

export interface RevokeSigningCertificateParams {
  fingerprint_sha256: string;
  reason?: string;
}

export interface ProvisionSandboxParams {
  /** Operator secret (INTEGRATION_PROVISION_TOKEN). Not an API key. */
  token: string;
  /** Hostname or stable id, [a-z0-9.-] */
  slug: string;
  name?: string;
  purpose?: string;
  scopes?: string[];
  /** 'sandbox' (default, mec_sbx_) or 'production' (mec_prd_; needs the door's production switch AND operator_reason). */
  mode?: 'sandbox' | 'production';
  /** Required with mode 'production', or when scopes names a self-grantable operator scope. ≤200 chars, recorded. */
  operator_reason?: string;
  /** sandbox 1..180 (default 90); production 1..366 (default 365) */
  ttl_days?: number;
  rotate?: boolean;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ProvisionSandboxResponse extends Json {
  success: true;
  created: boolean;
  integration: Json & { id: number; slug: string; mode: 'sandbox' | 'production'; scopes: string[] };
  key: Json & { id: number; key: string; prefix: string; suffix: string; mode: 'sandbox' | 'production'; expires_at: string };
  rotated_out: number[];
}
