import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const routeSource = fs.readFileSync("app/api/orders/route.ts", "utf8");
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const migration = fs.readFileSync("supabase/migrations/20261012000000_order_creation_idempotency.sql", "utf8");
const clientSource = fs.readFileSync("components/services/ServiceConfigurator.tsx", "utf8");
const serviceId = "service-1";
const platformId = "platform-1";
const userId = "user-1";
const service = {
  id: serviceId,
  slug: "instagram-followers",
  platform_id: platformId,
  target_type: "url",
  min_quantity: 10,
  max_quantity: 10000,
  selling_rate: "2.50",
  currency: "GHS",
  active: true,
  provider: null,
  provider_service_id: null,
};
const platform = { id: platformId, active: true };
const defaultInputFields = [{
  key: "username",
  label: "Username",
  required: true,
  inputType: "text",
}];

function makeDatabase({
  orders = [],
  currentService = service,
  activeDynamicFields = 0,
  inputFields = defaultInputFields,
  insertError = null,
  holdInitialIdempotencyLookups = false,
} = {}) {
  const inserted = orders;
  let nextId = inserted.length + 1;
  const calls = [];
  let currentServiceRecord = currentService;
  let dynamicFieldCount = activeDynamicFields;
  let initialKeyLookups = 0;
  let releaseInitialKeyLookups;
  const initialKeyLookupBarrier = new Promise((resolve) => {
    releaseInitialKeyLookups = resolve;
  });
  const admin = {
    from(table) {
      const query = { table, filters: [], action: "select", body: null, columns: "" };
      calls.push(query);
      const builder = {
        select(columns, options) {
          query.columns = columns;
          query.count = options?.count;
          query.head = options?.head;
          return this;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return this;
        },
        insert(body) {
          query.action = "insert";
          query.body = body;
          return this;
        },
        maybeSingle() {
          const isInitialKeyLookup = holdInitialIdempotencyLookups
            && query.table === "orders"
            && query.filters.some(([column]) => column === "idempotency_key")
            && initialKeyLookups < 2;
          if (isInitialKeyLookup) {
            initialKeyLookups += 1;
            if (initialKeyLookups === 2) releaseInitialKeyLookups();
            return initialKeyLookupBarrier.then(() => read(query));
          }
          return Promise.resolve(read(query));
        },
        single() {
          if (query.action !== "insert") return Promise.resolve(read(query));
          if (insertError) return Promise.resolve({ data: null, error: insertError });
          const key = query.body.idempotency_key;
          if (inserted.some((row) => row.idempotency_key === key && row.user_id === query.body.user_id)) {
            return Promise.resolve({
              data: null,
              error: { code: "23505", message: 'duplicate key value violates unique constraint "orders_user_id_idempotency_key_key"' },
            });
          }
          const created = {
            id: `order-${nextId}`,
            public_order_id: `VNT-${String(nextId).padStart(3, "0")}`,
            status: "PENDING_PAYMENT",
            payment_status: "UNPAID",
            fulfillment_status: "NOT_STARTED",
            target_type: query.body.target_type,
            created_at: `2026-10-12T12:00:${String(nextId).padStart(2, "0")}.000Z`,
            ...query.body,
          };
          nextId += 1;
          inserted.push(created);
          return Promise.resolve({ data: created, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve(read(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  function read(query) {
    const matches = (row) => query.filters.every(([column, value]) => row?.[column] === value);
    if (query.table === "orders") {
      return { data: inserted.find(matches) ?? null, error: null };
    }
    if (query.table === "services") return { data: currentServiceRecord && matches(currentServiceRecord) ? currentServiceRecord : null, error: null };
    if (query.table === "platforms") return { data: matches(platform) ? platform : null, error: null };
    if (query.table === "provider_catalog_services") return { data: null, error: null };
    if (query.table === "service_input_fields") return { count: dynamicFieldCount, data: null, error: null };
    throw new Error(`Unexpected table read in order idempotency test: ${query.table}`);
  }

  return {
    admin,
    orders: inserted,
    calls,
    inputFields,
    setCurrentService(value) {
      currentServiceRecord = value;
    },
    setDynamicFieldCount(value) {
      dynamicFieldCount = value;
    },
  };
}

function validateDynamicValues(fields, submitted) {
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) throw new Error("Expected an input object.");
  const accepted = new Set(fields.map((field) => field.key));
  if (Object.keys(submitted).some((key) => !accepted.has(key))) throw new Error("Unknown dynamic field.");
  const values = {};
  for (const field of fields) {
    const value = submitted[field.key];
    if (field.required && (typeof value !== "string" || !value.trim())) throw new Error("Required field missing.");
    if (value !== undefined) values[field.key] = typeof value === "string" ? value.trim() : value;
  }
  return values;
}

function loadPost({ db, authenticatedUser = { id: userId }, currentDynamicFields } = {}) {
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "node:crypto") return crypto;
    if (specifier === "next/server") {
      return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
    }
    if (specifier === "../../../lib/supabase/server") {
      return {
        createSupabaseAdminClient: () => db.admin,
        getCurrentUser: async () => authenticatedUser,
      };
    }
    if (specifier === "../../../lib/security/rate-limit") {
      return {
        clientIp: () => "127.0.0.1",
        consumeRateLimits: async () => ({ allowed: true }),
        limiterUnavailable: () => ({ status: 503 }),
        rateLimited: () => ({ status: 429 }),
        rulesFor: () => [],
      };
    }
    if (specifier === "../../../lib/orders/dynamic-input-validation") {
      return {
        validateDynamicFieldValues(fields, values) {
          return { validatedValues: validateDynamicValues(fields, values) };
        },
        async validateDynamicOrderInput(_id, values) {
          const fields = currentDynamicFields ?? db.inputFields;
          return {
            schemaVersion: 1,
            schemaSnapshot: fields,
            validatedValues: validateDynamicValues(fields, values),
          };
        },
      };
    }
    if (specifier === "../../../lib/targets/contracts") {
      return {
        getTargetContract: (slug) => slug === "instagram-followers" ? "INSTAGRAM_PROFILE" : null,
        normalizeTarget: (_slug, raw) => {
          try {
            const target = raw.trim();
            const url = new URL(target.startsWith("@") ? `https://www.instagram.com/${target.slice(1)}` : target);
            url.pathname = url.pathname.replace(/\/$/, "");
            if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname) || !/^\/[^/]+$/.test(url.pathname)) {
              return { valid: false, reason: "invalid target" };
            }
            url.hash = "";
            return { valid: true, target: url.toString() };
          } catch {
            return { valid: false, reason: "invalid target" };
          }
        },
      };
    }
    if (specifier === "../../../lib/targets/quantity") {
      return {
        effectiveQuantityRange: (min, max, providerMin, providerMax) => ({
          min: providerMin == null ? min : Math.max(min, providerMin),
          max: providerMax == null ? max : Math.min(max, providerMax),
        }),
        quantityInRange: (quantity, range) => Number.isSafeInteger(quantity) && quantity >= range.min && quantity <= range.max,
      };
    }
    throw new Error(`Unexpected route import in test: ${specifier}`);
  };
  vm.runInNewContext(compiledRoute, {
    module,
    exports: module.exports,
    require,
    console: { error() {} },
  });
  return module.exports.POST;
}

const key = (digit) => `00000000-0000-4000-8000-${String(digit).padStart(12, "0")}`;
const legacyBody = (overrides = {}) => ({
  service_id: serviceId,
  target_value: "https://instagram.com/example-user/",
  quantity: 10,
  ...overrides,
});

async function submit(post, requestKey, body, uid = userId) {
  return post(new Request("http://localhost/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(JSON.stringify(body).length),
      "Idempotency-Key": requestKey,
      "x-test-user": uid,
    },
    body: JSON.stringify(body),
  }));
}

{
  const db = makeDatabase();
  const post = loadPost({ db });
  const response = await submit(post, key(1), legacyBody({ amount: "0.01", total: "0.01" }));
  assert.equal(response.status, 201);
  assert.equal(db.orders.length, 1, "the first submission creates exactly one order");
  assert.equal(response.body.total, "25.00");
  assert.equal(db.orders[0].idempotency_fingerprint.length, 64);
}

{
  const db = makeDatabase();
  const post = loadPost({ db });
  const response = await submit(post, key(12), legacyBody({ target_value: "http://invalid.example/path" }));
  assert.equal(response.status, 400);
  assert.equal(db.orders.length, 0, "invalid targets do not create orders");
}

{
  const db = makeDatabase();
  const post = loadPost({ db });
  const first = await submit(post, key(2), legacyBody());
  const replay = await submit(post, key(2), legacyBody({
    service_id: serviceId.toUpperCase(),
    target_value: "https://instagram.com/example-user",
  }));
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200, "a normalized equivalent intent is replayed");
  assert.equal(replay.body.id, first.body.id);
  assert.equal(db.orders.length, 1);
}

