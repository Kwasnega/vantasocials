import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = readFileSync(".env.local", "utf8");
const getVar = (k) => { const m = env.match(new RegExp(`^${k}=(.+)$`, "m")); return m ? m[1].trim() : null; };
const admin = createClient(getVar("NEXT_PUBLIC_SUPABASE_URL"), getVar("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const testId = "FIX_VERIFY_TEST:" + Date.now();
const { data, error } = await admin.rpc("claim_paystack_webhook_event", {
  p_event_id: testId, p_event_type: "probe", p_payload: { probe: true },
});
if (error) {
  console.error("STILL BROKEN:", error.code, error.message);
} else {
  const row = Array.isArray(data) ? data[0] : data;
  console.log("FIXED! claimed:", row?.claimed, "processing_token:", row?.processing_token ? "present" : "missing");
  // clean up
  await admin.from("webhook_events").delete().eq("event_id", testId);
  console.log("Test row cleaned up.");
}
