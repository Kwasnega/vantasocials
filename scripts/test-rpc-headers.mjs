import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  },
});

async function run() {
  const res = await db.rpc("admin_wipe_order_financial_data", { p_confirmation: "WIPE ALL DATA" });
  console.log("RPC with explicit headers:", res);
}

run().catch(console.error);
