# @mecentral/sdk

Official MeCentral API client for Node.js 18+ and modern browsers. Zero runtime dependencies; uses the platform `fetch`.

```bash
npm install @mecentral/sdk
```

```ts
import { MeCentral } from '@mecentral/sdk';

const mc = new MeCentral(process.env.MECENTRAL_API_KEY!);

// Documents this integration's account owns
const { documents, total } = await mc.vault.listDocuments({ limit: 20 });

// File a document into its subject's vault, then wait for the worker
const accepted = await mc.vault.depositOnBehalf({
  subject_email: 'student@example.edu',
  subject_role: 'student',
  filename: 'bls-card.pdf',
  mime_type: 'application/pdf',
  content: await fs.promises.readFile('bls-card.pdf'),
  grants: [{ user: 'coordinator@school.edu', scope: 'co_owner' }],
});
const result = await mc.vault.waitForDeposit(accepted.job_id);
if (result.grant_errors?.length) console.warn(result.grant_errors);
```

## Authentication

Every request sends your key in `X-API-Key`. Keys are `mec_sbx_…` (sandbox) or `mec_prd_…` (production); both talk to the same host. Sandbox keys can be minted without a console login for proof-of-concept builds — see `MeCentral.provisionSandbox`.

```ts
const mc = new MeCentral('mec_sbx_…', {
  baseUrl: 'https://api.mecentral.org/v1', // default
  timeoutMs: 30_000,                        // default
  maxRetries: 2,                            // default
});
```

The People Graph endpoints act on a **member's** graph and need a member connection token as well:

```ts
const { connection_id } = await mc.connections.request('member@example.com');
// …the member reads the one-time code MeCentral sent them…
const { token } = await mc.connections.verify(connection_id, '123456');

const member = mc.withConnection(token);
const { person } = await member.people.create({
  full_name: 'Amelia Glisson',
  relationship: 'biological_child',
  facts: [{ key: 'school', value: 'Parker Elementary' }],
});
```

## Surface

| Group | Methods | Scope |
|---|---|---|
| `vault` | `listDocuments`, `getDocument`, `downloadDocument`, `depositOnBehalf`, `depositStatus`, `waitForDeposit`, `recallDeposit`, `updateSubject`, `revokeSubjectBinding` | `vault.read`, `custody.read` (stream), `vault.deposit_on_behalf` |
| `custody` | `grant`, `revoke`, `replace`, `dispute`, `assertEvent`, `listEvents` | `custody.grant`, `custody.replace`, `custody.events` |
| `connections` | `request`, `verify` | any key |
| `people` | `list`, `create`, `get`, `update`, `remove`, `listFacts`, `confirmFacts` | `people.write` + connection token |
| `webhooks` | `list`, `create`, `get`, `update`, `delete`, `eventTypes` | `webhooks.manage` |
| `integrations` | `listSigningCertificates`, `registerSigningCertificate`, `revokeSigningCertificate` | `vault.deposit_on_behalf` |
| `Webhooks` (static) | `constructEvent`, `verify`, `sign` | — |

Parameter and response field names are the REST API's own (`snake_case`), so the API reference at `/developers/api` applies unchanged. Responses come back as the API sends them, `success` envelope included.

## Webhooks

Deliveries are signed with HMAC-SHA256 over `"<timestamp>.<raw body>"` using the secret returned **once** when you register the endpoint. Verify against the raw body, never a re-serialised object.

```ts
import { Webhooks } from '@mecentral/sdk';

// Express, with express.raw({ type: 'application/json' })
app.post('/hooks/mecentral', async (req, res) => {
  try {
    const event = await Webhooks.constructEvent(req.body, req.headers, process.env.MECENTRAL_WEBHOOK_SECRET!);
    if (event.type === 'deposit.completed') {
      // event.data.document_id, event.data.grant_errors, …
    }
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(400);
  }
});
```

Deliveries are best-effort and not retried. Treat them as a nudge and reconcile against `vault.depositStatus`, which is the source of truth.

## Errors

All failures throw `MeCentralError` or a subclass with `status`, `message`, `code`, `retryAfter`, and the decoded `body`.

| Class | Status |
|---|---|
| `AuthenticationError` | 401 |
| `PermissionError` | 403 (scope, IP, or endpoint allowlist) |
| `NotFoundError` | 404 (never distinguishes "not yours" from "never existed") |
| `ValidationError` | 400 / 422 |
| `RateLimitError` | 429, `retryAfter` in seconds |
| `ServerError` | 5xx |
| `ConnectionError` | no HTTP response |
| `SignatureVerificationError` | webhook check failed |
| `DepositTimeoutError` | `waitForDeposit` ran out of time |

## Retries

`429` and `503` are retried for every method with exponential backoff (honouring `Retry-After`). `502`, `504`, and transport failures are retried only for `GET` and `DELETE`, because a `POST` that timed out may already have been processed. Set `maxRetries: 0` to disable.

## Sandbox provisioning

```ts
const { key } = await MeCentral.provisionSandbox({
  token: process.env.INTEGRATION_PROVISION_TOKEN!,
  slug: 'myapp.example.com',
  scopes: ['vault.deposit_on_behalf', 'custody.grant', 'webhooks.manage'],
  ttl_days: 90,
});
// key.key is shown here and nowhere else
```

## Building from source

```bash
npm install
npm run build      # dist/esm + dist/cjs
```
