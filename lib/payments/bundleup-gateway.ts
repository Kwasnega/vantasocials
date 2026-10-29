import "server-only";

import crypto from "node:crypto";
import { amountToMinorUnits } from "./paystack";

const PAYMENT_INTENTS_PATH = "/api/gateway/v1/payment-intents";
const PAYMENT_INTENTS_RECONCILE_PATH = `${PAYMENT_INTENTS_PATH}/reconcile`;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 16_384;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const EVIDENCE_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const DEFINITIVE_REJECTION_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422]);
const MAX_CLOCK_SKEW_MS = 300_000;
const PROVIDER_OUTCOMES = new Set(["payment_verified", "initialized", "pending", "failed"]);
const UNRESOLVED_REASONS = new Set([
  "intent_lookup_unavailable",
  "intent_identity_mismatch",
  "intent_state_unresolved",
  "invalid_stored_intent",
  "provider_unavailable",
  "invalid_provider_response",
  "provider_terms_or_response_mismatch",
  "payment_not_confirmed",
  "invalid_persisted_evidence",
  "evidence_persistence_unconfirmed",
  "state_changed",
]);

type GatewayState = "initializing" | "initialization_unknown" | "unknown";

export type BundleUpGatewayEvidenceTerms = {
  paymentId: string;
  orderReference: string;
  amountMinor: number;
  currency: string;
  intentId: string | null;
  providerReference: string | null;
};

export type BundleUpGatewayProviderObservation = {
  intentId: string;
  provider: "paystack";
  reference: string;
  amountMinor: number;
  currency: "GHS";
  providerStatus: "success" | "ongoing" | "pending" | "failed";
  verifiedAt: string;
  transactionId: string | null;
};

export type BundleUpGatewayReconciliationResult =
  | { status: "already_settled"; paymentId: string }
  | {
    status: "payment_verified";
    evidence: BundleUpGatewayProviderObservation;
    proof: BundleUpGatewayVerifiedResponse;
    settlement?: "settled" | "already_settled";
  }
  | {
    status: "initialized" | "pending" | "failed";
    observation: BundleUpGatewayProviderObservation;
    proof: BundleUpGatewayVerifiedResponse;
  }
  | { status: "unresolved"; reason: string; proof?: BundleUpGatewayVerifiedResponse }
  | { status: "not_found"; proof: BundleUpGatewayVerifiedResponse };

export type BundleUpGatewayVerifiedResponse = {
  requestId: string;
  payloadBytes: Uint8Array;
  signatureBytes: Uint8Array;
  keyId: string;
  requestNonce: string;
  issuedAt: string;
  claims: {
    version: 1;
    tenantId: "vanta";
    paymentId: string;
    orderReference: string;
    intentId: string | null;
    outcome: ReconciliationPayload["outcome"];
    provider?: "paystack";
    reference?: string;
    amountMinor?: number;
    currency?: "GHS";
    providerStatus?: "success" | "ongoing" | "pending" | "failed";
    verifiedAt?: string;
    transactionId?: string | null;
    reason?: string;
  };
};

export type BundleUpGatewayReconciliationRequest = {
  requestId: string;
  paymentId: string;
  requestNonce: string;
  requestTimestamp: string;
  requestBody: Uint8Array;
};

export type PersistBundleUpGatewayReconciliationRequest = (
  request: BundleUpGatewayReconciliationRequest,
) => Promise<void>;

export type BundleUpGatewayPaymentIntentInput = {
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
  customerEmail: string;
};

export type BundleUpGatewayPaymentIntent = {
  intent_id: string;
  reference: string;
  authorization_url: string;
  status: "initialized";
  idempotent: boolean;
};

export class BundleUpGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: "DISABLED" | "CONFIGURATION" | "INVALID_INPUT" | "HTTP" | "PROTOCOL",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BundleUpGatewayError";
  }
}

export class BundleUpGatewayUnresolvedError extends BundleUpGatewayError {
  constructor(
    public readonly gatewayState: GatewayState,
    public readonly intentId?: string,
    public readonly reference?: string,
  ) {
    super("Payment initialization outcome is unresolved.", "HTTP");
    this.name = "BundleUpGatewayUnresolvedError";
  }
}

type GatewayConfig = {
  endpoint: string;
  secret: string;
  returnUrl: string;
  checkoutHosts: Set<string>;
};

