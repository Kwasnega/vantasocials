# VANTA reconciliation evidence contract handoff

This document describes the current BundleUp implementation of
`POST /api/gateway/v1/payment-intents/reconcile`. It is a VANTA client
integration handoff, not a claim that VANTA currently consumes this contract.
BundleUp signs the response; VANTA must independently validate the signature,
request binding, evidence, and its own durable payment attempt before any
future settlement.

## 1. Exact HTTP request

### Method and path

```text
POST /api/gateway/v1/payment-intents/reconcile
```

### Required headers

| Header | Required value/format |
|---|---|
| `Content-Type` | Send `application/json`. The current route does not explicitly validate this header. |
| `Idempotency-Key` | The original VANTA payment UUID v4 used on initialization. The endpoint trims surrounding header whitespace, requires UUID-v4 syntax, and compares it case-insensitively with `payment_id`. Send its canonical UUID string without whitespace. |
| `X-Vanta-Timestamp` | Exactly 10 decimal digits representing Unix time in whole seconds. |
| `X-Vanta-Nonce` | 16–128 characters matching `[A-Za-z0-9_-]`; create a fresh value for each request. |
| `X-Vanta-Signature` | 64 hexadecimal characters, case-insensitive, containing HMAC-SHA256 of the canonical request message. |

Example request headers:

```http
POST /api/gateway/v1/payment-intents/reconcile HTTP/1.1
Content-Type: application/json
Idempotency-Key: 3c6a3be3-0d77-4fa2-95c7-493810d58343
X-Vanta-Timestamp: 1793019600
X-Vanta-Nonce: reconcile-20261026-00000001
X-Vanta-Signature: <64 hexadecimal characters; illustrative placeholder>
```

### JSON body

The body is limited to 1024 UTF-8 bytes. Unknown properties are rejected.
Required fields:

```json
{
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "amount_minor": 1250,
  "currency": "GHS"
}
```

`intent_id` is optional and may be supplied when already known:

