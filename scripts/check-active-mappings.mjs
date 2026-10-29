import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function main() {
  const serviceId = "9ae3ef09-66a0-4201-8caf-a8d94fe391f6";
  const { data: mappings, error } = await supabase
    .from("service_provider_input_mappings")
    .select("service_id,provider,provider_service_id,provider_parameter_key,transform_id,transform_version,provider_required,omit_when_blank,schema_version,active,service_input_fields!service_provider_input_mappings_service_field_fk(key)")
    .eq("service_id", serviceId);
  console.log("Mappings for instagram-views:", { mappings, error });

  const { data: fields, error: fError } = await supabase
    .from("service_input_fields")
    .select("*")
    .eq("service_id", serviceId);
  console.log("Input fields for instagram-views:", { fields, fError });
}

main();
