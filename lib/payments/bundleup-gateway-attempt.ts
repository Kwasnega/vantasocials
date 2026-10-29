import "server-only";

import { createSupabaseAdminClient } from "../supabase/server";
import { amountToMinorUnits } from "./paystack";
import {
  BundleUpGatewayError,
  BundleUpGatewayUnresolvedError,
  deriveBundleUpGatewayIntentId,
  initializeBundleUpPaymentIntent,
  reconcileBundleUpPaymentIntent,
  verifyStoredBundleUpGatewayEvidence,
  type BundleUpGatewayEvidenceTerms,
  type BundleUpGatewayReconciliationResult,
  type BundleUpGatewayVerifiedResponse,
} from "./bundleup-gateway";

type GatewayAttempt = {
  id: string;
  order_id: string;
  user_id: string;
  provider: string;
  reference: string;
  amount: string | number;
  currency: string;
  status: string;
  gateway_initialization_status: string;
  gateway_order_reference: string;
  gateway_customer_email: string;
  gateway_return_url: string;
  gateway_intent_id: string | null;
  gateway_reference: string | null;
  gateway_authorization_url: string | null;
};

export type BundleUpGatewayAttemptResult =
  | {
    status: "initialized";
    paymentId: string;
    reference: string;
    authorizationUrl: string;
  }
  | {
    status: "unresolved";
    paymentId: string;
    reference: string;
  }
  | {
    status: "rejected";
    paymentId: string;
    reference: string;
  }
  | {
    status: "paid";
    paymentId: string;
    reference: string;
  }
  | {
    status: "failed";
    paymentId: string;
    reference: string;
  };

function singleRow(data: unknown): GatewayAttempt {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Gateway payment reservation returned no payment attempt.");
  }
  return row as GatewayAttempt;
}

function validateCheckoutUrl(value: string): string {
  const allowedHosts = new Set(
    (process.env.VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Persisted gateway checkout URL is invalid.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.port
    || !allowedHosts.has(url.hostname)
    || url.toString() !== value
  ) {
    throw new Error("Persisted gateway checkout URL is not allowed.");
  }
  return url.toString();
}

function validateAttempt(
  attempt: GatewayAttempt,
  orderId: string,
  userId: string,
  returnUrl: string,
): void {
  if (
    attempt.provider !== "bundleup_gateway"
    || attempt.order_id !== orderId
    || attempt.user_id !== userId
    || !["PENDING", "PAID", "FAILED"].includes(attempt.status)
    || !attempt.id
    || !attempt.reference
    || attempt.currency !== "GHS"
    || attempt.gateway_order_reference.length === 0
    || attempt.gateway_customer_email.length === 0
    || attempt.gateway_return_url !== returnUrl
  ) {
    throw new Error("Persisted gateway payment attempt does not match the requested order.");
  }
  if (
    (attempt.gateway_initialization_status === "INITIALIZATION_REJECTED" && attempt.status !== "FAILED")
    || (
      attempt.status === "FAILED"
      && !["INITIALIZATION_REJECTED", "INITIALIZED"].includes(attempt.gateway_initialization_status)
    )
  ) {
    throw new Error("Persisted gateway payment status is inconsistent.");
  }
  const minor = amountToMinorUnits(String(attempt.amount));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Persisted gateway payment amount is invalid.");
  }
}

async function callRpc(
  rpcName: string,
  args: Record<string, string | Uint8Array>,
): Promise<unknown> {
  const { data, error } = await createSupabaseAdminClient().rpc(rpcName, args);
  if (error) throw error;
  return data;
}

function asPostgresBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

function sameStableEvidence(
  row: Record<string, unknown> | null,
  proof: BundleUpGatewayVerifiedResponse,
): boolean {
  const claims = proof.claims;
  return Boolean(
    row
    && row.payment_id === claims.paymentId
    && row.tenant_id === claims.tenantId
    && row.order_reference === claims.orderReference
    && row.intent_id === claims.intentId
    && row.provider === claims.provider
    && row.provider_reference === claims.reference
    && Number(row.amount_minor) === claims.amountMinor
    && row.currency === claims.currency
    && row.provider_status === claims.providerStatus
    && typeof row.verified_at === "string"
    && Date.parse(row.verified_at) === Date.parse(claims.verifiedAt ?? "")
    && (row.transaction_id ?? null) === (claims.transactionId ?? null),
  );
}

function fromPostgresBytea(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("\\x")) return null;
  const hex = value.slice(2);
  if (hex.length % 2 !== 0 || !/^(?:[0-9a-f]{2})*$/i.test(hex)) return null;
  return new Uint8Array(Buffer.from(hex, "hex"));
}