```json
{
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "amount_minor": 1250,
  "currency": "GHS",
  "intent_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Validation is exact:

- `tenant_id` must be the string `vanta`.
- `payment_id` must be a UUID v4. Uppercase hex is accepted; the value is
  normalized to lowercase for lookup and payload output.
- `order_reference` must match
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. It is not trimmed or otherwise
  normalized.
- `amount_minor` must be a positive JavaScript safe integer (number, not
  string); for this tenant the currency is `GHS`.
- `currency` must equal uppercase `GHS`.
- If supplied, `intent_id` must be exactly 64 lowercase hexadecimal
  characters.
- `Idempotency-Key` must match `payment_id`, ignoring UUID letter case.
- The intent ID is always derived from the payment UUID. A supplied
  `intent_id` is only an additional equality check; it never selects a
  different intent.

### Unsigned HTTP errors

Errors before a signed outcome envelope are ordinary JSON error objects, not
evidence envelopes. VANTA must not treat any such response as evidence:

| HTTP | Cause |
|---|---|
| 400 | Invalid JSON, unknown body fields, invalid field values, or payment UUID does not match `Idempotency-Key`. |
| 401 | Invalid nonce or idempotency-key header syntax, malformed/stale timestamp, or invalid HMAC signature. A well-formed timestamp outside the allowed window returns the stale-timestamp error. |
| 409 | Nonce was already used. |
| 413 | Declared or read request body exceeds 1024 bytes. |
| 503 | Gateway shared-secret configuration is absent/too short; evidence signing key configuration is invalid; or durable nonce creation failed. |

The implementation does not return HTTP 404 for a missing intent: a valid,
signed `not_found` outcome is HTTP 200.

## 2. Request authentication

The request HMAC secret is `VANTA_GATEWAY_SHARED_SECRET` (name only). BundleUp
requires its UTF-8 encoding to be at least 32 bytes. Do not place its value in
this document, VANTA logs, or request bodies.

The canonical message is UTF-8 text with LF (`\n`) separators and no trailing
newline:

```text
POST
/api/gateway/v1/payment-intents/reconcile
<X-Vanta-Timestamp>
<X-Vanta-Nonce>
<trimmed Idempotency-Key>
<lowercase hex SHA-256 digest of request body>
```

The body digest is:

```text
hex(SHA-256(UTF-8(request_body)))
```

The route reads the body as text and hashes its UTF-8 encoding. Send valid
UTF-8 JSON and sign the exact serialized body sent on the wire; do not parse
and reserialize between signing and transmission.

The signature is:

```text
hex(HMAC-SHA256(UTF8(shared_secret), UTF8(canonical_message)))
```

Hex is accepted in either case. The signature is compared in constant time.
The timestamp must be exactly 10 digits and within 300 seconds of the
BundleUp clock; a difference of exactly 300 seconds is accepted.

After signature and body validation, BundleUp creates a durable, create-only
nonce record in `gateway_request_nonces`, using a tenant-scoped hash of the
nonce as its document ID. A duplicate nonce returns HTTP 409; a Firestore
failure returns HTTP 503. Nonces are not deleted by this route. The durable
nonce is consumed before looking up the intent or contacting Paystack.

## 3. Exact response envelope

Every valid authenticated request that passes the unsigned checks and reaches
intent lookup returns HTTP 200 with this two-property JSON object:

```json
{
  "payload": "<unpadded base64url of UTF-8 JSON payload bytes>",
  "signature": "<unpadded base64url of 64-byte Ed25519 signature>"
}
```

The payload bytes decode to a JSON object. Its common fields and serialization
order are:

1. `version`: number, always `1`.
2. `key_id`: string identifying the signing key.
3. `tenant_id`: string, always `vanta`.
4. `payment_id`: lowercase VANTA payment UUID.
5. `order_reference`: exact request order reference.
6. `intent_id`: lowercase 64-character intent ID, or `null` when there is no
   intent or its identity could not be validated.
7. `request_nonce`: exact nonce header value.
8. `issued_at`: BundleUp UTC ISO-8601 timestamp with millisecond precision,
   produced by `new Date().toISOString()`.
9. `outcome`: one of the outcomes below.
10. Optional outcome-specific fields, in the order described below.

For `unresolved` and `not_found`, optional `reason` follows the common fields.
Provider-observation outcomes append, in order:
`provider`, `reference`, `amount_minor`, `currency`, `provider_status`,
`verified_at`, `transaction_id`.

### Canonical bytes and JSON property ordering

The wire envelope `payload` and `signature` are produced in that order by
`JSON.stringify({ payload, signature })`. The signature does **not** cover
that outer JSON object. It covers the exact UTF-8 byte sequence of the
decoded `payload` string, before base64url encoding:

```text
signature_bytes = Ed25519.Sign(private_key, payload_bytes)
payload_field = Base64URL_NoPadding(payload_bytes)
signature_field = Base64URL_NoPadding(signature_bytes)
```

JSON property order therefore matters only insofar as it determines the
signed bytes generated by BundleUp. The key ID is inside the signed payload,
so a verifier must parse enough untrusted JSON to select a candidate pinned
key. It must not trust any field at that point. Verify the signature over the
original decoded payload bytes, then validate and trust the parsed object. Do
not reconstruct JSON and verify a reserialization. Reject invalid UTF-8,
malformed JSON, non-canonical base64url, a signature that is not exactly 64
bytes, unsupported versions, unknown key IDs, invalid fields, stale/future
timestamps, or a nonce that does not match the request.

Base64url uses the URL-safe alphabet (`-`, `_`) with no `=` padding, matching
Node.js `Buffer.toString("base64url")`.

### Payload schemas by outcome

The following are decoded payload shapes; literal values are illustrative.
The listed common field order is the order BundleUp signs. Fields shown as
optional are omitted when not applicable.

#### `payment_verified`

```json
{
  "version": 1,
  "key_id": "evidence-key-2026-01",
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "intent_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "request_nonce": "reconcile-20261026-00000001",
  "issued_at": "2026-10-26T13:00:00.000Z",
  "outcome": "payment_verified",
  "provider": "paystack",
  "reference": "VANTA-<64 lowercase hex characters>",
  "amount_minor": 1250,
  "currency": "GHS",
  "provider_status": "success",
  "verified_at": "2026-10-26T12:59:59.000Z",
  "transaction_id": "123456789"
}
```

`transaction_id` is a string or `null`. The example above uses a
synthetic-form reference and transaction ID; it is not a real payment.

#### `initialized`, `pending`, and `failed`

These outcomes contain the common fields plus all provider-observation fields
in the same order as above. For example:

```json
{
  "version": 1,
  "key_id": "evidence-key-2026-01",
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "intent_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "request_nonce": "reconcile-20261026-00000002",
  "issued_at": "2026-10-26T13:00:00.000Z",
  "outcome": "pending",
  "provider": "paystack",
  "reference": "VANTA-<64 lowercase hex characters>",
  "amount_minor": 1250,
  "currency": "GHS",
  "provider_status": "pending",
  "verified_at": "2026-10-26T12:59:59.000Z",
  "transaction_id": null
}
```

`initialized` is emitted only when Paystack status lowercases to `ongoing` and
the durable intent state is `INITIALIZED`. `pending` and `failed` require
exact matching provider reference, amount, currency, and a valid optional
provider transaction ID.

#### `unresolved`

`intent_id` is either a valid ID (known, identity-matching intent) or `null`
(lookup error or intent identity mismatch). `reason` is a safe internal reason
code, not a provider response body:

```json
{
  "version": 1,
  "key_id": "evidence-key-2026-01",
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "intent_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "request_nonce": "reconcile-20261026-00000003",
  "issued_at": "2026-10-26T13:00:00.000Z",
  "outcome": "unresolved",
  "reason": "provider_unavailable"
}
```

#### `not_found`

`intent_id` is `null`; `reason` is `intent_not_found`:

```json
{
  "version": 1,
  "key_id": "evidence-key-2026-01",
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "intent_id": null,
  "request_nonce": "reconcile-20261026-00000004",
  "issued_at": "2026-10-26T13:00:00.000Z",
  "outcome": "not_found",
  "reason": "intent_not_found"
}
```

No signed evidence response contains an authorization URL, access code, or
private key.

## 4. Verified evidence and trust boundaries

For `payment_verified`, VANTA must require all of these exact values:

| Field | Type and meaning |
|---|---|
| `tenant_id` | String `vanta`; BundleUp's fixed tenant identity. |
| `payment_id` | Lowercase UUID v4, echo of the normalized authenticated request. |
| `order_reference` | Exact immutable order reference from the request and stored BundleUp intent. |
| `intent_id` | Exact deterministic Firestore intent document ID. |
| `provider` | String `paystack`. |
| `reference` | Exact Paystack reference loaded from the durable BundleUp intent and confirmed against Paystack's verification response. |
| `amount_minor` | Positive safe-integer number loaded from the durable intent and confirmed equal to Paystack's integer `amount`. |
| `currency` | String `GHS`, loaded from the durable intent and confirmed against Paystack currency case-insensitively; response is uppercase. |
| `provider_status` | String `success`. |
| `verified_at` | UTC ISO-8601 millisecond timestamp assigned by BundleUp when it records evidence; this is not Paystack's `paid_at`. |
| `transaction_id` | String form of Paystack's string or safe non-negative integer `id`, or `null` when Paystack omitted it. |

BundleUp obtains the intent's tenant, order reference, amount, currency,
reference, state, and persisted evidence from Firestore. It obtains provider
status, reference, amount, currency, and optional transaction ID from the
Paystack verification helper. It records evidence only when provider status
is `success`, the exact reference matches, amount is a safe integer equal to
the intent amount, currency matches, and any supplied transaction ID is
valid. It then conditionally writes evidence and only returns verified
evidence after the write succeeds or a reload confirms valid persisted
evidence.

The outer signed payload binds the evidence to `tenant_id`, `payment_id`,
`order_reference`, `intent_id`, and `request_nonce`. The first four are
validated against the signed request and durable intent; the nonce binds the
response to the individual authenticated request. VANTA must additionally
compare these fields and every evidence term to its own durable payment
attempt. A valid signature alone is not sufficient authorization to settle.

## 5. Outcome semantics and HTTP status

All six signed outcomes use HTTP **200**. Outcomes do not correspond one to
one with provider payment state transitions.

| Outcome | When current code emits it | Retry and what it proves |
|---|---|---|
| `initialized` | Paystack verification returns exact matching terms and status `ongoing`, and durable intent state is `INITIALIZED`. | Retry reconciliation later. Proves only an initialized provider transaction was observed; not payment. |
| `pending` | Paystack verification returns exact matching terms and status `pending`. | Retry later. Proves only the provider status observed at `verified_at`; not payment, final failure, or authorization to create another charge. |
| `payment_verified` | Paystack returns exact matching reference, safe integer amount, currency, and `success`, and evidence is durably written or confirmed from Firestore. Also returned from valid already-persisted evidence without another provider call. | Safe to retry reconciliation with a fresh request nonce. Proves persisted BundleUp evidence of provider success; does not settle or fulfill a VANTA order. |
| `failed` | Paystack returns exact matching terms and status `failed`. | Retry/reconcile before any terminal decision. Does not mutate the intent or prove the provider can never later report success; does not authorize another initialization. |
| `unresolved` | Provider/persistence unavailable, malformed/mismatched provider result, unknown provider status, intent identity/terms mismatch, invalid stored evidence, unsupported intent state, conditional conflict without confirmed evidence, or write acknowledgement ambiguity. | Retry reconciliation with fresh timestamp/nonce. Does not prove payment or failure. |
| `not_found` | The deterministic intent document is absent at lookup time. | Retry with a fresh nonce; do not initialize a replacement charge. Absence at one read does not establish that an earlier initialization request cannot still create or finish the intent. |

Specific `unresolved` reasons emitted by the route include
`intent_lookup_unavailable`, `intent_identity_mismatch`,
`intent_state_unresolved`, `invalid_stored_intent`, `provider_unavailable`,
`invalid_provider_response`, `provider_terms_or_response_mismatch`,
`payment_not_confirmed`, `invalid_persisted_evidence`,
`evidence_persistence_unconfirmed`, and `state_changed`.

## 6. Lookup, recovery, and idempotency

Initialization normalizes the UUID idempotency key to lowercase, then derives
the intent document ID using `gatewayDocumentId("idempotency:" + key)`.
`gatewayDocumentId(value)` is lowercase hex SHA-256 of UTF-8
`"vanta" + NUL + value`. Initialization creates that document using Firestore
create-only semantics. Reconciliation repeats the same derivation from
`payment_id`, so it does not require VANTA to have received `intent_id`.

Before verification, reconciliation checks:

- The loaded Firestore document's `id` matches the derived document ID.
- Its `tenantId` is exactly `vanta`.
- Its `idempotencyKeyHash` equals
  `gatewayDocumentId("key:" + lowercase(payment_id))`.
- Its `tenantOrderId`, `amountMinor`, and `currency` exactly match the request.
- If a request `intent_id` was supplied, it equals the derived ID.

If identity or terms do not match, BundleUp returns signed `unresolved` with
`intent_id: null` and does not call Paystack.

When the intent is `INITIALIZING`, `INITIALIZED`, or
`INITIALIZATION_UNKNOWN`, BundleUp verifies only the intent's stored Paystack
reference. It does not call Paystack initialization. A provider `success` may
be persisted conditionally from any of those eligible states. An `ongoing`
provider status becomes `initialized` only if the durable intent state is
`INITIALIZED`; otherwise it is `unresolved`. Other provider observations do
not change durable intent state.

If an evidence write throws or its acknowledgement is ambiguous, BundleUp
reloads the document. Valid matching `PAYMENT_VERIFIED` evidence yields a
signed `payment_verified`; invalid stored evidence yields `unresolved`;
unconfirmed persistence remains `unresolved`. A conditional update conflict
does not overwrite newer state. A later reconciliation can retry.

For a durable `PAYMENT_VERIFIED` intent, BundleUp validates stored evidence
and returns a newly signed response with the new request nonce, without
another Paystack lookup. It does not replace or downgrade the existing
evidence. This is intent-level idempotency; there is no gateway webhook
event-ID ledger guaranteeing exactly-once event processing.

## 7. Key handling and rotation

BundleUp requires these configuration **names** for the evidence signer:

- `VANTA_GATEWAY_EVIDENCE_KEY_ID`
- `VANTA_GATEWAY_EVIDENCE_SIGNING_KEY_BASE64`

The value of `VANTA_GATEWAY_SHARED_SECRET` is also required for request HMAC,
but is not an evidence signing key. No configuration values belong in this
handoff.

The evidence private key must be base64 of an Ed25519 PKCS#8 DER private key.
The encoded base64 must be canonical and padded as produced by standard
base64; the route decodes it and checks the key type is Ed25519. The key ID
must match `[A-Za-z0-9._-]{1,64}`.

VANTA should pin the corresponding Ed25519 public key via a trusted
out-of-band configuration/release process. BundleUp has no public-key
discovery endpoint. A common Node.js input is SPKI PEM:

```js
const publicKey = createPublicKey(publicKeyPem);
```

Key rotation requires an overlap: provision the new public key and key ID to
VANTA while retaining the old trusted key; switch BundleUp to the new private
key and key ID; then retire the old public key after all deployments have
converged and the 300-second response freshness window has passed. BundleUp
signs with one active key at a time. VANTA can accept both during overlap,
chooses the verification key by the signed `key_id`, and must reject an
unknown ID. There is no automatic key fallback.

### Test-only key generation

Run this only in a local test environment. It generates ephemeral keys and
prints test material; never use the generated private key in production:

```js
const { generateKeyPairSync } = require("node:crypto");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
console.log("TEST_ONLY key ID:", "local-test-1");
console.log("TEST_ONLY signing key base64:", privateKey.export({
  format: "der",
  type: "pkcs8",
}).toString("base64"));
console.log("TEST_ONLY verifier key PEM:", publicKey.export({
  format: "pem",
  type: "spki",
}).toString());
```

The repository tests generate ephemeral key pairs at test runtime rather than
embedding credentials.

## 8. Interoperability examples

### Sanitized signed request

The following signature is a placeholder; compute it over the exact body
bytes and headers using the test/deployment shared secret:

```http
POST /api/gateway/v1/payment-intents/reconcile HTTP/1.1
Content-Type: application/json
Idempotency-Key: 3c6a3be3-0d77-4fa2-95c7-493810d58343
X-Vanta-Timestamp: 1793019960
X-Vanta-Nonce: reconcile-example-00000001
X-Vanta-Signature: <HMAC-SHA256 hex placeholder>