for (const changed of [
  legacyBody({ service_id: "another-service" }),
  legacyBody({ quantity: 11 }),
  legacyBody({ target_value: "https://instagram.com/another-user" }),
]) {
  const db = makeDatabase();
  const post = loadPost({ db });
  await submit(post, key(3), legacyBody());
  const conflict = await submit(post, key(3), changed);
  assert.equal(conflict.status, 409);
  assert.equal(db.orders.length, 1, "a different intent cannot change or duplicate the original order");
}

{
  const db = makeDatabase({ holdInitialIdempotencyLookups: true });
  const post = loadPost({ db });
  const [first, second] = await Promise.all([
    submit(post, key(4), legacyBody()),
    submit(post, key(4), legacyBody()),
  ]);
  assert.equal(db.orders.length, 1, "the unique constraint race permits exactly one insert");
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(first.body.id, second.body.id);
}

{
  const db = makeDatabase();
  const post = loadPost({ db });
  const first = await submit(post, key(5), legacyBody());
  const second = await submit(post, key(6), legacyBody());
  assert.equal(first.status, 201);
  assert.equal(second.status, 201, "distinct keys represent intentional identical purchases");
  assert.equal(db.orders.length, 2);
}

{
  const db = makeDatabase();
  const post = loadPost({ db });
  const created = await submit(post, key(7), legacyBody());
  const originalTotal = created.body.total;
  db.setCurrentService({ ...service, selling_rate: "99.99" });
  db.orders[0].payment_status = "PAID";
  db.orders[0].status = "PROCESSING";
  const replay = await submit(post, key(7), legacyBody());
  assert.equal(replay.status, 200);
  assert.equal(replay.body.total, originalTotal, "catalog price changes do not recalculate replayed orders");
  assert.equal(replay.body.payment_status, "PAID", "replay does not reset payment state");
  assert.equal(replay.body.status, "PROCESSING");
  assert.equal(db.orders.length, 1);
}

