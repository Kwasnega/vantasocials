import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const db = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: stuck, error } = await db
    .from("orders")
    .select("id,public_order_id,total,currency,payment_status,fulfillment_status,created_at,profiles(email),services(name,slug),provider_order_events(event_type,error_code,created_at)")
    .eq("payment_status", "PAID")
    .in("fulfillment_status", ["NOT_STARTED", "SUBMITTING"])
    .lte("created_at", twoMinutesAgo)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Admin Stuck Query Failed:", error);
    return;
  }

  console.log("=== ORDERS SURFACED IN ADMIN FULFILLMENT QUEUE AS 'NEEDS ATTENTION' ===");
  console.log(`Total orders found: ${stuck.length}\n`);

  for (const o of stuck) {
    const latestEvent = o.provider_order_events?.length
      ? [...o.provider_order_events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      : null;

    console.log({
      public_order_id: o.public_order_id,
      customer_email: o.profiles?.email ?? "—",
      service: o.services?.name ?? "—",
      fulfillment_status: o.fulfillment_status,
      created_at: o.created_at,
      latest_event: latestEvent ? `${latestEvent.event_type} (${latestEvent.error_code})` : "Unsubmitted / no event logged"
    });
  }
}

main().catch(console.error);