{"tenant_id":"vanta","payment_id":"3c6a3be3-0d77-4fa2-95c7-493810d58343","order_reference":"VNT-ABC123","amount_minor":1250,"currency":"GHS"}
```

### Representative response envelopes

These values are illustrative only. `payload` and `signature` strings below
are placeholders and are not valid signatures:

```json
{
  "payload": "<base64url of payment_verified payload bytes; placeholder>",
  "signature": "<base64url Ed25519 signature; placeholder>"
}
```

The decoded `payment_verified` payload shape is shown in section 3. An
unresolved envelope has the same outer shape and a decoded payload like:

```json
{
  "version": 1,
  "key_id": "evidence-key-2026-01",
  "tenant_id": "vanta",
  "payment_id": "3c6a3be3-0d77-4fa2-95c7-493810d58343",
  "order_reference": "VNT-ABC123",
  "intent_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "request_nonce": "reconcile-example-00000001",
  "issued_at": "2026-10-26T13:00:00.000Z",
  "outcome": "unresolved",
  "reason": "provider_unavailable"
}
```

### Node.js verifier pseudocode

This verifies exactly the decoded payload bytes, not a reserialized object.
The `publicKeyPem` must be provisioned out-of-band; this example contains no
key material:

```js
import {
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

function decodeBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("Non-canonical base64url");
  return bytes;
}