{
  const db = makeDatabase({ activeDynamicFields: 1 });
  const post = loadPost({ db });
  const body = { service_id: serviceId, quantity: 10, input_values: { username: " alice " } };
  const created = await submit(post, key(8), body);
  db.setCurrentService(null);
  db.setDynamicFieldCount(0);
  const replay = await submit(post, key(8), { ...body, input_values: { username: "alice" } });
  assert.equal(created.status, 201);
  assert.equal(replay.status, 200, "stored dynamic-input schema supports recovery after catalog changes");
  assert.equal(replay.body.id, created.body.id);
  assert.equal(db.orders.length, 1);
}

{
  const db = makeDatabase();
  const post = loadPost({ db, authenticatedUser: { id: "user-2" } });
  const foreignOrder = {
    id: "foreign-order",
    public_order_id: "VNT-FOREIGN",
    user_id: "user-1",
    service_id: serviceId,
    quantity: 10,
    target_value: "https://www.instagram.com/example-user",
    target_type: "url",
    unit_price: "2.50",
    subtotal: "25.00",
    total: "25.00",
    currency: "GHS",
    status: "PENDING_PAYMENT",
    payment_status: "UNPAID",
    fulfillment_status: "NOT_STARTED",
    idempotency_key: key(9),
    idempotency_fingerprint: "a".repeat(64),
    idempotency_service_slug: service.slug,
  };
  db.orders.push(foreignOrder);
  const response = await submit(post, key(9), legacyBody(), "user-2");
  assert.equal(response.status, 201);
  assert.notEqual(response.body.id, foreignOrder.id, "another user's key cannot retrieve their order");
  assert.equal(db.orders.length, 2);
}

for (const invalidKey of [
  null,
  "",
  "not-a-uuid",
  key(10).replace("4", "1"),
  "abcdef12-abcd-4abc-8abc-abcdefabcdef".toUpperCase(),
]) {
  const db = makeDatabase();
  const post = loadPost({ db });
  const headers = { "content-type": "application/json" };
  if (invalidKey !== null) headers["Idempotency-Key"] = invalidKey;
  const response = await post(new Request("http://localhost/api/orders", {
    method: "POST",
    headers,
    body: JSON.stringify(legacyBody()),
  }));
  assert.equal(response.status, 400);
  assert.equal(db.orders.length, 0);
}

{
  const db = makeDatabase({
    insertError: { code: "23505", message: 'duplicate key value violates unique constraint "orders_public_order_id_key"' },
  });
  const post = loadPost({ db });
  const response = await submit(post, key(11), legacyBody());
  assert.equal(response.status, 500, "unrelated uniqueness errors are not treated as successful replays");
  assert.equal(db.orders.length, 0);
}

{
  for (const functionName of ["submitLegacy", "submitDynamic"]) {
    const start = clientSource.indexOf(`async function ${functionName}()`);
    const end = clientSource.indexOf("\n  async function ", start + 1);
    const body = clientSource.slice(start, end === -1 ? undefined : end);
    assert.match(body, /const requestKey = await getOrderIdempotencyKey\(payload\)/);
    assert.match(body, /"Idempotency-Key": requestKey/);
    assert.match(body, /catch \{[\s\S]*?setSubmitting\(false\);/);
    assert.doesNotMatch(body.match(/catch \{[\s\S]*?\n    \}/)?.[0] ?? "", /beginDifferentOrderIntent/);
    assert.match(body, /beginDifferentOrderIntent\(\);\s*window\.location\.href/);
  }
  assert.match(clientSource, /useRef<StoredOrderIntent \| null>\(null\)/);
  assert.match(clientSource, /crypto\.randomUUID\(\)/);
  assert.match(clientSource, /sessionStorage\.getItem\(orderIntentStorageKey\(service\.id\)\)/);
  assert.match(clientSource, /sessionStorage\.setItem\(orderIntentStorageKey\(service\.id\)/);
  assert.match(clientSource, /crypto\.subtle\.digest\("SHA-256", payloadBytes\)/);
  assert.equal((clientSource.match(/beginDifferentOrderIntent\(\);/g) ?? []).length >= 6, true);
  assert.match(migration, /unique \(user_id, idempotency_key\)/);
  assert.match(migration, /before insert on public\.orders/);
  assert.match(migration, /ORDER_IDEMPOTENCY_REQUIRED/);
}

console.log("order-creation-idempotency-tests: passed");
