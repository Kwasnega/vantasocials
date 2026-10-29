# BundleUp gateway integration boundary

The VANTA gateway feature remains disabled unless
`VANTA_BUNDLEUP_GATEWAY_ENABLED` is explicitly set to `true` and the
server-only selector `VANTA_CHECKOUT_PAYMENT_PROVIDER` is set to
`bundleup_gateway`. The selector defaults to `paystack`; it must never be
exposed as a public/client variable or accepted from checkout request data.
Gateway initialization uses the existing authenticated customer checkout
route and payment-attempt helper. Server-side
reconciliation can now persist signed observations and request atomic
settlement for a verified successful payment. It does not update wallets or
trigger fulfillment.

The configured static `VANTA_BUNDLEUP_GATEWAY_RETURN_URL` is sent unchanged in
the HMAC-authenticated initialization request. BundleUp validates that base
URL and appends the initialization `Idempotency-Key` UUID as the
`payment_id` query parameter before forwarding the callback to Paystack. VANTA
does not add that parameter itself; its return page and reconciliation API
validate the UUID and enforce session ownership.

Initialization responses remain protected by HTTPS endpoint validation,
authenticated requests, response-field validation, and the strict configured
checkout-host allowlist. BundleUp-signed initialization responses are a
separate security enhancement and are not part of this integration change.

## Durable attempt and initialization

The payment UUID from VANTA's persisted payment row is the gateway idempotency
key. VANTA reserves the payment and immutable order-derived terms before
initialization dispatch. An atomic database claim permits one request to
dispatch. Timeout, transport failure, malformed response, or another
ambiguous result leaves the payment pending and initialization unresolved. A
retry returns the same attempt without dispatching another initialization.

The prepared and follow-up migrations preserve existing Paystack rows, the
direct Paystack settlement RPC, and the wallet-deposit table. The follow-up
migration adds durable reconciliation requests and canonical signed evidence,
global Paystack-reference claims across direct and gateway payment rows,
gateway-only settlement, and a pending external-payment insert guard. Neither
migration is applied by this code. The new database path cannot operate until
both migrations have been reviewed and applied through the approved process.

## Reconciliation evidence verification

`reconcileBundleUpGatewayAttempt` first loads the payment by payment UUID,
user UUID, and `bundleup_gateway` provider. The persisted payment is
authoritative for the tenant (`vanta`), VANTA payment UUID, order reference,
amount, currency, and any already-known BundleUp intent ID and Paystack
reference. An absent, inaccessible, invalid, or ineligible attempt remains
unresolved and does not result in an initialization request.

The reconciliation client sends
`POST /api/gateway/v1/payment-intents/reconcile` with the exact request body
and HMAC-SHA256 canonical request signature described in
`vanta-reconciliation-contract-handoff.md`. It signs the transmitted UTF-8
body bytes, uses the payment UUID as `Idempotency-Key`, and creates a new
timestamp and cryptographically random nonce for every request. It never
falls back to payment initialization.

The response verifier:

- Accepts only HTTP 200 with the exact two-field signed envelope.
- Strictly decodes unpadded canonical base64url and verifies Ed25519 over the
  original decoded payload bytes, before trusting its parsed claims.
- Requires the version, key ID, tenant, payment UUID, order reference, nonce,
  timestamp, intent identity, and outcome-specific fields to match the
  contract and persisted attempt.
- Returns `payment_verified` only as validated evidence. The attempt
  orchestrator passes the exact payload bytes and signature, not reserialized
  claims, to the gateway-only settlement RPC. The RPC binds those claims to the
  durable request, payment attempt, owner, order, tenant, amount, currency,
  provider, and order state; the VANTA server verifier remains responsible for
  Ed25519 validation.
- Returns initialized, pending, failed, not-found, and unresolved observations
  without converting them into payment settlement decisions. In particular,
  not-found and failed do not permit a new initialization.
- Treats non-200 HTTP responses, timeouts, malformed data, invalid signatures,
  unknown keys, and identity/term mismatches as unresolved. Unsigned HTTP
  error bodies are never evidence.

### Trusted key configuration and replay correlation

Provision trusted Ed25519 SPKI PEM public keys out of band in the server-only
environment variable `VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS`. Its value
is a JSON object mapping each allowed key ID to its PEM string, for example:

```json
{"evidence-key-2026-01":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"}
```

The actual public key material is deployment configuration and must not be
committed. Each key is parsed and checked to be Ed25519. Missing, malformed,
or invalid configuration fails closed. Multiple pinned keys are supported
for the handoff's overlap rotation: provision the new public key before
switching the signer, retain the old key during convergence and the 300-second
freshness window, and then remove the retired key. There is no key discovery
or automatic key fallback.

Every client invocation creates its nonce internally; callers cannot choose
or reuse a nonce. The signed response's `request_nonce` must equal the nonce
of that exact in-flight request. A response replayed against a later request
therefore fails correlation because that request has a different nonce. The
request is durably recorded before dispatch, and its unique nonce plus request
UUID bind the response to one payment attempt. The current API is synchronous
and does not accept queued or externally supplied responses; any future
asynchronous workflow must preserve this one-time durable correlation before
accepting a delayed response.

Before each reconciliation HTTP request, VANTA stores the exact request body,
nonce, timestamp, payment/order/user binding, and a five-minute expiry in a
server-only request table. The response is persisted against that request.
Successful evidence, request consumption, provider-reference claim, payment
transition to `PAID`, and order payment-status transition commit in one
database transaction. A failed transaction rolls all of these changes back.
Evidence is unique per payment attempt and provider reference; a different
attempt cannot reuse an already-claimed Paystack reference.

The database stores the raw signed payload and signature but does not verify
Ed25519 itself. Only the server-side verifier may call the service-role RPCs.
The RPC independently validates signed-payload shape and all stored/payment/
order terms; this is defense in depth, not a substitute for signature
verification. If the settlement response is lost, the server reads the
payment, order, consumed request, evidence bytes, and provider-reference claim
back and accepts success only when they match the exact proof. Otherwise it
returns unresolved; a later reconciliation uses a fresh nonce and never
retries initialization.

Request rows (including expired observations), canonical evidence, and
provider-reference claims are retained by this migration; it adds no cleanup
job. Reference claims must not be deleted because a provider reference must
not become reusable. A request/evidence retention period and a reviewed
archival process remain operational decisions before production use.
The existing Paystack settlement path remains restricted to provider
`paystack`.

## Remaining integration sequence

1. Provision the request HMAC secret and pinned public-key map using the
   approved deployment process; keep the gateway disabled until the separate
   approval stage.
2. Apply and integration-test the prepared and follow-up VANTA migrations in
   a disposable isolated database, including permissions, rollback, duplicate
   settlement, competing reservations, reference claims, and unresolved
   initialization recovery. No database integration or concurrency test has
   been run as part of this implementation.
3. Review and approve the settlement contract, retention policy, and
   production migration plan; do not enable the gateway flag as part of that
   work.
4. The existing checkout initializer now supports a server-only provider
   selector, defaulting to Paystack. BundleUp selection still requires the
   explicit selector value and gateway enable flag; keep the local/deployment
   flag disabled until separate approval and successful isolated database
   validation.

The checkout wiring does not alter wallet, webhook, direct Paystack
settlement, or fulfillment behavior. Gateway settlement is server-side only
and is not enabled by default.