function verifyEnvelope(envelope, publicKeyPem, requestNonce) {
  const payloadBytes = decodeBase64url(envelope.payload);
  const signatureBytes = decodeBase64url(envelope.signature);
  if (signatureBytes.length !== 64) throw new Error("Invalid Ed25519 signature size");

  // Only inspect key_id to select a candidate key; trust no parsed fields yet.
  const untrustedPayload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  if (typeof untrustedPayload.key_id !== "string") throw new Error("Invalid evidence key ID");
  const pem = publicKeyPemByKeyId.get(untrustedPayload.key_id);
  if (!pem) throw new Error("Unknown evidence key ID");
  const publicKey = createPublicKey(pem); // SPKI PEM, pinned out-of-band
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Wrong public-key type");

  // Verify the exact payload bytes; do not serialize the parsed object again.
  if (!verifySignature(null, payloadBytes, publicKey, signatureBytes)) {
    throw new Error("Invalid evidence signature");
  }

  const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  if (payload.version !== 1) throw new Error("Unsupported evidence version");
  const issuedAt = Date.parse(payload.issued_at);
  if (!Number.isFinite(issuedAt) || new Date(issuedAt).toISOString() !== payload.issued_at) {
    throw new Error("Invalid issuance timestamp");
  }
  if (Math.abs(Date.now() - issuedAt) > 300_000) throw new Error("Stale evidence");
  if (payload.request_nonce !== requestNonce) throw new Error("Response/request nonce mismatch");
  return payload; // Continue with strict version, key_id, outcome, and payment-term checks.
}
```

`publicKeyPemByKeyId` must be a trusted configuration map populated out of
band. The unverified `key_id` may select a candidate key only; successful
signature verification authenticates that key ID and the rest of the payload.

### Minimal signature-byte interoperability test

This is illustrative test code, not a production trust configuration:

```js
import { generateKeyPairSync, sign, verify } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const payloadObject = { version: 1, key_id: "local-test-1", outcome: "unresolved" };
const payloadBytes = Buffer.from(JSON.stringify(payloadObject), "utf8");
const signatureBytes = sign(null, payloadBytes, privateKey);
const wirePayload = payloadBytes.toString("base64url");
const decodedPayloadBytes = Buffer.from(wirePayload, "base64url");

