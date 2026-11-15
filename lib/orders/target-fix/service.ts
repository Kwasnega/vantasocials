import "server-only";
import { createSupabaseAdminClient } from "../../supabase/server";
import { recordOrderEvent } from "../events";
import { retryOrderFulfillment, type RetryResult } from "../../fulfillment/retry-service";
import { normalizeTargetServer as normalizeTarget } from "../../targets/normalize-server";
import { sendTransactionalEmail, renderTargetFixEmail, renderTargetFixSuccessEmail } from "../../email";
import { hashToken, generateFixToken, constantTimeCompare } from "./tokens/crypto";

export { hashToken, generateFixToken, constantTimeCompare };

export type EditTargetAndRetryParams = {
  orderId: string;
  newTarget: string;
  actor: "admin" | "customer";
  actorId?: string; // admin user id if actor is admin
  reason?: string;
};

export type EditTargetAndRetryResult = {
  ok: boolean;
  message: string;
  newCanonical?: string;
  retryResult?: RetryResult;
};

/**
 * Creates or refreshes a fix token and emails the customer a link to /fix-order/[token].
 * Rate limited to at most 1 email per hour, at most 3 total emails per order.
 */
export async function createAndSendFixToken(params: {
  orderId: string;
  adminUserId: string;
}): Promise<{ ok: boolean; message: string; fixUrl?: string }> {
  const db = createSupabaseAdminClient();
  const { orderId, adminUserId } = params;

  // 1. Fetch order details, customer email, service name
  const { data: order, error } = await db
    .from("orders")
    .select("id,public_order_id,user_id,target_value,failure_reason,payment_status,fulfillment_status,refund_status,profiles(email),services(name)")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    return { ok: false, message: "Order not found." };
  }

  if (order.refund_status === "REFUNDED") {
    return { ok: false, message: "Order has been refunded and cannot be modified." };
  }

  if (order.payment_status !== "PAID") {
    return { ok: false, message: "Only paid orders can be fixed." };
  }

  if (order.failure_reason !== "invalid_target" || order.fulfillment_status !== "FAILED") {
    return { ok: false, message: "Only orders failed with 'invalid_target' are eligible for target fix." };
  }

  const customerEmail = (order.profiles as { email?: string } | null)?.email;
  if (!customerEmail) {
    return { ok: false, message: "Customer email not found for this order." };
  }

  // 2. Check existing token & enforce rate limits
  const { data: existingToken } = await db
    .from("order_fix_tokens")
    .select("id,token_hash,expires_at,used_at,send_count,last_sent_at")
    .eq("order_id", orderId)
    .maybeSingle();

  const now = new Date();
  if (existingToken) {
    if (existingToken.used_at) {
      return { ok: false, message: "A previous fix token for this order was already used." };
    }
    if (existingToken.send_count >= 3) {
      return { ok: false, message: "Maximum fix email limit reached for this order (3 emails maximum)." };
    }
    const lastSent = new Date(existingToken.last_sent_at);
    const msSinceLast = now.getTime() - lastSent.getTime();
    if (msSinceLast < 60 * 60 * 1000) {
      const waitMins = Math.ceil((60 * 60 * 1000 - msSinceLast) / 60000);
      return { ok: false, message: `Please wait ${waitMins} minute(s) before resending fix link (rate limit: 1/hr).` };
    }
  }

  // 3. Generate new raw token and calculate hash
  const rawToken = generateFixToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (existingToken) {
    await db
      .from("order_fix_tokens")
      .update({
        token_hash: tokenHash,
        expires_at: expiresAt,
        last_sent_at: now.toISOString(),
        send_count: existingToken.send_count + 1,
      })
      .eq("id", existingToken.id);
  } else {
    await db.from("order_fix_tokens").insert({
      order_id: orderId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      last_sent_at: now.toISOString(),
      send_count: 1,
    });
  }

  // 4. Update order target_fix_status = AWAITING_CUSTOMER
  await db
    .from("orders")
    .update({ target_fix_status: "AWAITING_CUSTOMER" })
    .eq("id", orderId);

  // 5. Record order event
  await recordOrderEvent({
    orderId,
    type: "admin_action",
    actor: `admin:${adminUserId}`,
    message: "Requested target fix from customer via secure link",
    meta: { expires_at: expiresAt },
  });

  // 6. Send email
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://vantasocials.com";
  const fixUrl = `${siteUrl.replace(/\/$/, "")}/fix-order/${rawToken}`;
  const serviceName = (order.services as { name?: string } | null)?.name || "Service";

  const emailContent = renderTargetFixEmail({
    serviceName,
    publicOrderId: order.public_order_id,
    fixUrl,
    expiresInDays: 7,
  });

  await sendTransactionalEmail({
    to: customerEmail,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  return { ok: true, message: `Fix email sent to customer (${customerEmail}).`, fixUrl };
}

/**
 * Validates a token supplied in customer URL /fix-order/[token].
 * Constant-time safe. Checks expiry, usage, and order failure state.
 */
export async function validateCustomerFixToken(rawToken: string): Promise<{
  valid: boolean;
  errorCode?: "INVALID_OR_EXPIRED" | "ALREADY_USED" | "ALREADY_FULFILLED" | "NOT_FOUND";
  order?: {
    id: string;
    publicOrderId: string;
    serviceName: string;
    platformName: string;
    platformSlug: string;
    targetType: string;
    targetValue: string;
    quantity: number;
  };
}> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 20) {
    return { valid: false, errorCode: "INVALID_OR_EXPIRED" };
  }

  const tokenHash = hashToken(rawToken);
  const db = createSupabaseAdminClient();

  const { data: record, error } = await db
    .from("order_fix_tokens")
    .select("id,order_id,token_hash,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !record) {
    return { valid: false, errorCode: "INVALID_OR_EXPIRED" };
  }

  // Constant-time check on token_hash
  if (!constantTimeCompare(record.token_hash, tokenHash)) {
    return { valid: false, errorCode: "INVALID_OR_EXPIRED" };
  }

  if (record.used_at) {
    return { valid: false, errorCode: "ALREADY_USED" };
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { valid: false, errorCode: "INVALID_OR_EXPIRED" };
  }

  // Verify order state
  const { data: order } = await db
    .from("orders")
    .select("id,public_order_id,target_type,target_value,quantity,payment_status,fulfillment_status,failure_reason,refund_status,services(name,platforms(name,slug))")
    .eq("id", record.order_id)
    .maybeSingle();

  if (!order) {
    return { valid: false, errorCode: "NOT_FOUND" };
  }

  if (order.refund_status === "REFUNDED") {
    return { valid: false, errorCode: "ALREADY_FULFILLED" };
  }

  if (["COMPLETED", "PROCESSING", "SUBMITTED"].includes(order.fulfillment_status)) {
    return { valid: false, errorCode: "ALREADY_FULFILLED" };
  }

  if (order.failure_reason !== "invalid_target" || order.fulfillment_status !== "FAILED") {
    return { valid: false, errorCode: "ALREADY_FULFILLED" };
  }

  const service = order.services as { name?: string; platforms?: { name?: string; slug?: string } | null } | null;
  const platform = service?.platforms;

  return {
    valid: true,
    order: {
      id: order.id,
      publicOrderId: order.public_order_id,
      serviceName: service?.name || "Service",
      platformName: platform?.name || "Platform",
      platformSlug: platform?.slug || "",
      targetType: order.target_type,
      targetValue: order.target_value,
      quantity: order.quantity,
    },
  };
}

