import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("lib/orders/checkout.ts", "utf8");
const checkoutPage = fs.readFileSync("app/checkout/page.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function loadCheckoutModule({ user, records = {}, errors = {}, holdReads = false }) {
  const queries = [];
  const started = [];
  const completed = [];
  let releaseReads;
  const readGate = new Promise((resolve) => {
    releaseReads = resolve;
  });

  const admin = {
    from(table) {
      const query = { table, filters: [], columns: null };
      queries.push(query);
      return {
        select(columns) {
          query.columns = columns;
          return this;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return this;
        },
        async maybeSingle() {
          started.push(table);
          if (holdReads && ["orders", "wallets"].includes(table)) await readGate;
          completed.push(table);
          let data = records[table] ?? null;
          if (
            table === "orders" &&
            data &&
            query.filters.some(([column, value]) => column === "user_id" && value !== data.user_id)
          ) {
            data = null;
          }
          if (table === "orders" && data) {
            data = {
              ...data,
              services: records.services
                ? [{ ...records.services, platforms: records.platforms ? [records.platforms] : [] }]
                : null,
            };
          }
          return { data, error: errors[table] ?? null };
        },
      };
    },
  };

  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "../supabase/server") {
      return {
        createSupabaseAdminClient: () => admin,
        getCurrentUser: async () => user,
      };
    }
    throw new Error(`Unexpected import in checkout test: ${specifier}`);
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require });

  return {
    getCheckoutOrder: module.exports.getCheckoutOrder,
    queries,
    started,
    completed,
    releaseReads,
  };
}

const user = { id: "user-1", email: "customer@example.test" };
const records = {
  orders: {
    public_order_id: "VNT-123",
    service_id: "service-1",
    target_type: "url",
    target_value: "https://example.test/post",
    quantity: 1000,
    unit_price: "0.01",
    subtotal: "10.00",
    total: "10.00",
    currency: "GHS",
    status: "PENDING_PAYMENT",
    payment_status: "UNPAID",
    fulfillment_status: "NOT_STARTED",
    created_at: "2026-10-12T10:00:00.000Z",
    user_id: user.id,
    input_values: null,
  },
  services: {
    name: "Instagram Followers",
    slug: "instagram-followers",
    category: "Followers",
    platform_id: "platform-1",
  },
  platforms: { name: "Instagram", slug: "instagram" },
  wallets: { balance_minor: 1500 },
};

{
  const test = loadCheckoutModule({ user, records });
  const checkout = await test.getCheckoutOrder(" VNT-123 ");
  assert.deepEqual(JSON.parse(JSON.stringify(checkout)), {
    public_order_id: "VNT-123",
    service_name: "Instagram Followers",
    service_slug: "instagram-followers",
    category: "Followers",
    platform: "Instagram",
    platform_slug: "instagram",
    target_type: "url",
    target_value: "https://example.test/post",
    quantity: 1000,
    unit_price: "0.01",
    subtotal: "10.00",
    total: "10.00",
    currency: "GHS",
    status: "PENDING_PAYMENT",
    payment_status: "UNPAID",
    fulfillment_status: "NOT_STARTED",
    wallet_balance_minor: "1500",
    input_values: null,
    created_at: "2026-10-12T10:00:00.000Z",
    user_email: "customer@example.test",
  });
  assert.equal(checkout.total, "10.00", "checkout total remains the order snapshot payable amount");
  assert.deepEqual(
    test.queries.find((query) => query.table === "orders").filters,
    [["public_order_id", "VNT-123"], ["user_id", "user-1"]],
    "order lookup remains scoped to its authenticated owner",
  );
  assert.match(
    test.queries.find((query) => query.table === "orders").columns,
    /services\(name,slug,category,platforms\(name,slug\)\)/,
    "service and platform display fields are joined into the owned order query",
  );
  assert.deepEqual(
    test.queries.map((query) => query.table).sort(),
    ["orders", "wallets"],
    "checkout uses one joined order read and one wallet read",
  );
}

{
  const test = loadCheckoutModule({ user, records: { ...records, orders: null } });
  assert.equal(await test.getCheckoutOrder("VNT-123"), null, "missing order is not exposed");
  assert.deepEqual(test.started.slice().sort(), ["orders", "wallets"]);
}

{
  const test = loadCheckoutModule({
    user,
    records: { ...records, orders: { ...records.orders, user_id: "another-user" } },
  });
  assert.equal(await test.getCheckoutOrder("VNT-123"), null, "foreign-owned order is not exposed");
  assert.deepEqual(test.started.slice().sort(), ["orders", "wallets"]);
}

{
  const test = loadCheckoutModule({ user: null, records });
  assert.equal(await test.getCheckoutOrder("VNT-123"), null, "unauthenticated callers cannot load checkout");
  assert.equal(test.queries.length, 0);
}

{
  const test = loadCheckoutModule({ user, records: { ...records, services: null } });
  assert.equal(await test.getCheckoutOrder("VNT-123"), null, "missing service returns no checkout order");
}

{
  const test = loadCheckoutModule({ user, records: { ...records, platforms: null } });
  assert.equal(await test.getCheckoutOrder("VNT-123"), null, "missing platform returns no checkout order");
}

{
  const test = loadCheckoutModule({ user, records: { ...records, wallets: null } });
  const checkout = await test.getCheckoutOrder("VNT-123");
  assert.equal(checkout.wallet_balance_minor, "0", "a missing wallet keeps the zero-balance default");
}

for (const table of ["orders", "services", "platforms", "wallets"]) {
  if (table === "services" || table === "platforms") continue;
  const failure = new Error(`${table} query failed`);
  const test = loadCheckoutModule({ user, records, errors: { [table]: failure } });
  await assert.rejects(test.getCheckoutOrder("VNT-123"), (error) => error === failure);
}

{
  const test = loadCheckoutModule({ user, records, holdReads: true });
  const loading = test.getCheckoutOrder("VNT-123");
  for (let attempt = 0; attempt < 20 && !["orders", "wallets"].every((table) => test.started.includes(table)); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(
    test.started.slice(-2).sort(),
    ["orders", "wallets"],
    "order and wallet reads start before either held read can complete",
  );
  assert.equal(
    test.completed.some((table) => table === "orders" || table === "wallets"),
    false,
    "the independent reads overlap",
  );
  test.releaseReads();
  assert.equal((await loading).total, "10.00");
}

assert.match(checkoutPage, /<span className="checkout-spec-label">Quantity<\/span>/);
assert.match(checkoutPage, /<strong>Total Due<\/strong>/);
assert.doesNotMatch(checkoutPage, /Base Rate \(per unit\)|Quantity Multiplier|Automated Processing Fee/);

console.log("checkout-data-loading-tests: passed");
