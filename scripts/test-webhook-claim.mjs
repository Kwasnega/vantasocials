import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// In Supabase, if we don't have exec_sql RPC, let's see how migrations are applied or check functions
async function check() {
  const { data: testClaim, error } = await supabase.rpc('claim_paystack_webhook_event', {
    p_event_id: 'test_evt_1',
    p_event_type: 'charge.success',
    p_payload: {}
  });
  console.log('Test claim result:', { testClaim, error });
}
check();