/**
 * Server-side execution of target edit & retry.
 * Handles both Admin submission and Customer submission via token.
 *
 * Invariants:
 * - Payment is NEVER charged again.
 * - Double-submission is prevented by atomic single-use token mark & retry conditional acquisition.
 * - Validates and normalizes target against the platform normalizer.
 * - Writes order_target_edits audit record.
 * - Updates orders.target_value, target_raw, target_fix_status.
 * - Dispatches order via retryOrderFulfillment.
 */
export async function executeTargetEditAndRetry(params: {
  orderId: string;
  rawNewTarget: string;
  editedBy: string; // 'admin:<id>' or 'customer'
  reason?: string;
  rawToken?: string; // required if editedBy === 'customer'
}): Promise<EditTargetAndRetryResult> {
  const db = createSupabaseAdminClient();
  const { orderId, rawNewTarget, editedBy, reason, rawToken } = params;

  // 1. Fetch current order with platform details
  const { data: order, error: orderErr } = await db
    .from("orders")
    .select("id,public_order_id,target_value,target_raw,target_type,payment_status,fulfillment_status,failure_reason,refund_status,services(name,platforms(slug)),profiles(email)")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return { ok: false, message: "Order not found." };
  }

  if (order.refund_status === "REFUNDED") {
    return { ok: false, message: "Order has been refunded and cannot be modified." };
  }

  if (order.payment_status !== "PAID") {
    return { ok: false, message: "Only paid orders can be fulfilled." };
  }

  if (order.fulfillment_status !== "FAILED" || order.failure_reason !== "invalid_target") {
    return { ok: false, message: "Order is not in an invalid_target failed state." };
  }

  // 2. Check if a provider_order_id exists anywhere
  const { data: existingPo } = await db
    .from("provider_orders")
    .select("id,provider_order_id")
    .eq("order_id", orderId)
    .not("provider_order_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (existingPo?.provider_order_id) {
    return { ok: false, message: "Cannot edit target: order already has an active provider order ID." };
  }

  // 3. If customer submission, validate & atomically consume token
  if (editedBy === "customer") {
    if (!rawToken) {
      return { ok: false, message: "A valid fix token is required." };
    }
    const tokenHash = hashToken(rawToken);
    const nowIso = new Date().toISOString();

    // Atomic conditional claim of the single-use token:
    // WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
    const { data: claimedToken, error: tokenClaimErr } = await db
      .from("order_fix_tokens")
      .update({ used_at: nowIso })
      .eq("token_hash", tokenHash)
      .eq("order_id", orderId)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("id")
      .maybeSingle();

    if (tokenClaimErr || !claimedToken) {
      return { ok: false, message: "Fix link is invalid, already used, or expired." };
    }
  }

  // 4. Normalize and validate the new target
  const service = order.services as { name?: string; platforms?: { slug?: string } | null } | null;
  const platformSlug = service?.platforms?.slug || "";

  const normResult = await normalizeTarget({
    platform: platformSlug,
    targetType: order.target_type,
    input: rawNewTarget.trim(),
  });

  if (!normResult.ok) {
    return { ok: false, message: `Invalid target: ${normResult.message}` };
  }

  const newCanonical = normResult.canonical;
  if (newCanonical === order.target_value) {
    return { ok: false, message: "The new target is identical to the current target. Please enter a different, valid link or handle." };
  }

  const oldTarget = order.target_value;

  // 5. Record order_target_edits audit record
  await db.from("order_target_edits").insert({
    order_id: orderId,
    old_target: oldTarget,
    new_target: newCanonical,
    edited_by: editedBy,
    reason: reason || (editedBy === "customer" ? "Customer link correction" : "Admin corrected target"),
  });

  // 6. Update order with new target and mark FIXED
  await db
    .from("orders")
    .update({
      target_value: newCanonical,
      target_fix_status: "FIXED",
      // Retain original raw input history in target_raw if not already present
      target_raw: order.target_raw || oldTarget,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  // 7. Write order event
  await recordOrderEvent({
    orderId,
    type: "target_edited",
    actor: editedBy,
    message: `Target updated from "${oldTarget}" to "${newCanonical}"`,
    meta: {
      old_target: oldTarget,
      new_target: newCanonical,
      edited_by: editedBy,
      reason,
    },
  });

  // 8. Dispatch retry using existing retryOrderFulfillment
  const retryResult = await retryOrderFulfillment({
    orderId,
    adminUserId: editedBy.startsWith("admin:") ? editedBy.slice(6) : "system:target_fix",
    force: true, // force true since target has been validated and failure_reason was invalid_target
  });

  // 9. If customer fix and retry succeeded, send confirmation email
  if (editedBy === "customer" && (retryResult.outcome === "SUCCEEDED" || retryResult.outcome === "STILL_PROCESSING")) {
    const customerEmail = (order.profiles as { email?: string } | null)?.email;
    if (customerEmail) {
      const emailContent = renderTargetFixSuccessEmail({
        serviceName: service?.name || "Service",
        publicOrderId: order.public_order_id,
      });
      void sendTransactionalEmail({
        to: customerEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }
  }

  return {
    ok: true,
    message: `Target updated successfully. Retry outcome: ${retryResult.outcome}.`,
    newCanonical,
    retryResult,
  };
}

/**
 * Auto-expiry job: orders in AWAITING_CUSTOMER for more than 7 days become EXPIRED.
 */
export async function expireOldTargetFixTokens(): Promise<number> {
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Find expired fix tokens that have not been used
  const { data: expiredTokens } = await db
    .from("order_fix_tokens")
    .select("order_id")
    .is("used_at", null)
    .lte("expires_at", now);

  if (!expiredTokens || expiredTokens.length === 0) return 0;

  const orderIds = Array.from(new Set(expiredTokens.map((t) => t.order_id)));
  let expiredCount = 0;

  for (const orderId of orderIds) {
    const { data: updated } = await db
      .from("orders")
      .update({ target_fix_status: "EXPIRED" })
      .eq("id", orderId)
      .eq("target_fix_status", "AWAITING_CUSTOMER")
      .select("id")
      .maybeSingle();

    if (updated) {
      expiredCount++;
      await recordOrderEvent({
        orderId,
        type: "target_fix_expired",
        actor: "system",
        message: "Customer target fix link expired after 7 days without response.",
      });
    }
  }

  return expiredCount;
}
