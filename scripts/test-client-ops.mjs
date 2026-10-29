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
  console.log("Testing individual table operations via Supabase client...");

  // Try select
  const { data: claims, error: cErr } = await db.from("fulfillment_order_claims").select("id").limit(1);
  console.log("fulfillment_order_claims select:", { count: claims?.length, error: cErr?.message });

  // Try truncate or delete on rate_limit_buckets? Let's check permissions
  console.log("Checking rate_limit_buckets delete test...");
  // Let's delete where bucket_key = 'non_existent_key_for_test'
  const { data: delTest, error: delErr } = await db.from("rate_limit_buckets").delete().eq("bucket_key", "non_existent_key_for_test");
  console.log("Delete test result:", { error: delErr?.message });
}

run().catch(console.error);