type GatewayRequestConfig = {
  baseUrl: string;
  secret: string;
};

function parseHostAllowlist(value: string, settingName: string): Set<string> {
  const hosts = value.split(",").map((host) => host.trim());
  if (
    hosts.length === 0
    || hosts.some((host) => !host || host !== host.toLowerCase() || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host))
  ) {
    throw new BundleUpGatewayError(`Invalid ${settingName} configuration.`, "CONFIGURATION");
  }
  return new Set(hosts);
}

function getGatewayRequestConfig(): GatewayRequestConfig {
  if (process.env.VANTA_BUNDLEUP_GATEWAY_ENABLED !== "true") {
    throw new BundleUpGatewayError("BundleUp gateway client is disabled.", "DISABLED");
  }

  const baseUrl = process.env.VANTA_BUNDLEUP_GATEWAY_BASE_URL ?? "";
  const allowedGatewayHosts = parseHostAllowlist(
    process.env.VANTA_BUNDLEUP_GATEWAY_ALLOWED_HOSTS ?? "",
    "gateway host allowlist",
  );
  const secret = process.env.VANTA_BUNDLEUP_GATEWAY_SHARED_SECRET ?? "";

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new BundleUpGatewayError("BundleUp gateway credentials are not configured.", "CONFIGURATION");
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new BundleUpGatewayError("BundleUp gateway URL is invalid.", "CONFIGURATION");
  }
  if (
    parsedBaseUrl.protocol !== "https:"
    || parsedBaseUrl.username
    || parsedBaseUrl.password
    || parsedBaseUrl.hash
    || parsedBaseUrl.search
    || parsedBaseUrl.pathname !== "/"
    || parsedBaseUrl.port
    || !allowedGatewayHosts.has(parsedBaseUrl.hostname)
    || (baseUrl !== parsedBaseUrl.origin && baseUrl !== `${parsedBaseUrl.origin}/`)
  ) {
    throw new BundleUpGatewayError("BundleUp gateway URL is not allowed.", "CONFIGURATION");
  }

  return { baseUrl: parsedBaseUrl.origin, secret };
}

function getGatewayConfig(): GatewayConfig {
  const requestConfig = getGatewayRequestConfig();
  const checkoutHosts = parseHostAllowlist(
    process.env.VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS ?? "",
    "checkout host allowlist",
  );
  const returnUrl = process.env.VANTA_BUNDLEUP_GATEWAY_RETURN_URL ?? "";

  let parsedReturnUrl: URL;
  try {
    parsedReturnUrl = new URL(returnUrl);
  } catch {
    throw new BundleUpGatewayError("BundleUp gateway return URL is invalid.", "CONFIGURATION");
  }
  if (
    parsedReturnUrl.protocol !== "https:"
    || parsedReturnUrl.username
    || parsedReturnUrl.password
    || parsedReturnUrl.hash
    || parsedReturnUrl.toString() !== returnUrl
  ) {
    throw new BundleUpGatewayError("BundleUp gateway return URL is not allowed.", "CONFIGURATION");
  }

  return {
    endpoint: `${requestConfig.baseUrl}${PAYMENT_INTENTS_PATH}`,
    secret: requestConfig.secret,
    returnUrl,
    checkoutHosts,
  };
}

function validateInput(input: BundleUpGatewayPaymentIntentInput) {
  if (
    !UUID_V4_PATTERN.test(input.paymentId)
    || !ORDER_ID_PATTERN.test(input.orderId)
    || input.orderId.trim() !== input.orderId
    || input.currency !== "GHS"
  ) {
    throw new BundleUpGatewayError("Payment intent terms are invalid.", "INVALID_INPUT");
  }

  let amountMinor: bigint;
  try {
    amountMinor = amountToMinorUnits(input.amount);
  } catch {
    throw new BundleUpGatewayError("Payment amount is invalid.", "INVALID_INPUT");
  }
  if (amountMinor <= 0n || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BundleUpGatewayError("Payment amount is outside the supported range.", "INVALID_INPUT");
  }

  const customerEmail = input.customerEmail.trim().toLowerCase();
  if (customerEmail.length > 254 || !EMAIL_PATTERN.test(customerEmail)) {
    throw new BundleUpGatewayError("Customer email is invalid.", "INVALID_INPUT");
  }

  return { amountMinor: Number(amountMinor), customerEmail };
}

function createRequestNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function createRequestTimestamp(): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  if (!/^\d{10}$/.test(timestamp)) {
    throw new BundleUpGatewayError("System time is invalid for gateway authentication.", "CONFIGURATION");
  }
  return timestamp;
}

export function buildBundleUpGatewayCanonicalMessage(input: {
  timestamp: string;
  nonce: string;
  idempotencyKey: string;
  bodyBytes: Uint8Array;
  path?: typeof PAYMENT_INTENTS_PATH | typeof PAYMENT_INTENTS_RECONCILE_PATH;
}): string {
  const bodyDigest = crypto.createHash("sha256").update(input.bodyBytes).digest("hex");
  return [
    "POST",
    input.path ?? PAYMENT_INTENTS_PATH,
    input.timestamp,
    input.nonce,
    input.idempotencyKey,
    bodyDigest,
  ].join("\n");
}

function validateIntentId(value: unknown): value is string {
  return typeof value === "string" && INTENT_ID_PATTERN.test(value);
}

export function deriveBundleUpGatewayIntentId(paymentId: string): string {
  if (!UUID_V4_PATTERN.test(paymentId.toLowerCase())) {
    throw new BundleUpGatewayError("Payment identity is invalid.", "INVALID_INPUT");
  }
  return crypto.createHash("sha256")
    .update(`vanta\0idempotency:${paymentId.toLowerCase()}`, "utf8")
    .digest("hex");
}

function validateConflictFields(payload: Record<string, unknown>) {
  const intentId = validateIntentId(payload.intent_id) ? payload.intent_id : undefined;
  const reference = typeof payload.reference === "string" && payload.reference.length <= 100
    ? payload.reference
    : undefined;
  if (intentId && reference !== `VANTA-${intentId}`) {
    return { intentId: undefined, reference: undefined };
  }
  return { intentId, reference };
}

function validateSuccessResponse(
  value: unknown,
  checkoutHosts: Set<string>,
  expectedIntentId: string,
): BundleUpGatewayPaymentIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BundleUpGatewayError("BundleUp gateway returned an invalid response.", "PROTOCOL");
  }
  const payload = value as Record<string, unknown>;
  if (
    !validateIntentId(payload.intent_id)
    || payload.intent_id !== expectedIntentId
    || payload.reference !== `VANTA-${payload.intent_id}`
    || payload.status !== "initialized"
    || typeof payload.idempotent !== "boolean"
    || typeof payload.authorization_url !== "string"
    || payload.authorization_url.length > 2048
  ) {
    throw new BundleUpGatewayError("BundleUp gateway returned an invalid response.", "PROTOCOL");
  }

  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(payload.authorization_url);
  } catch {
    throw new BundleUpGatewayError("BundleUp gateway returned an invalid checkout URL.", "PROTOCOL");
  }
  if (
    checkoutUrl.protocol !== "https:"
    || checkoutUrl.username
    || checkoutUrl.password
    || checkoutUrl.hash
    || checkoutUrl.port
    || !checkoutHosts.has(checkoutUrl.hostname)
    || checkoutUrl.toString() !== payload.authorization_url
  ) {
    throw new BundleUpGatewayError("BundleUp gateway returned a disallowed checkout URL.", "PROTOCOL");
  }

  return {
    intent_id: payload.intent_id,
    reference: payload.reference,
    authorization_url: checkoutUrl.toString(),
    status: "initialized",
    idempotent: payload.idempotent,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new BundleUpGatewayUnresolvedError("unknown");
  }

  if (!response.body) {
    if (response.status === 200 || response.status === 409 || response.status >= 500) {
      throw new BundleUpGatewayUnresolvedError("unknown");
    }
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The response is already unresolved; stream cancellation is best-effort.
        }
        throw new BundleUpGatewayUnresolvedError("unknown");
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response is already unresolved; stream cancellation is best-effort.
    }
    throw new BundleUpGatewayUnresolvedError("unknown");
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let rawBody: string;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  } catch {
    throw new BundleUpGatewayUnresolvedError("unknown");
  }
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new BundleUpGatewayUnresolvedError("unknown");
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort; the response remains unresolved.
  }
}

function unresolvedFromResponse(payload: unknown): BundleUpGatewayUnresolvedError {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const state = record.status === "initializing" || record.status === "initialization_unknown"
      ? record.status
      : "unknown";
    const fields = validateConflictFields(record);
    return new BundleUpGatewayUnresolvedError(state, fields.intentId, fields.reference);
  }
  return new BundleUpGatewayUnresolvedError("unknown");
}

