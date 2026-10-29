import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import { createSupabaseAdminClient } from "../../../../../lib/supabase/server";
import { claimOrder, releaseOrderClaim } from "../../../../../lib/fulfillment/claims";
import { fulfillPaidOrder, loadDynamicOrderExecutionContext } from "../../../../../lib/fulfillment/worker";
import { resolveProviderForService } from "../../../../../lib/fulfillment/resolver";
import { buildReliableSMMProviderRequest } from "../../../../../lib/fulfillment/reliablesmm/request";
import { assertReliableSMMTarget } from "../../../../../lib/fulfillment/reliablesmm/target";

const CANARY_ORDER_ID = "ab1030cc-41b9-4f57-bae8-4226d9f6423d";
const CANARY_PROVIDER_SERVICE_ID = "2037";
const SAFE_ERROR_CODES = new Set([
  "INVALID_QUANTITY",
  "MISSING_API_KEY",
  "INVALID_REQUEST_INTERVAL",
  "PROVIDER_RATE_LIMITED",
  "HTTP_ERROR",
  "MALFORMED_JSON",
  "PROVIDER_REJECTED",
  "TIMEOUT",
  "NETWORK_ERROR",
]);

function safeErrorDetails(error: unknown) {
  const candidateName = error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name
    : "";
  const errorName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(candidateName)
    ? candidateName
    : "UnknownError";
  const candidateCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
  const errorCode = SAFE_ERROR_CODES.has(candidateCode) || /^[0-9]{5}$/.test(candidateCode)
    ? candidateCode
    : "UNCLASSIFIED_ERROR";

  return { errorName, errorCode };
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  let executionStage = "request_validation";
  const respond = (status: number, guardDecision: string, body: Record<string, unknown>) => {
    console.info(JSON.stringify({
      event: "fulfillment_canary_request",
      requestId,
      guardDecision,
      responseStatus: status,
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json(body, { status, headers: { "x-request-id": requestId } });
  };

  console.info(JSON.stringify({
    event: "fulfillment_canary_received",
    requestId,
    timestamp: new Date().toISOString(),
  }));

  try {
    executionStage = "authentication";
    const expected = process.env.CRON_SECRET;
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return respond(401, "unauthorized", { error: "Unauthorized" });
    if (process.env.PANELS_LIVE_FULFILLMENT_ENABLED !== "true") return respond(423, "live_fulfillment_disabled", { error: "Live fulfillment is disabled." });
    if (!process.env.RELIABLESMM_API_KEY) return respond(503, "provider_not_configured", { error: "ReliableSMM is not configured." });
    if (process.env.RELIABLESMM_CANARY_ORDER_ID !== CANARY_ORDER_ID) {
      return respond(423, "canary_order_pin_mismatch", { error: "The configured ReliableSMM canary order does not match the approved order." });
    }

    let body: { orderId?: unknown };
    try {
      body = await request.json() as { orderId?: unknown };
    } catch {
      return respond(400, "invalid_json", { error: "A valid orderId is required." });
    }
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return respond(400, "invalid_order_id", { error: "A valid orderId is required." });
    if (orderId !== CANARY_ORDER_ID) return respond(403, "order_not_in_canary_allowlist", { error: "Only the approved canary order may be submitted." });

    executionStage = "order_lookup";
    const admin = createSupabaseAdminClient();
    const { data: order, error } = await admin.from("orders").select("id,total,currency,payment_status,fulfillment_status,target_type,target_value,quantity,services!inner(slug,platforms(slug))").eq("id", orderId).maybeSingle();
    if (error) return respond(500, "order_lookup_failed", { error: "Unable to load the requested order." });
    if (!order) return respond(404, "order_not_found", { error: "Order not found." });
    if (order.payment_status !== "PAID" || order.fulfillment_status !== "NOT_STARTED") {
      return respond(409, "order_state_ineligible", { error: "Order is not eligible for the canary." });
    }
    if (Number(order.quantity) !== 100 || Number(order.total) !== 0.1 || order.currency !== "GHS") {
      return respond(409, "order_amount_or_currency_mismatch", { error: "The approved canary order no longer matches its authorized quantity, total, and currency." });
    }

    const service = Array.isArray(order.services) ? order.services[0] : order.services;
    const rawPlatform = service?.platforms;
    const platform = Array.isArray(rawPlatform) ? rawPlatform[0] : rawPlatform;
    if (service?.slug !== "instagram-views") return respond(409, "service_mismatch", { error: "The approved canary service does not match this order." });
    executionStage = "provider_mapping";
    const mapping = service?.slug ? await resolveProviderForService(service.slug) : null;
    if (!mapping || mapping.mapping.provider !== "reliablesmm" || mapping.mapping.providerServiceId !== CANARY_PROVIDER_SERVICE_ID) {
      return respond(423, "provider_mapping_mismatch", { error: "The approved ReliableSMM service mapping is missing or changed." });
    }
    executionStage = "dynamic_mapping";
    const dynamic = await loadDynamicOrderExecutionContext(order.id);
    if (!dynamic || dynamic.provider !== "reliablesmm" || dynamic.providerServiceId !== CANARY_PROVIDER_SERVICE_ID) {
      return respond(423, "dynamic_mapping_mismatch", { error: "The order's active dynamic mapping does not match the approved canary service." });
    }
    let validatedTarget: string;
    try {
      validatedTarget = assertReliableSMMTarget({
        platformSlug: platform && typeof platform === "object" ? String(platform.slug ?? "") : "",
        targetType: order.target_type,
        targetValue: String(dynamic.payload.link ?? ""),
      }).link;
    } catch {
      return respond(409, "target_invalid", { error: "The order target does not match the configured service target type." });
    }
    let preparedRequest: ReturnType<typeof buildReliableSMMProviderRequest>;
    executionStage = "provider_request_validation";
    try {
      preparedRequest = buildReliableSMMProviderRequest({
        providerServiceId: dynamic.providerServiceId,
        quantity: order.quantity,
        targetValue: validatedTarget,
        payload: dynamic.payload,
      });
    } catch (error) {
      return respond(409, "provider_request_invalid", { error: error instanceof Error ? error.message : "The canary provider request is invalid." });
    }
    if (preparedRequest.request.service !== 2037 || preparedRequest.request.link !== validatedTarget) {
      return respond(409, "provider_request_mismatch", { error: "The canary provider request does not match the approved service and normalized target." });
    }

    const ownerToken = crypto.randomUUID();
    executionStage = "order_claim";
    if (!(await claimOrder(order.id, ownerToken))) return respond(409, "order_claim_unavailable", { error: "The requested order is already claimed." });

    let result: unknown;
    let workerError: unknown;
    let workerFailed = false;
    executionStage = "worker_fulfillment";
    try {
      result = await fulfillPaidOrder({
        orderId: order.id,
        vantaSlug: service.slug,
        targetType: order.target_type,
        targetValue: order.target_value,
        quantity: order.quantity,
        allowLiveSubmission: true,
        canaryOrderAuthorization: true,
      });
    } catch (error) {
      workerFailed = true;
      workerError = error;
      const { errorName, errorCode } = safeErrorDetails(error);
      console.error(JSON.stringify({
        event: "fulfillment_canary_worker_failed",
        requestId,
        errorName,
        errorCode,
        executionStage,
        timestamp: new Date().toISOString(),
      }));
    } finally {
      executionStage = "claim_release";
      await releaseOrderClaim(order.id, ownerToken);
    }
    if (workerFailed) {
      const { errorName, errorCode } = safeErrorDetails(workerError);
      return respond(502, "fulfillment_failed", {
        error: "Canary fulfillment failed.",
        errorName,
        errorCode,
        executionStage: "worker_fulfillment",
        requestId,
      });
    }
    return respond(200, "canary_submission_completed", { orderId: order.id, result });
  } catch (error) {
    const { errorName, errorCode } = safeErrorDetails(error);
    console.error(JSON.stringify({
      event: "fulfillment_canary_unhandled_error",
      requestId,
      errorName,
      errorCode,
      executionStage,
      timestamp: new Date().toISOString(),
    }));
    return respond(500, "unhandled_error", {
      error: "Canary request failed unexpectedly.",
      errorName,
      errorCode,
      executionStage,
      requestId,
    });
  }
}
