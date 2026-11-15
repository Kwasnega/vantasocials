import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function backfillOrderEvents() {
  console.log("=== BACKFILLING ORDER EVENTS FROM EXISTING HISTORICAL RECORDS ===");

  // 1. Fetch all orders
  const { data: orders, error: ordersErr } = await sb
    .from("orders")
    .select("id,public_order_id,user_id,status,payment_status,fulfillment_status,failure_reason,failure_detail,created_at,updated_at");

  if (ordersErr || !orders) {
    console.error("Failed to load orders:", ordersErr);
    return;
  }

  console.log(`Processing ${orders.length} orders...`);
  let totalEventsCreated = 0;

  for (const o of orders) {
    // Check if order already has events
    const { count, error: countErr } = await sb
      .from("order_events")
      .select("id", { count: "exact", head: true })
      .eq("order_id", o.id);

    if (countErr) {
      console.warn("Error checking events for order:", countErr.message);
      continue;
    }

    if ((count ?? 0) > 0) {
      continue; // Already has events
    }

    const eventsToInsert = [];

    // 1. Order created event
    eventsToInsert.push({
      order_id: o.id,
      type: "created",
      status_before: null,
      status_after: "PENDING_PAYMENT",
      message: `Order ${o.public_order_id} created by customer.`,
      actor: `user:${o.user_id}`,
      created_at: o.created_at,
      meta: { public_order_id: o.public_order_id },
    });

    // 2. Payment events
    const { data: payments } = await sb
      .from("payments")
      .select("id,provider,reference,amount,currency,status,paid_at,created_at")
      .eq("order_id", o.id)
      .order("created_at", { ascending: true });

    if (payments && payments.length > 0) {
      for (const p of payments) {
        if (p.status === "PAID" || p.paid_at) {
          eventsToInsert.push({
            order_id: o.id,
            type: "payment_confirmed",
            status_before: "UNPAID",
            status_after: "PAID",
            message: `Payment of ${p.amount} ${p.currency} confirmed via ${p.provider}.`,
            actor: "webhook",
            created_at: p.paid_at ?? p.created_at,
            meta: { reference: p.reference, amount: p.amount, provider: p.provider },
          });
        }
      }
    } else if (o.payment_status === "PAID") {
      // Wallet or auto settlement
      eventsToInsert.push({
        order_id: o.id,
        type: "payment_confirmed",
        status_before: "UNPAID",
        status_after: "PAID",
        message: "Payment confirmed.",
        actor: "system",
        created_at: o.created_at,
        meta: {},
      });
    }

    // 3. Provider submission events from provider_orders
    const { data: providerOrders } = await sb
      .from("provider_orders")
      .select("id,provider,provider_order_id,status,attempt_status,error_code,created_at,updated_at")
      .eq("order_id", o.id)
      .order("created_at", { ascending: true });

    if (providerOrders && providerOrders.length > 0) {
      for (const po of providerOrders) {
        eventsToInsert.push({
          order_id: o.id,
          type: "submitted_to_provider",
          status_before: "NOT_STARTED",
          status_after: "SUBMITTING",
          message: `Submitted attempt to ${po.provider}.`,
          actor: "system",
          created_at: po.created_at,
          meta: { attempt_id: po.id },
        });

        if (po.provider_order_id) {
          eventsToInsert.push({
            order_id: o.id,
            type: "provider_accepted",
            status_before: "SUBMITTING",
            status_after: po.status ?? "SUBMITTED",
            message: `Provider accepted order (#${po.provider_order_id}).`,
            actor: "system",
            created_at: po.updated_at ?? po.created_at,
            meta: { provider_order_id: po.provider_order_id, status: po.status },
          });
        }

        if (po.status === "COMPLETED") {
          eventsToInsert.push({
            order_id: o.id,
            type: "completed",
            status_before: "PROCESSING",
            status_after: "COMPLETED",
            message: "Order fulfillment completed successfully.",
            actor: "system",
            created_at: po.updated_at ?? po.created_at,
            meta: { provider_order_id: po.provider_order_id },
          });
        }
      }
    }

    // 4. If current status is FAILED
    if (o.fulfillment_status === "FAILED") {
      eventsToInsert.push({
        order_id: o.id,
        type: "failed",
        status_before: "SUBMITTING",
        status_after: "FAILED",
        message: `Fulfillment failed: ${o.failure_detail ?? o.failure_reason ?? "Unknown error"}`,
        actor: "system",
        created_at: o.updated_at ?? o.created_at,
        meta: { failure_reason: o.failure_reason, failure_detail: o.failure_detail },
      });
    }

    // Sort chronologically
    eventsToInsert.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Insert batch for this order
    if (eventsToInsert.length > 0) {
      const { error: insertErr } = await sb.from("order_events").insert(eventsToInsert);
      if (insertErr) {
        console.warn(`Failed to insert events for order ${o.public_order_id}:`, insertErr.message);
      } else {
        totalEventsCreated += eventsToInsert.length;
      }
    }
  }

  console.log(`\n=== BACKFILL COMPLETE: Inserted ${totalEventsCreated} order events. ===`);
}

backfillOrderEvents().catch(console.error);