export async function initializeBundleUpPaymentIntent(
  input: BundleUpGatewayPaymentIntentInput,
): Promise<BundleUpGatewayPaymentIntent> {
  const config = getGatewayConfig();
  const { amountMinor, customerEmail } = validateInput(input);
  const idempotencyKey = input.paymentId;
  const bodyBytes = Buffer.from(JSON.stringify({
    order_id: input.orderId,
    amount_minor: amountMinor,
    currency: "GHS",
    customer_email: customerEmail,
    return_url: config.returnUrl,
  }), "utf8");
  const timestamp = createRequestTimestamp();
  const nonce = createRequestNonce();
  if (!NONCE_PATTERN.test(nonce)) {
    throw new BundleUpGatewayError("Unable to create gateway request authentication.", "CONFIGURATION");
  }
  const canonicalMessage = buildBundleUpGatewayCanonicalMessage({
    timestamp,
    nonce,
    idempotencyKey,
    bodyBytes,
  });
  const signature = crypto.createHmac("sha256", config.secret).update(canonicalMessage, "utf8").digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-Vanta-Timestamp": timestamp,
        "X-Vanta-Nonce": nonce,
        "X-Vanta-Signature": signature,
      },
      body: new Uint8Array(bodyBytes),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await cancelResponseBody(response);
      throw new BundleUpGatewayUnresolvedError("unknown");
    }
    if (DEFINITIVE_REJECTION_STATUSES.has(response.status)) {
      await cancelResponseBody(response);
      throw new BundleUpGatewayError("BundleUp gateway rejected the payment intent request.", "HTTP", response.status);
    }
    payload = await readResponse(response);
  } catch (error) {
    if (error instanceof BundleUpGatewayError) throw error;
    throw new BundleUpGatewayUnresolvedError("unknown");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status !== 200) {
    throw unresolvedFromResponse(payload);
  }

  try {
    return validateSuccessResponse(
      payload,
      config.checkoutHosts,
      deriveBundleUpGatewayIntentId(input.paymentId),
    );
  } catch {
    throw new BundleUpGatewayUnresolvedError("unknown");
  }
}

type ReconciliationPayload = {
  version: 1;
  key_id: string;
  tenant_id: "vanta";
  payment_id: string;
  order_reference: string;
  intent_id: string | null;
  request_nonce: string;
  issued_at: string;
  outcome: "payment_verified" | "initialized" | "pending" | "failed" | "unresolved" | "not_found";
  reason?: string;
  provider?: "paystack";
  reference?: string;
  amount_minor?: number;
  currency?: "GHS";
  provider_status?: "success" | "ongoing" | "pending" | "failed";
  verified_at?: string;
  transaction_id?: string | null;
};

function decodeCanonicalBase64Url(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url encoding.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Non-canonical base64url encoding.");
  }
  return decoded;
}

function parseEvidencePublicKeys(): Map<string, crypto.KeyObject> {
  const encodedMap = process.env.VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS ?? "";
  if (!encodedMap) {
    throw new BundleUpGatewayError("BundleUp evidence verification keys are not configured.", "CONFIGURATION");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedMap) as unknown;
  } catch {
    throw new BundleUpGatewayError("BundleUp evidence verification keys are invalid.", "CONFIGURATION");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BundleUpGatewayError("BundleUp evidence verification keys are invalid.", "CONFIGURATION");
  }

  const keys = new Map<string, crypto.KeyObject>();
  for (const [keyId, pem] of Object.entries(parsed)) {
    if (!EVIDENCE_KEY_ID_PATTERN.test(keyId) || typeof pem !== "string" || !pem) {
      throw new BundleUpGatewayError("BundleUp evidence verification keys are invalid.", "CONFIGURATION");
    }
    try {
      const publicKey = crypto.createPublicKey(pem);
      if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error("Wrong public key type.");
      }
      keys.set(keyId, publicKey);
    } catch {
      throw new BundleUpGatewayError("BundleUp evidence verification keys are invalid.", "CONFIGURATION");
    }
  }
  if (keys.size === 0) {
    throw new BundleUpGatewayError("BundleUp evidence verification keys are invalid.", "CONFIGURATION");
  }
  return keys;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function expectedPayloadKeys(payload: Record<string, unknown>): string[] | null {
  const common = [
    "version",
    "key_id",
    "tenant_id",
    "payment_id",
    "order_reference",
    "intent_id",
    "request_nonce",
    "issued_at",
    "outcome",
  ];
  if (payload.outcome === "unresolved" || payload.outcome === "not_found") {
    return payload.reason === undefined ? common : [...common, "reason"];
  }
  if (PROVIDER_OUTCOMES.has(String(payload.outcome))) {
    return [
      ...common,
      "provider",
      "reference",
      "amount_minor",
      "currency",
      "provider_status",
      "verified_at",
      "transaction_id",
    ];
  }
  return null;
}

