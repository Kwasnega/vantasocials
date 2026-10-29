import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function main() {
  const serviceId = "9ae3ef09-66a0-4201-8caf-a8d94fe391f6"; // instagram-views
  const { data: mappings, error } = await supabase
    .from("service_provider_input_mappings")
    .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,vanta_input_field_key")
    .eq("service_id", serviceId);
  console.log("service_provider_input_mappings for instagram-views:", { mappings, error });

  const { data: rawOrder } = await supabase.from("orders").select("*").eq("id", "c199b428-c035-4d03-a3bc-c07c7276462c").single();
  console.log("Full order columns:", {
    input_schema_version: rawOrder.input_schema_version,
    input_schema_snapshot: rawOrder.input_schema_snapshot,
    input_values: rawOrder.input_values,
    target_type: rawOrder.target_type,
    target_value: rawOrder.target_value,
  });
}

main();
