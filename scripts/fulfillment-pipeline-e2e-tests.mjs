import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileModule(path, dependencies = {}) {
  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    process: { env: { PANELS_LIVE_FULFILLMENT_ENABLED: "true" } },
    console,
    Date,
    Response,
    URL,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      if (specifier === "server-only") return {};
      if (specifier === "node:crypto") {
        return {
          randomUUID: () => `token-${Math.random().toString(36).substring(2, 9)}`,
        };
      }
      throw new Error(`Unexpected import in ${path}: ${specifier}`);
    },
  });
  return module.exports;
}

// Global test mock state
function createMockEnvironment() {
  const claims = new Map(); // orderId -> { ownerToken, expiresAt, releasedAt }
  const providerSubmissions = [];
  const events = [];
  const rpcCalls = [];

  const mockDb = {
    claims,
    providerSubmissions,
    events,
    rpcCalls,
    order: {
      id: "test-order-uuid-1",
      public_order_id: "VNT-E2ETEST",
      total: 10,
      service_id: "service-uuid-1",
      payment_status: "PAID",
      fulfillment_status: "NOT_STARTED",
      target_type: "url",
      target_value: "https://www.instagram.com/p/test/",
      quantity: 500,
      input_schema_version: 1,
      input_schema_snapshot: [{ key: "post_url", inputType: "post_url" }],
      input_values: { post_url: "https://www.instagram.com/p/test/" },
      services: {
        id: "service-uuid-1",
        slug: "instagram-views",
        provider: "reliablesmm",
        provider_service_id: "2037",
      },
    },
    mockAttempt: null,
  };

  const adminClient = {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(k, v) { filters[k] = v; return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          if (table === "orders") return { data: mockDb.order, error: null };
          if (table === "provider_orders") return { data: mockDb.mockAttempt, error: null };
          if (table === "fulfillment_order_claims") {
            const c = mockDb.claims.get(filters.order_id);
            return { data: c ?? null, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          if (table === "orders") return { data: mockDb.order, error: null };
          return { data: null, error: null };
        },
        async insert(payload) {
          if (table === "provider_order_events") {
            mockDb.events.push(payload);
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === "service_provider_input_mappings") {
            resolve({
              data: [
                {
                  service_id: "service-uuid-1",
                  provider: "reliablesmm",
                  provider_service_id: "2037",
                  provider_parameter_key: "link",
                  transform_id: "normalize_url",
                  transform_version: 1,
                  provider_required: true,
                  omit_when_blank: false,
                  schema_version: 1,
                  active: true,
                  service_input_fields: { key: "post_url" },
                },
              ],
              error: null,
            });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
    },
    async rpc(name, args) {
      mockDb.rpcCalls.push({ name, args });
      if (name === "transition_fulfillment_state") {
        mockDb.order.fulfillment_status = args.p_to;
        return { data: true, error: null };
      }
      if (name === "require_provider_manual_review") {
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
  };

  const claimsModule = {
    claimOrder: async (orderId, ownerToken) => {
      const existing = claims.get(orderId);
      if (existing && !existing.releasedAt && existing.expiresAt > Date.now()) {
        return false; // Already locked
      }
      claims.set(orderId, { ownerToken, expiresAt: Date.now() + 600000, releasedAt: null });
      return true;
    },
    releaseOrderClaim: async (orderId, ownerToken) => {
      const existing = claims.get(orderId);
      if (existing && existing.ownerToken === ownerToken) {
        existing.releasedAt = Date.now();
      }
    },
  };

  return { mockDb, adminClient, claimsModule };
}

async function runTests() {
  console.log("Starting Fulfillment Pipeline E2E & Concurrency Tests...\n");

  // -------------------------------------------------------------
  // Test 1: Single successful dispatch transitions order & submits once
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    let workerCalled = 0;

    const workerModule = {
      fulfillPaidOrder: async (input) => {
        workerCalled++;
        env.mockDb.providerSubmissions.push(input);
        return {
          outcome: "SUBMITTED",
          attempt: { attempt_status: "SUBMITTED", provider_order_id: "prov-99" },
        };
      },
    };

    const mappingModule = {
      normalizePersistedProviderInputMappings: (mappings) => [
        { ...mappings[0], vanta_input_field_key: "post_url" },
      ],
    };

    const dispatchModule = compileModule("lib/fulfillment/dispatch-paid-order.ts", {
      "../supabase/server": { createSupabaseAdminClient: () => env.adminClient },
      "./claims": env.claimsModule,
      "./worker": workerModule,
      "./service-input-mapping": mappingModule,
    });

    const result = await dispatchModule.dispatchPaidOrder("test-order-uuid-1");
    assert.equal(result.outcome, "SUBMITTED");
    assert.equal(workerCalled, 1);
    assert.equal(env.mockDb.order.fulfillment_status, "SUBMITTED");
    assert.ok(env.mockDb.claims.get("test-order-uuid-1").releasedAt !== null);
    console.log("✓ Test 1 Passed: Single dispatch succeeds and releases claim cleanly.");
  }

  // -------------------------------------------------------------
  // Test 2: Concurrent triggers (Webhook + Verify + Sweep) cannot double-submit
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    let workerInvocations = 0;

    const workerModule = {
      fulfillPaidOrder: async (input) => {
        workerInvocations++;
        // Simulate a 50ms provider network latency
        await new Promise((resolve) => setTimeout(resolve, 50));
        env.mockDb.providerSubmissions.push(input);
        return {
          outcome: "SUBMITTED",
          attempt: { attempt_status: "SUBMITTED", provider_order_id: "prov-100" },
        };
      },
    };

    const mappingModule = {
      normalizePersistedProviderInputMappings: (mappings) => [
        { ...mappings[0], vanta_input_field_key: "post_url" },
      ],
    };

    const dispatchModule = compileModule("lib/fulfillment/dispatch-paid-order.ts", {
      "../supabase/server": { createSupabaseAdminClient: () => env.adminClient },
      "./claims": env.claimsModule,
      "./worker": workerModule,
      "./service-input-mapping": mappingModule,
    });

    // Fire 5 triggers concurrently for the SAME order
    const outcomes = await Promise.all([
      dispatchModule.dispatchPaidOrder("test-order-uuid-1"), // e.g. webhook trigger
      dispatchModule.dispatchPaidOrder("test-order-uuid-1"), // e.g. customer verify redirect
      dispatchModule.dispatchPaidOrder("test-order-uuid-1"), // e.g. background recovery sweep
      dispatchModule.dispatchPaidOrder("test-order-uuid-1"), // e.g. double-click retry
      dispatchModule.dispatchPaidOrder("test-order-uuid-1"), // e.g. cron
    ]);

    // Exactly one must submit; all others must be rejected with ALREADY_CLAIMED or ORDER_NOT_ELIGIBLE
    const submittedCount = outcomes.filter((o) => o.outcome === "SUBMITTED").length;
    const skippedCount = outcomes.filter((o) => o.outcome === "ALREADY_CLAIMED" || o.outcome === "ORDER_NOT_ELIGIBLE").length;

    assert.equal(submittedCount, 1, `Expected exactly 1 submission, got ${submittedCount}`);
    assert.equal(skippedCount, 4, `Expected 4 claims rejected, got ${skippedCount}`);
    assert.equal(workerInvocations, 1, `Provider worker must be called exactly once; was ${workerInvocations}`);
    console.log("✓ Test 2 Passed: 5 concurrent triggers fired simultaneously -> exactly ONE provider submission.");
  }

  // -------------------------------------------------------------
  // Test 3: Provider rejection does NOT auto-retry; logs clear reason
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();

    const workerModule = {
      fulfillPaidOrder: async () => ({
        outcome: "FAILED",
        attempt: { attempt_status: "FAILED_BEFORE_SUBMISSION" },
      }),
    };

    const mappingModule = {
      normalizePersistedProviderInputMappings: (mappings) => [
        { ...mappings[0], vanta_input_field_key: "post_url" },
      ],
    };

    const dispatchModule = compileModule("lib/fulfillment/dispatch-paid-order.ts", {
      "../supabase/server": { createSupabaseAdminClient: () => env.adminClient },
      "./claims": env.claimsModule,
      "./worker": workerModule,
      "./service-input-mapping": mappingModule,
    });

    const result = await dispatchModule.dispatchPaidOrder("test-order-uuid-1");
    assert.equal(result.outcome, "SUBMISSION_REJECTED");
    assert.ok(env.mockDb.events.some((e) => e.error_code === "SUBMISSION_REJECTED"));
    console.log("✓ Test 3 Passed: Provider rejection puts order in clear state without auto-retrying.");
  }

  // -------------------------------------------------------------
  // Test 4: Ambiguous outcome flags manual review and stops auto-retry
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    env.mockDb.mockAttempt = {
      id: "attempt-uuid-ambig",
      attempt_status: "UNKNOWN_PENDING_RECONCILIATION",
      provider_order_id: null,
    };

    const workerModule = {
      fulfillPaidOrder: async () => ({
        outcome: "UNKNOWN",
        attempt: { attempt_status: "UNKNOWN_PENDING_RECONCILIATION", provider_order_id: null },
      }),
    };

    const mappingModule = {
      normalizePersistedProviderInputMappings: (mappings) => [
        { ...mappings[0], vanta_input_field_key: "post_url" },
      ],
    };

    const dispatchModule = compileModule("lib/fulfillment/dispatch-paid-order.ts", {
      "../supabase/server": { createSupabaseAdminClient: () => env.adminClient },
      "./claims": env.claimsModule,
      "./worker": workerModule,
      "./service-input-mapping": mappingModule,
    });

    const result = await dispatchModule.dispatchPaidOrder("test-order-uuid-1");
    assert.equal(result.outcome, "SUBMISSION_AMBIGUOUS");
    assert.ok(env.mockDb.rpcCalls.some((c) => c.name === "require_provider_manual_review"));
    assert.ok(env.mockDb.events.some((e) => e.error_code === "SUBMISSION_AMBIGUOUS"));
    console.log("✓ Test 4 Passed: Ambiguous submission flags manual review; no silent auto-retry.");
  }

  console.log("\nAll E2E Pipeline and Concurrency Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
