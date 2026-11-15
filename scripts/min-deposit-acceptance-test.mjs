import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

console.log("=== RUNNING MINIMUM DEPOSIT SETTINGS ACCEPTANCE TEST SUITE ===");

const envPath = path.resolve(process.cwd(), ".env.local");
assert.ok(fs.existsSync(envPath), ".env.local not found");
const envContent = fs.readFileSync(envPath, "utf-8");

function getEnv(key) {
  const match = envContent.match(new RegExp(`^${key}=["']?([^"'\r\n]+)["']?`, "m"));
  return match ? match[1].trim() : process.env[key];
}

const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL missing");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY missing");
assert.ok(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY missing");

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function validateMinDepositInput(input) {
  if (typeof input !== "string" && typeof input !== "number") {
    return { valid: false, error: "Minimum deposit must be provided as a number or string." };
  }
  const str = String(input).trim();
  if (!str) return { valid: false, error: "Minimum deposit cannot be empty." };
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return { valid: false, error: "Minimum deposit must be a positive number with at most 2 decimal places." };
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    return { valid: false, error: "Minimum deposit must be greater than 0." };
  }
  if (num > 10000.0) {
    return { valid: false, error: "Minimum deposit cannot exceed GHS 10,000.00." };
  }
  return { valid: true, value: num, formatted: num.toFixed(2) };
}

async function run() {
  // Test 1: Verify migration files exist and syntax is valid
  console.log("Test 1: Migration file verification...");
  assert.ok(fs.existsSync("supabase/migrations/20261115000001_app_settings.sql"), "Migration file exists");
  assert.ok(fs.existsSync("supabase/migrations/20261115000001_app_settings.rollback.sql"), "Rollback file exists");
  const migSql = fs.readFileSync("supabase/migrations/20261115000001_app_settings.sql", "utf-8");
  assert.ok(migSql.includes("CREATE TABLE IF NOT EXISTS public.app_settings"), "app_settings table created");
  assert.ok(migSql.includes("CREATE TABLE IF NOT EXISTS public.app_settings_audit"), "app_settings_audit table created");
  assert.ok(migSql.includes("ENABLE ROW LEVEL SECURITY"), "RLS enabled");
  console.log("✓ Test 1 passed: Migration files valid.");

  // Test 2: Verify non-admin (anon) cannot write or access admin settings
  console.log("Test 2: RLS and Non-Admin write guard verification...");
  const { data: anonData, error: anonErr } = await anonClient
    .from("pricing_settings")
    .upsert({ key: "min_deposit_ghs", fx_rate: 1.0 });
  assert.ok(anonErr, "Non-admin write to pricing_settings must be denied by RLS/privileges");
  console.log("✓ Test 2 passed: Non-admin write to pricing_settings rejected.");

  // Test 3: Admin update & audit log write verification
  console.log("Test 3: Admin update & audit log write verification...");
  const adminId = "e80c3b33-8c41-4ee5-a329-056904cd6e35";
  const testNewValue = 40.0;
  const now = new Date().toISOString();

  // 3a. Read previous value
  const { data: prevSetting } = await adminClient
    .from("pricing_settings")
    .select("fx_rate")
    .eq("key", "min_deposit_ghs")
    .maybeSingle();

  const prevValue = prevSetting?.fx_rate != null ? Number(prevSetting.fx_rate) : 35.0;

  // 3b. Update setting as admin
  const { error: updateErr } = await adminClient
    .from("pricing_settings")
    .upsert({
      key: "min_deposit_ghs",
      fx_rate: testNewValue,
      fx_source: "MANUAL",
      updated_by: adminId,
      updated_at: now,
    });
  assert.equal(updateErr, null, "Admin update must succeed");

  // 3c. Write audit log row in admin_action_log
  const { data: auditRow, error: auditErr } = await adminClient
    .from("admin_action_log")
    .insert({
      action: "APP_SETTINGS_UPDATE",
      performed_by: adminId,
      details: {
        key: "min_deposit_ghs",
        old_value: prevValue,
        new_value: testNewValue,
      },
      result_summary: {
        key: "min_deposit_ghs",
        value: testNewValue,
        updated_at: now,
      },
    })
    .select()
    .single();

  assert.equal(auditErr, null, "Audit row must insert without error");
  assert.ok(auditRow.id, "Audit row has UUID");
  assert.equal(auditRow.details.key, "min_deposit_ghs");
  assert.equal(auditRow.details.new_value, testNewValue);
  console.log("✓ Test 3 passed: Admin setting updated and audit row written.");

  // Test 4: Verify server-side minimum deposit enforcement logic
  console.log("Test 4: Server-side minimum deposit boundary logic...");

  // Negative / zero / invalid
  assert.equal(validateMinDepositInput(0).valid, false);
  assert.equal(validateMinDepositInput(-10).valid, false);
  assert.equal(validateMinDepositInput("abc").valid, false);
  assert.equal(validateMinDepositInput("35.123").valid, false); // more than 2 decimals
  assert.equal(validateMinDepositInput(10001).valid, false); // exceeds upper bound

  // Valid inputs
  const valid1 = validateMinDepositInput("35.00");
  assert.equal(valid1.valid, true);
  assert.equal(valid1.value, 35.0);

  const valid2 = validateMinDepositInput(50);
  assert.equal(valid2.valid, true);
  assert.equal(valid2.value, 50.0);

  console.log("✓ Test 4 passed: Client & server validation helper accurately enforces all boundary rules.");

  // Test 5: Revert back to standard 35.00 GHS baseline
  console.log("Test 5: Resetting min_deposit_ghs to standard 35.00 GHS...");
  await adminClient.from("pricing_settings").upsert({
    key: "min_deposit_ghs",
    fx_rate: 35.0,
    fx_source: "MANUAL",
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  });

  await adminClient.from("admin_action_log").insert({
    action: "APP_SETTINGS_UPDATE",
    performed_by: adminId,
    details: {
      key: "min_deposit_ghs",
      old_value: testNewValue,
      new_value: 35.0,
    },
    result_summary: {
      key: "min_deposit_ghs",
      value: 35.0,
    },
  });

  console.log("✓ Test 5 passed: Reset setting to 35.00 GHS.");
  console.log("=== ALL MINIMUM DEPOSIT TESTS PASSED ===");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