function validateReconciliationPayload(
  value: unknown,
  terms: BundleUpGatewayEvidenceTerms,
  requestNonce: string,
  now: number,
  allowHistorical = false,
): ReconciliationPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid evidence payload.");
  }
  const payload = value as Record<string, unknown>;
  const expectedKeys = expectedPayloadKeys(payload);
  if (!expectedKeys || !hasExactKeys(payload, expectedKeys)) {
    throw new Error("Invalid evidence payload shape.");
  }

  const paymentId = terms.paymentId.toLowerCase();
  if (
    payload.version !== 1
    || typeof payload.key_id !== "string"
    || !EVIDENCE_KEY_ID_PATTERN.test(payload.key_id)
    || payload.tenant_id !== "vanta"
    || payload.payment_id !== paymentId
    || payload.order_reference !== terms.orderReference
    || payload.request_nonce !== requestNonce
    || !isCanonicalTimestamp(payload.issued_at)
    || (!allowHistorical && Math.abs(now - Date.parse(payload.issued_at)) > MAX_CLOCK_SKEW_MS)
  ) {
    throw new Error("Evidence does not match the reconciliation request.");
  }

  if (payload.intent_id !== null && !validateIntentId(payload.intent_id)) {
    throw new Error("Invalid evidence intent identity.");
  }
  if (payload.intent_id !== null && terms.intentId && payload.intent_id !== terms.intentId) {
    throw new Error("Evidence intent identity mismatch.");
  }
  if (payload.outcome === "not_found") {
    if (payload.intent_id !== null || payload.reason !== "intent_not_found") {
      throw new Error("Invalid not-found outcome.");
    }
  } else if (payload.outcome === "unresolved") {
    if (payload.reason !== undefined && (
      typeof payload.reason !== "string" || !UNRESOLVED_REASONS.has(payload.reason)
    )) {
      throw new Error("Invalid unresolved reason.");
    }
  } else if (PROVIDER_OUTCOMES.has(String(payload.outcome))) {
    const deterministicIntentId = deriveBundleUpGatewayIntentId(paymentId);
    if (
      typeof payload.intent_id !== "string"
      || payload.provider !== "paystack"
      || typeof payload.reference !== "string"
      || !validateIntentId(payload.intent_id)
      || payload.intent_id !== deterministicIntentId
      || payload.reference !== `VANTA-${payload.intent_id}`
      || payload.amount_minor !== terms.amountMinor
      || !Number.isSafeInteger(payload.amount_minor)
      || payload.amount_minor <= 0
      || payload.currency !== terms.currency
      || !isCanonicalTimestamp(payload.verified_at)
      || Date.parse(payload.verified_at) > Date.parse(payload.issued_at)
      || (!allowHistorical && Date.parse(payload.verified_at) > now + MAX_CLOCK_SKEW_MS)
      || !(
        payload.transaction_id === null
        || (
          typeof payload.transaction_id === "string"
          && payload.transaction_id.length > 0
          && payload.transaction_id.length <= 128
        )
      )
    ) {
      throw new Error("Provider evidence is invalid.");
    }
    if (terms.providerReference && payload.reference !== terms.providerReference) {
      throw new Error("Provider reference mismatch.");
    }
    if (payload.outcome === "payment_verified" && payload.provider_status !== "success") {
      throw new Error("Provider success evidence is invalid.");
    }
    if (payload.outcome === "initialized" && payload.provider_status !== "ongoing") {
      throw new Error("Initialized provider observation is invalid.");
    }
    if (payload.outcome === "pending" && payload.provider_status !== "pending") {
      throw new Error("Pending provider observation is invalid.");
    }
    if (payload.outcome === "failed" && payload.provider_status !== "failed") {
      throw new Error("Failed provider observation is invalid.");
    }
  }

  if (
    (payload.outcome === "payment_verified" || payload.outcome === "initialized"
      || payload.outcome === "pending" || payload.outcome === "failed")
    && terms.intentId !== null
    && payload.intent_id !== terms.intentId
  ) {
    throw new Error("Evidence intent identity mismatch.");
  }

  return payload as ReconciliationPayload;
}