async function verifyAlreadySettledAttempt(
  attempt: GatewayAttempt,
  terms: BundleUpGatewayEvidenceTerms,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const [orderResult, evidenceResult] = await Promise.all([
    admin.from("orders")
      .select("id,user_id,status,payment_status")
      .eq("id", attempt.order_id)
      .eq("user_id", attempt.user_id)
      .maybeSingle(),
    admin.from("bundleup_gateway_payment_evidence")
      .select("payment_id,request_id,tenant_id,order_reference,intent_id,provider,provider_reference,amount_minor,currency,provider_status,verified_at,transaction_id,request_nonce,signed_payload,signature")
      .eq("payment_id", attempt.id)
      .maybeSingle(),
  ]);
  if (orderResult.error || evidenceResult.error) return false;
  const order = orderResult.data as Record<string, unknown> | null;
  const evidence = evidenceResult.data as Record<string, unknown> | null;
  if (
    !order
    || order.status !== "PENDING_PAYMENT"
    || order.payment_status !== "PAID"
    || !evidence
    || evidence.payment_id !== attempt.id
    || evidence.tenant_id !== "vanta"
    || evidence.order_reference !== terms.orderReference
    || evidence.provider !== "paystack"
    || Number(evidence.amount_minor) !== terms.amountMinor
    || evidence.currency !== terms.currency
    || evidence.provider_status !== "success"
  ) {
    return false;
  }

  const payloadBytes = fromPostgresBytea(evidence.signed_payload);
  const signatureBytes = fromPostgresBytea(evidence.signature);
  if (!payloadBytes || !signatureBytes
      || typeof evidence.request_id !== "string"
      || typeof evidence.request_nonce !== "string") {
    return false;
  }
  let proof: BundleUpGatewayVerifiedResponse;
  try {
    proof = verifyStoredBundleUpGatewayEvidence({
      ...terms,
      currency: "GHS",
      requestId: evidence.request_id,
      requestNonce: evidence.request_nonce,
      payloadBytes,
      signatureBytes,
    });
  } catch {
    return false;
  }
  if (!sameStableEvidence(evidence, proof)) return false;

  const [requestResult, claimResult] = await Promise.all([
    admin.from("bundleup_gateway_reconciliation_requests")
      .select("id,payment_id,user_id,request_nonce,state,response_outcome,response_payload,response_signature")
      .eq("id", evidence.request_id)
      .eq("payment_id", attempt.id)
      .eq("user_id", attempt.user_id)
      .maybeSingle(),
    admin.from("payment_provider_reference_claims")
      .select("provider,actual_provider_reference,payment_id")
      .eq("provider", "paystack")
      .eq("actual_provider_reference", proof.claims.reference ?? "")
      .maybeSingle(),
  ]);
  if (requestResult.error || claimResult.error) return false;
  const request = requestResult.data as Record<string, unknown> | null;
  const claim = claimResult.data as Record<string, unknown> | null;
  const requestPayload = fromPostgresBytea(request?.response_payload);
  const requestSignature = fromPostgresBytea(request?.response_signature);
  return Boolean(
    request
    && request.state === "CONSUMED"
    && request.response_outcome === "payment_verified"
    && request.request_nonce === evidence.request_nonce
    && requestPayload
    && Buffer.from(requestPayload).equals(Buffer.from(payloadBytes))
    && requestSignature
    && Buffer.from(requestSignature).equals(Buffer.from(signatureBytes))
    && claim
    && claim.payment_id === attempt.id,
  );
}

