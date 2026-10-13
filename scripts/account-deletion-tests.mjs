import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("app/api/account/delete/route.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadRoute({ user = { id: "user-1" }, wallet = null, pendingDeposit = null, authError = null } = {}) {
  const calls = [];
  const profile = { id: "user-1", email: "customer@example.test", display_name: "Customer" };
  const admin = {
    auth: {
      admin: {
        async updateUserById(userId, attributes) {
          calls.push({ action: "auth-update", userId, attributes });
          return { error: authError };
        },
      },
    },
    from(table) {
      const query = { table, operation: "select", values: null, filters: [] };
      const builder = {
        select() { return builder; },
        update(values) { query.operation = "update"; query.values = values; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        in(column, value) { query.filters.push([column, value]); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          calls.push({ action: query.operation, table, values: query.values });
          if (query.operation === "update" && table === "profiles") {
            if (query.values.email === profile.email && query.values.display_name === profile.display_name) {
              return { data: { id: profile.id }, error: null };
            }
            Object.assign(profile, query.values);
            return { data: { id: profile.id }, error: null };
          }
          if (table === "profiles") return { data: { ...profile }, error: null };
          if (table === "wallets") return { data: wallet, error: null };
          if (table === "wallet_deposit_payments") return { data: pendingDeposit, error: null };
          throw new Error(`Unexpected query table ${table}`);
        },
        then(resolve, reject) {
          return builder.maybeSingle().then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "next/server") return { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
    if (specifier === "../../../../lib/supabase/server") return {
      getCurrentUser: async () => user,
      createSupabaseAdminClient: () => admin,
    };
    throw new Error(`Unexpected import ${specifier}`);
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require, BigInt });
  return { post: module.exports.POST, calls, profile };
}

const request = (body = { confirm: true }) => ({
  async json() { return body; },
});

{
  const route = loadRoute({ user: null });
  assert.equal((await route.post(request())).status, 401);
  assert.equal(route.calls.length, 0);
}

{
  const route = loadRoute();
  assert.equal((await route.post(request({}))).status, 400);
  assert.equal(route.calls.length, 0);
}

{
  const route = loadRoute({ wallet: { id: "wallet-1", balance_minor: "125" } });
  const response = await route.post(request());
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Wallet still has funds/);
  assert.equal(route.calls.some((call) => call.action === "auth-update"), false);
  assert.equal(route.profile.email, "customer@example.test");
}

{
  const route = loadRoute({ pendingDeposit: { id: "deposit-1" } });
  const response = await route.post(request());
  assert.equal(response.status, 409);
  assert.match(response.body.error, /deposit is still pending/);
  assert.equal(route.calls.some((call) => call.action === "auth-update"), false);
}

{
  const route = loadRoute({ wallet: { id: "wallet-1", balance_minor: "0" } });
  const response = await route.post(request());
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { body: { deleted: true }, status: 200 });
  assert.equal(route.profile.display_name, null);
  assert.match(route.profile.email, /^closed\+user-1@account\.invalid$/);
  const authCall = route.calls.find((call) => call.action === "auth-update");
  assert.equal(authCall.userId, "user-1");
  assert.equal(authCall.attributes.email, route.profile.email);
  assert.equal(authCall.attributes.ban_duration, "876000h");
  assert.deepEqual(JSON.parse(JSON.stringify(authCall.attributes.user_metadata)), {});
}

{
  const route = loadRoute({ authError: new Error("auth service unavailable") });
  const response = await route.post(request());
  assert.equal(response.status, 500);
  assert.match(response.body.error, /profile details were restored/);
  assert.equal(route.profile.email, "customer@example.test");
  assert.equal(route.profile.display_name, "Customer");
}

console.log("account-deletion-tests: passed");