function verifyReconciliationEnvelope(
  value: unknown,
  terms: BundleUpGatewayEvidenceTerms,
  requestNonce: string,
  now: number,
  requestId: string,
  allowHistorical = false,
): { payload: ReconciliationPayload; proof: BundleUpGatewayVerifiedResponse } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid evidence envelope.");
  }
  const envelope = value as Record<string, unknown>;
  if (
    Object.keys(envelope).length !== 2
    || typeof envelope.payload !== "string"
    || typeof envelope.signature !== "string"
  ) {
    throw new Error("Invalid evidence envelope.");
  }

  const payloadBytes = decodeCanonicalBase64Url(envelope.payload);
  const signatureBytes = decodeCanonicalBase64Url(envelope.signature);
  if (signatureBytes.length !== 64) {
    throw new Error("Invalid Ed25519 signature length.");
  }

  let payloadText: string;
  let untrustedPayload: unknown;
  try {
    payloadText = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
    untrustedPayload = JSON.parse(payloadText) as unknown;
  } catch {
    throw new Error("Evidence payload is not valid UTF-8 JSON.");
  }
  if (
    !untrustedPayload
    || typeof untrustedPayload !== "object"
    || Array.isArray(untrustedPayload)
    || typeof (untrustedPayload as Record<string, unknown>).key_id !== "string"
  ) {
    throw new Error("Evidence key ID is invalid.");
  }

  const keyId = (untrustedPayload as Record<string, unknown>).key_id as string;
  const publicKey = parseEvidencePublicKeys().get(keyId);
  if (!publicKey) {
    throw new Error("Unknown evidence signing key.");
  }
  if (!crypto.verify(null, payloadBytes, publicKey, signatureBytes)) {
    throw new Error("Evidence signature is invalid.");
  }

  const payload = validateReconciliationPayload(untrustedPayload, terms, requestNonce, now, allowHistorical);
  return {
    payload,
    proof: {
      requestId,
      payloadBytes: new Uint8Array(payloadBytes),
      signatureBytes: new Uint8Array(signatureBytes),
      keyId,
      requestNonce,
      issuedAt: payload.issued_at,
      claims: {
        version: 1,
        tenantId: "vanta",
        paymentId: payload.payment_id,
        orderReference: payload.order_reference,
        intentId: payload.intent_id,
        outcome: payload.outcome,
        ...(payload.provider === undefined ? {} : { provider: payload.provider }),
        ...(payload.reference === undefined ? {} : { reference: payload.reference }),
        ...(payload.amount_minor === undefined ? {} : { amountMinor: payload.amount_minor }),
        ...(payload.currency === undefined ? {} : { currency: payload.currency }),
        ...(payload.provider_status === undefined ? {} : { providerStatus: payload.provider_status }),
        ...(payload.verified_at === undefined ? {} : { verifiedAt: payload.verified_at }),
        ...(payload.transaction_id === undefined ? {} : { transactionId: payload.transaction_id }),
        ...(payload.reason === undefined ? {} : { reason: payload.reason }),
      },
    },
  };
}

export function verifyStoredBundleUpGatewayEvidence(input: {
  paymentId: string;
  orderReference: string;
  amountMinor: number;
  currency: "GHS";
  intentId: string | null;
  providerReference: string | null;
  requestId: string;
  requestNonce: string;
  payloadBytes: Uint8Array;
  signatureBytes: Uint8Array;
  now?: number;
}): BundleUpGatewayVerifiedResponse {
  const { proof } = verifyReconciliationEnvelope(
    {
      payload: Buffer.from(input.payloadBytes).toString("base64url"),
      signature: Buffer.from(input.signatureBytes).toString("base64url"),
    },
    {
      paymentId: input.paymentId,
      orderReference: input.orderReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      intentId: input.intentId,
      providerReference: input.providerReference,
    },
    input.requestNonce,
    input.now ?? Date.now(),
    input.requestId,
    true,
  );
  if (proof.claims.outcome !== "payment_verified") {
    throw new Error("Stored gateway evidence is not a verified payment.");
  }
  return proof;
}