if (!verify(null, decodedPayloadBytes, publicKey, signatureBytes)) {
  throw new Error("Signature did not verify");
}
```

The bytes verified are `decodedPayloadBytes`—the same bytes passed into
`sign`, not `Buffer.from(JSON.stringify(JSON.parse(...)))`.

## 9. Tests and limitations

Relevant test names in `tests/payment-gateway.test.mjs` include:

- `reconciliation records evidence only for a matching successful transaction`
- `signed evidence binds exact bytes, nonce, freshness, and key ID`
- `evidence key rotation accepts overlapping trusted keys and rejects unknown IDs`
- `invalid evidence signing configuration fails closed before nonce or payment processing`
- `evidence signing rejects malformed and non-Ed25519 private keys`
- `reconciliation recovers an initialization response lost to VANTA by payment UUID`
- `wrong request identity terms fail closed without provider verification`
- `not_found is signed and does not authorize another initialization`
- `lost Firestore update acknowledgement is recovered from durable evidence`
- `reconciliation reports verified only when persisted evidence matches the intent`
- `reconciliation leaves an intent unresolved when provider terms mismatch`
- `reconciliation distinguishes provider pending and failed from unresolved results`
- `reconciliation is tenant-scoped and uses the durable intent id`
- `stale reconciliation updates preserve newer intent state`
- `conditional-update conflict reports success only when the latest evidence is valid`
- `repeated reconciliation returns recorded evidence without another provider call`
- `replayed reconciliation request nonce is rejected`
- `a failed conditional reconciliation update does not claim verified evidence`
- `existing BundleUp initialization keeps its order-priced Paystack contract`

These are unit/route tests with mocked Firestore and Paystack boundaries. They
establish application-level validation and mocked state behavior, not Firestore
atomicity, persistence durability, Paystack response semantics, deployment
configuration correctness, clock synchronization, or VANTA implementation.
No real provider, Firestore, or production service calls are part of these
tests.

Explicit limitations:

- `failed` is a provider status observed during verification, not an
  irreversible terminal state; the route does not mutate the intent for it.
- For `initialized`, `pending`, and `failed`, `verified_at` is BundleUp's
  observation timestamp created while constructing the response. For
  `payment_verified`, it is the timestamp persisted with BundleUp evidence.
  Neither is Paystack's `paid_at`.
- The route accepts `ongoing` as `initialized` only when durable intent status
  is `INITIALIZED`. The Paystack helper's actual status vocabulary beyond
  statuses represented in mocks is **UNCONFIRMED**.
- Request body bytes are read as text and re-encoded as UTF-8 for hashing.
  Interoperability for invalid UTF-8 byte sequences is **UNCONFIRMED**; send
  valid UTF-8 JSON bytes.
- The route does not expose or support a key-discovery endpoint. Public-key
  delivery, secure deployment storage, key rotation operations, and VANTA's
  trusted-key deployment are operational prerequisites.
- Response freshness/replay checks, public-key pinning, and downstream evidence
  validation must be implemented by VANTA. BundleUp binds the response to the
  request nonce, but it cannot enforce that a client consumes a response nonce
  only once.
- No VANTA settlement, order update, wallet change, or fulfillment occurs in
  this contract.

## Source files inspected

- `src/app/api/gateway/v1/payment-intents/reconcile/route.ts`
- `src/lib/gateway-evidence-signature.ts`
- `src/lib/gateway-auth.ts`
- `src/lib/gateway-config.ts`
- `src/lib/gateway-evidence.ts`
- `src/app/api/gateway/v1/payment-intents/route.ts` (intent ID derivation and
  persisted terms)
- `src/lib/firestore-rest.ts` (existing create-only and conditional update
  helpers; not modified for this handoff)
- `tests/payment-gateway.test.mjs`
- `docs/payment-gateway-v1.md`
