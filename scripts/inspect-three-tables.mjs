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

async function run() {
  console.log("=== INSPECTING THE 3 SPECIFIC TABLES ===");

  const t1 = await db.from("bundleup_gateway_payment_evidence").select("*");
  console.log("bundleup_gateway_payment_evidence:", {
    count: t1.data?.length,
    error: t1.error?.message,
    rows: t1.data,
  });

  const t2 = await db.from("bundleup_gateway_reconciliation_requests").select("*");
  console.log("bundleup_gateway_reconciliation_requests:", {
    count: t2.data?.length,
    error: t2.error?.message,
    rows: t2.data,
  });

  const t3 = await db.from("payment_provider_reference_claims").select("*");
  console.log("payment_provider_reference_claims:", {
    count: t3.data?.length,
    error: t3.error?.message,
    rows: t3.data,
  });

  const payments = await db.from("payments").select("id, provider, reference, gateway_reference, status");
  console.log("All payments:", payments.data);
}

run().catch(console.error);