async function verifyCommittedSettlement(
  paymentId: string,
  userId: string,
  proof: BundleUpGatewayVerifiedResponse,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const [paymentResult, evidenceResult] = await Promise.all([
    admin.from("payments")
      .select("id,order_id,user_id,provider,status")
      .eq("id", paymentId)
      .eq("user_id", userId)
      .eq("provider", "bundleup_gateway")
      .maybeSingle(),
    admin.from("bundleup_gateway_payment_evidence")
      .select("payment_id,request_id,tenant_id,order_reference,intent_id,provider,provider_reference,amount_minor,currency,provider_status,verified_at,transaction_id,signed_payload,signature")
      .eq("payment_id", paymentId)
      .maybeSingle(),
  ]);
  if (paymentResult.error || evidenceResult.error) return false;
  const payment = paymentResult.data as GatewayAttempt | null;
  const evidence = evidenceResult.data as Record<string, unknown> | null;
  if (!payment || !sameStableEvidence(evidence, proof)) return false;
  const storedPayload = fromPostgresBytea(evidence?.signed_payload);
  const storedSignature = fromPostgresBytea(evidence?.signature);
  if (
    !storedPayload
    || !storedSignature
  ) return false;
  if (payment.status !== "PAID" || payment.provider !== "bundleup_gateway") return false;

  const [orderResult, requestResult, claimResult] = await Promise.all([
    admin.from("orders")
      .select("id,user_id,status,payment_status")
      .eq("id", payment.order_id)
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("bundleup_gateway_reconciliation_requests")
      .select("id,payment_id,user_id,request_nonce,state,response_outcome,response_payload,response_signature")
      .eq("id", proof.requestId)
      .eq("payment_id", paymentId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("payment_provider_reference_claims")
      .select("provider,actual_provider_reference,payment_id")
      .eq("provider", "paystack")
      .eq("actual_provider_reference", proof.claims.reference ?? "")
      .maybeSingle(),
  ]);
  if (orderResult.error || requestResult.error || claimResult.error) return false;
  const order = orderResult.data as Record<string, unknown> | null;
  const request = requestResult.data as Record<string, unknown> | null;
  const claim = claimResult.data as Record<string, unknown> | null;
  const evidencePayload = fromPostgresBytea(evidence?.signed_payload);
  const evidenceSignature = fromPostgresBytea(evidence?.signature);
  const requestPayload = fromPostgresBytea(request?.response_payload);
  const requestSignature = fromPostgresBytea(request?.response_signature);
  let canonicalProof: BundleUpGatewayVerifiedResponse | null = null;
  if (
    evidencePayload
    && evidenceSignature
    && typeof evidence?.request_id === "string"
    && typeof evidence?.request_nonce === "string"
  ) {
    try {
      canonicalProof = verifyStoredBundleUpGatewayEvidence({
        paymentId,
        orderReference: proof.claims.orderReference,
        amountMinor: proof.claims.amountMinor ?? 0,
        currency: "GHS",
        intentId: proof.claims.intentId,
        providerReference: proof.claims.reference ?? null,
        requestId: evidence.request_id,
        requestNonce: evidence.request_nonce,
        payloadBytes: evidencePayload,
        signatureBytes: evidenceSignature,
      });
    } catch {
      canonicalProof = null;
    }
  }
  return Boolean(
    order
    && order.status === "PENDING_PAYMENT"
    && order.payment_status === "PAID"
    && request
    && request.payment_id === paymentId
    && request.request_nonce === proof.requestNonce
    && request.state === "CONSUMED"
    && request.response_outcome === "payment_verified"
    && requestPayload
    && Buffer.from(requestPayload).equals(Buffer.from(proof.payloadBytes))
    && requestSignature
    && Buffer.from(requestSignature).equals(Buffer.from(proof.signatureBytes))
    && (
      evidence?.request_id !== proof.requestId
      || (
        evidencePayload
        && Buffer.from(evidencePayload).equals(Buffer.from(proof.payloadBytes))
        && evidenceSignature
        && Buffer.from(evidenceSignature).equals(Buffer.from(proof.signatureBytes))
      )
    )
    && canonicalProof
    && sameStableEvidence(evidence, canonicalProof)
    && sameStableEvidence(evidence, proof)
    && claim
    && claim.payment_id === paymentId,
  );
}

function postgresProofArgs(proof: BundleUpGatewayVerifiedResponse) {
  return {
    p_request_id: proof.requestId,
    p_signed_payload: asPostgresBytea(proof.payloadBytes),
    p_signature: asPostgresBytea(proof.signatureBytes),
  };
}

async function markUnknown(paymentId: string, userId: string): Promise<void> {
  await callRpc("mark_bundleup_gateway_payment_unknown", {
    p_payment_id: paymentId,
    p_expected_user_id: userId,
  });
}

function isDefinitiveRejection(error: unknown): boolean {
  if (!(error instanceof BundleUpGatewayError) || error instanceof BundleUpGatewayUnresolvedError) {
    return false;
  }
  if (error.code === "CONFIGURATION" || error.code === "INVALID_INPUT") return true;
  return error.code === "HTTP" && [400, 401, 403, 404, 405, 413, 415, 422].includes(error.status ?? 0);
}

async function resultForExistingState(
  attempt: GatewayAttempt,
): Promise<BundleUpGatewayAttemptResult> {
  if (attempt.status === "PAID") {
    return { status: "paid", paymentId: attempt.id, reference: attempt.reference };
  }
  if (attempt.status === "FAILED") {
    return attempt.gateway_initialization_status === "INITIALIZATION_REJECTED"
      ? { status: "rejected", paymentId: attempt.id, reference: attempt.reference }
      : { status: "failed", paymentId: attempt.id, reference: attempt.reference };
  }
  if (attempt.gateway_initialization_status === "INITIALIZED") {
    if (!attempt.gateway_authorization_url) {
      throw new Error("Initialized gateway payment is missing its checkout URL.");
    }
    return {
      status: "initialized",
      paymentId: attempt.id,
      reference: attempt.reference,
      authorizationUrl: validateCheckoutUrl(attempt.gateway_authorization_url),
    };
  }
  if (attempt.gateway_initialization_status === "INITIALIZATION_REJECTED") {
    return { status: "rejected", paymentId: attempt.id, reference: attempt.reference };
  }
  return { status: "unresolved", paymentId: attempt.id, reference: attempt.reference };
}

export async function initializeBundleUpGatewayAttempt(input: {
  orderId: string;
  userId: string;
}): Promise<BundleUpGatewayAttemptResult> {
  if (process.env.VANTA_BUNDLEUP_GATEWAY_ENABLED !== "true") {
    throw new BundleUpGatewayError("BundleUp gateway client is disabled.", "DISABLED");
  }

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

  const reservedData = await callRpc("reserve_bundleup_gateway_payment_attempt", {
    p_order_id: input.orderId,
    p_expected_user_id: input.userId,
    p_return_url: returnUrl,
  });
  const attempt = singleRow(reservedData);
  validateAttempt(attempt, input.orderId, input.userId, returnUrl);

  if (attempt.gateway_initialization_status !== "RESERVED") {
    return resultForExistingState(attempt);
  }

  const claimed = await callRpc("claim_bundleup_gateway_payment_initialization", {
    p_payment_id: attempt.id,
    p_expected_user_id: input.userId,
  });
  if (claimed !== true) {
    return { status: "unresolved", paymentId: attempt.id, reference: attempt.reference };
  }

  let initialized;
  try {
    initialized = await initializeBundleUpPaymentIntent({
      paymentId: attempt.id,
      orderId: attempt.gateway_order_reference,
      amount: String(attempt.amount),
      currency: attempt.currency,
      customerEmail: attempt.gateway_customer_email,
    });
  } catch (error) {
    if (isDefinitiveRejection(error)) {
      const rejected = await callRpc("reject_bundleup_gateway_payment_initialization", {
        p_payment_id: attempt.id,
        p_expected_user_id: input.userId,
      });
      if (rejected === true) {
        return { status: "rejected", paymentId: attempt.id, reference: attempt.reference };
      }
    } else {
      await markUnknown(attempt.id, input.userId);
    }
    return { status: "unresolved", paymentId: attempt.id, reference: attempt.reference };
  }

  const completed = await callRpc("complete_bundleup_gateway_payment_initialization", {
    p_payment_id: attempt.id,
    p_expected_user_id: input.userId,
    p_intent_id: initialized.intent_id,
    p_gateway_reference: initialized.reference,
    p_authorization_url: initialized.authorization_url,
  });
  if (completed !== true) {
    await markUnknown(attempt.id, input.userId);
    return { status: "unresolved", paymentId: attempt.id, reference: attempt.reference };
  }

  return {
    status: "initialized",
    paymentId: attempt.id,
    reference: attempt.reference,
    authorizationUrl: initialized.authorization_url,
  };
}

export async function reconcileBundleUpGatewayAttempt(input: {
  paymentId: string;
  userId: string;
}): Promise<BundleUpGatewayReconciliationResult> {
  if (process.env.VANTA_BUNDLEUP_GATEWAY_ENABLED !== "true") {
    throw new BundleUpGatewayError("BundleUp gateway client is disabled.", "DISABLED");
  }

  const attemptId = input.paymentId.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attemptId)) {
    return { status: "unresolved", reason: "invalid_payment_id" };
  }

  let queryResult;
  try {
    queryResult = await createSupabaseAdminClient()
      .from("payments")
      .select([
        "id",
        "order_id",
        "user_id",
        "provider",
        "amount",
        "currency",
        "status",
        "gateway_initialization_status",
        "gateway_order_reference",
        "gateway_intent_id",
        "gateway_reference",
      ].join(","))
      .eq("id", attemptId)
      .eq("user_id", input.userId)
      .eq("provider", "bundleup_gateway")
      .maybeSingle()
      .overrideTypes<GatewayAttempt>();
  } catch {
    return { status: "unresolved", reason: "payment_attempt_unavailable" };
  }
  if (queryResult.error || !queryResult.data) {
    return { status: "unresolved", reason: "payment_attempt_unavailable" };
  }

  const attempt = queryResult.data;
  if (
    attempt.id.toLowerCase() !== attemptId
    || attempt.user_id !== input.userId
    || attempt.provider !== "bundleup_gateway"
    || !["PENDING", "PAID"].includes(attempt.status)
    || !["INITIALIZING", "INITIALIZATION_UNKNOWN", "INITIALIZED"]
      .includes(attempt.gateway_initialization_status)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(attempt.gateway_order_reference)
    || attempt.gateway_order_reference.trim() !== attempt.gateway_order_reference
    || attempt.currency !== "GHS"
  ) {
    return { status: "unresolved", reason: "payment_attempt_not_reconcilable" };
  }

  let amountMinor: bigint;
  try {
    amountMinor = amountToMinorUnits(String(attempt.amount));
  } catch {
    return { status: "unresolved", reason: "payment_attempt_terms_invalid" };
  }
  if (amountMinor <= 0n || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { status: "unresolved", reason: "payment_attempt_terms_invalid" };
  }

  const intentId = attempt.gateway_intent_id;
  const providerReference = attempt.gateway_reference;
  const expectedIntentId = deriveBundleUpGatewayIntentId(attempt.id);
  if (
    (intentId !== null && !/^[0-9a-f]{64}$/.test(intentId))
    || (intentId !== null && intentId !== expectedIntentId)
    || (providerReference !== null && (
      !intentId || providerReference !== `VANTA-${intentId}`
    ))
    || (
      attempt.gateway_initialization_status === "INITIALIZED"
      && (!intentId || !providerReference)
    )
    || (
      attempt.gateway_initialization_status !== "INITIALIZED"
      && (intentId !== null || providerReference !== null)
    )
  ) {
    return { status: "unresolved", reason: "payment_attempt_identity_invalid" };
  }

  const terms: BundleUpGatewayEvidenceTerms = {
    paymentId: attempt.id,
    orderReference: attempt.gateway_order_reference,
    amountMinor: Number(amountMinor),
    currency: attempt.currency,
    intentId,
    providerReference,
  };
  if (attempt.status === "PAID") {
    return await verifyAlreadySettledAttempt(attempt, terms)
      ? { status: "already_settled", paymentId: attempt.id }
      : { status: "unresolved", reason: "settled_payment_evidence_unavailable" };
  }

  const admin = createSupabaseAdminClient();
  const result = await reconcileBundleUpPaymentIntent(terms, async (request) => {
    const { error } = await admin.rpc("create_bundleup_gateway_reconciliation_request", {
      p_request_id: request.requestId,
      p_payment_id: request.paymentId,
      p_expected_user_id: input.userId,
      p_request_nonce: request.requestNonce,
      p_request_timestamp: request.requestTimestamp,
      p_request_body: asPostgresBytea(request.requestBody),
    });
    if (error) throw error;
  });

  if (result.status === "already_settled") return result;
  if (!("proof" in result) || !result.proof) return result;
  if (result.status !== "payment_verified") {
    try {
      const observationState = await callRpc("record_bundleup_gateway_reconciliation_observation", {
        p_request_id: result.proof.requestId,
        p_payment_id: attempt.id,
        p_expected_user_id: input.userId,
        p_signed_payload: asPostgresBytea(result.proof.payloadBytes),
        p_signature: asPostgresBytea(result.proof.signatureBytes),
        p_outcome: result.proof.claims.outcome,
      });
      if (observationState !== "OBSERVED") {
        return { status: "unresolved", reason: "observation_not_persisted", proof: result.proof };
      }
      return result;
    } catch {
      return { status: "unresolved", reason: "observation_persistence_failed", proof: result.proof };
    }
  }

  try {
    const rpcResult = await callRpc("settle_bundleup_gateway_order_payment", {
      p_payment_id: attempt.id,
      p_expected_user_id: input.userId,
      ...postgresProofArgs(result.proof),
    });
    const settled = firstRow(rpcResult);
    if (
      settled?.settled === true
      && settled.payment_id === attempt.id
      && settled.order_id === attempt.order_id
    ) {
      return {
        ...result,
        settlement: settled.already_settled === true ? "already_settled" : "settled",
      };
    }
  } catch {
    if (await verifyCommittedSettlement(attempt.id, input.userId, result.proof)) {
      return { ...result, settlement: "already_settled" };
    }
    return { status: "unresolved", reason: "settlement_result_ambiguous", proof: result.proof };
  }

  if (await verifyCommittedSettlement(attempt.id, input.userId, result.proof)) {
    return { ...result, settlement: "already_settled" };
  }
  return { status: "unresolved", reason: "settlement_not_confirmed", proof: result.proof };
}