function reconciliationResult(
  payload: ReconciliationPayload,
  proof: BundleUpGatewayVerifiedResponse,
): BundleUpGatewayReconciliationResult {
  if (payload.outcome === "unresolved") {
    return { status: "unresolved", reason: payload.reason ?? "gateway_unresolved", proof };
  }
  if (payload.outcome === "not_found") {
    return { status: "not_found", proof };
  }
  const observation: BundleUpGatewayProviderObservation = {
    intentId: payload.intent_id as string,
    provider: "paystack",
    reference: payload.reference as string,
    amountMinor: payload.amount_minor as number,
    currency: "GHS",
    providerStatus: payload.provider_status as BundleUpGatewayProviderObservation["providerStatus"],
    verifiedAt: payload.verified_at as string,
    transactionId: payload.transaction_id as string | null,
  };
  if (payload.outcome === "payment_verified") {
    return { status: "payment_verified", evidence: observation, proof };
  }
  return { status: payload.outcome, observation, proof };
}

export async function reconcileBundleUpPaymentIntent(
  terms: BundleUpGatewayEvidenceTerms,
  persistRequest: PersistBundleUpGatewayReconciliationRequest,
): Promise<BundleUpGatewayReconciliationResult> {
  const config = getGatewayRequestConfig();
  const amountMinor = terms.amountMinor;
  if (
    !UUID_V4_PATTERN.test(terms.paymentId)
    || !ORDER_ID_PATTERN.test(terms.orderReference)
    || terms.orderReference.trim() !== terms.orderReference
    || !Number.isSafeInteger(amountMinor)
    || amountMinor <= 0
    || terms.currency !== "GHS"
    || (terms.intentId !== null && !validateIntentId(terms.intentId))
    || (terms.providerReference !== null && terms.intentId !== null
      && terms.providerReference !== `VANTA-${terms.intentId}`)
  ) {
    return { status: "unresolved", reason: "invalid_persisted_attempt" };
  }

  const paymentId = terms.paymentId.toLowerCase();
  const bodyObject: Record<string, string | number> = {
    tenant_id: "vanta",
    payment_id: paymentId,
    order_reference: terms.orderReference,
    amount_minor: amountMinor,
    currency: "GHS",
  };
  if (terms.intentId) bodyObject.intent_id = terms.intentId;
  const bodyBytes = Buffer.from(JSON.stringify(bodyObject), "utf8");
  const timestamp = createRequestTimestamp();
  const nonce = createRequestNonce();
  const requestId = crypto.randomUUID();
  if (!NONCE_PATTERN.test(nonce)) {
    return { status: "unresolved", reason: "request_nonce_invalid" };
  }
  try {
    await persistRequest({
      requestId,
      paymentId,
      requestNonce: nonce,
      requestTimestamp: timestamp,
      requestBody: new Uint8Array(bodyBytes),
    });
  } catch {
    return { status: "unresolved", reason: "reconciliation_request_persistence_failed" };
  }
  const canonicalMessage = buildBundleUpGatewayCanonicalMessage({
    timestamp,
    nonce,
    idempotencyKey: paymentId,
    bodyBytes,
    path: PAYMENT_INTENTS_RECONCILE_PATH,
  });
  const signature = crypto.createHmac("sha256", config.secret)
    .update(canonicalMessage, "utf8")
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let envelope: unknown;
  try {
    response = await fetch(`${config.baseUrl}${PAYMENT_INTENTS_RECONCILE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": paymentId,
        "X-Vanta-Timestamp": timestamp,
        "X-Vanta-Nonce": nonce,
        "X-Vanta-Signature": signature,
      },
      body: new Uint8Array(bodyBytes),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await cancelResponseBody(response);
      return { status: "unresolved", reason: "unsigned_or_unavailable_response" };
    }
    envelope = await readResponse(response);
  } catch {
    return { status: "unresolved", reason: "reconciliation_unavailable" };
  } finally {
    clearTimeout(timeout);
  }

  try {
    const { payload, proof } = verifyReconciliationEnvelope(
      envelope,
      { ...terms, paymentId },
      nonce,
      Date.now(),
      requestId,
    );
    return reconciliationResult(payload, proof);
  } catch {
    return { status: "unresolved", reason: "invalid_or_mismatched_evidence" };
  }
}
