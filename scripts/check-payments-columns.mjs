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
  console.log("=== CHECKING PAYMENTS SCHEMA (COLUMNS) ===");
  const { data, error } = await db.from("payments").select("*").limit(1);
  if (error) {
    console.error("Error reading payments:", error);
    return;
  }
  if (data && data.length > 0) {
    console.log("Payments row columns:", Object.keys(data[0]));
    console.log("Sample payment:", data[0]);
  } else {
    console.log("Payments table empty");
  }
}

run().catch(console.error);
