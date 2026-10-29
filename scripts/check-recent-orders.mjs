import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function main() {
  const { data: orders, error } = await supabase.from("orders")
    .select("id, public_order_id, user_id, status, payment_status, fulfillment_status, created_at, services(slug, name)")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("Error fetching orders:", error);
    return;
  }
  console.log("Recent orders:", JSON.stringify(orders, null, 2));
}

main();
