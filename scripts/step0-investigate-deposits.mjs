import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const paystackKey = process.env.PAYSTACK_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const customerId = "acfa7245-622c-4fbb-aa26-19cfbee00fba";

  // 1. Fetch the 3 deposits
  const { data: deposits, error: depErr } = await supabase
    .from("wallet_deposit_payments")
    .select("*")
    .eq("user_id", customerId)
    .order("created_at", { ascending: true });

  console.log("=== DEPOSITS FOR CASEY ===");
  console.log(JSON.stringify(deposits, null, 2));

  // 2. Fetch webhook event claims / logs
  console.log("\n=== PAYSTACK WEBHOOK EVENTS ===");
  const { data: webhookEvents, error: whErr } = await supabase
    .from("paystack_webhook_events")
    .select("event_id,event_type,claimed_at,status,error,created_at,payload")
    .order("created_at", { ascending: false })
    .limit(20);

  if (whErr) {
    console.log("Error querying paystack_webhook_events:", whErr.message);
  } else {
    console.log(`Found ${webhookEvents?.length || 0} recent webhook events.`);
    // Search for references
    for (const d of (deposits || [])) {
      const match = webhookEvents?.filter(e => JSON.stringify(e.payload).includes(d.reference));
      console.log(`Deposit ref ${d.reference} in recent webhooks: ${match?.length || 0} matches`);
    }
  }

  // 3. Query Paystack verify API for each deposit reference (READ ONLY)
  console.log("\n=== PAYSTACK VERIFY (READ-ONLY) ===");
  for (const d of (deposits || [])) {
    try {
      const resp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(d.reference)}`, {
        headers: {
          Authorization: `Bearer ${paystackKey}`,
          "Content-Type": "application/json",
        },
      });
      const data = await resp.json();
      console.log(`Ref: ${d.reference} | HTTP ${resp.status}`);
      console.log(`Status: ${data?.data?.status}, Amount: ${data?.data?.amount}, Currency: ${data?.data?.currency}, PaidAt: ${data?.data?.paid_at}, GatewayResponse: ${data?.data?.gateway_response}`);
    } catch (e) {
      console.error(`Ref: ${d.reference} error:`, e.message);
    }
  }

  // 4. Non-final deposits older than 30 mins across all customers
  console.log("\n=== NON-FINAL DEPOSITS OLDER THAN 30 MINUTES ACROSS ALL CUSTOMERS ===");
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: nonFinal, error: nfErr } = await supabase
    .from("wallet_deposit_payments")
    .select("id,user_id,reference,amount_minor,currency,status,created_at")
    .not("status", "in", '("PAID","FAILED","ABANDONED")')
    .lt("created_at", thirtyMinsAgo);

  if (nfErr) {
    console.error("Non final error:", nfErr);
  } else {
    console.log(`Total count: ${nonFinal?.length}`);
    const countsByStatus = {};
    for (const row of (nonFinal || [])) {
      countsByStatus[row.status] = (countsByStatus[row.status] || 0) + 1;
    }
    console.log("Counts by status:", countsByStatus);
    console.log("Sample rows:", nonFinal?.slice(0, 5));
  }
}

main().catch(console.error);
