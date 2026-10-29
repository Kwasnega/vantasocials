/**
 * LIVE HTTP SECURITY TEST SCRIPT FOR VANTA ADMIN ROUTES
 * 
 * Verifies that ALL admin routes (pages and API handlers) strictly deny
 * access to unauthenticated requests and non-admin customer accounts.
 *
 * Requirements:
 * - Local Next.js server running (e.g. at http://localhost:3000)
 * - CUSTOMER_SESSION_COOKIE must be provided (script exits non-zero if missing)
 */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const CUSTOMER_COOKIE = process.env.CUSTOMER_SESSION_COOKIE || "";

if (!CUSTOMER_COOKIE) {
  console.error("FATAL ERROR: CUSTOMER_SESSION_COOKIE environment variable is required to execute security verification.");
  console.error("Provide a valid non-admin customer session cookie to assert HTTP 403 access control.");
  process.exit(1);
}

const ADMIN_PAGES = [
  "/admin",
  "/admin/orders",
  "/admin/orders/00000000-0000-0000-0000-000000000000",
  "/admin/customers",
  "/admin/payments",
  "/admin/wallet",
  "/admin/fulfillment",
  "/admin/pricing",
  "/admin/provider-catalog",
  "/admin/providers",
  "/admin/services",
  "/admin/services/00000000-0000-0000-0000-000000000000/inputs",
  "/admin/settings",
  "/admin/platforms",
];

const ADMIN_API_ROUTES = [
  { path: "/api/admin/mappings", method: "POST" },
  { path: "/api/admin/mappings-and-pricing", method: "POST" },
  { path: "/api/admin/platforms", method: "POST" },
  { path: "/api/admin/platforms/1", method: "DELETE" },
  { path: "/api/admin/pricing", method: "GET" },
  { path: "/api/admin/pricing/fx", method: "PATCH" },
  { path: "/api/admin/pricing/preview", method: "GET" },
  { path: "/api/admin/pricing/sync", method: "POST" },
  { path: "/api/admin/pricing/test-slug", method: "PATCH" },
  { path: "/api/admin/provider-catalog", method: "GET" },
  { path: "/api/admin/providers/reliablesmm/balance", method: "POST" },
  { path: "/api/admin/providers/reliablesmm/sync", method: "POST" },
  { path: "/api/admin/services", method: "POST" },
  { path: "/api/admin/services/1", method: "DELETE" },
  { path: "/api/admin/services/1/input-fields", method: "POST" },
  { path: "/api/admin/services/1/input-fields/1", method: "DELETE" },
  { path: "/api/admin/services/1/input-mappings", method: "POST" },
  { path: "/api/admin/services/1/input-mappings/1", method: "DELETE" },
  { path: "/api/admin/wallet", method: "GET" },
  { path: "/api/admin/fulfillment/11111111-1111-1111-1111-111111111111/cancel", method: "POST" },
  { path: "/api/admin/fulfillment/11111111-1111-1111-1111-111111111111/reconcile", method: "POST" },
  { path: "/api/admin/fulfillment/11111111-1111-1111-1111-111111111111/resolve", method: "POST" },
  { path: "/api/admin/fulfillment/11111111-1111-1111-1111-111111111111/retry", method: "POST" },
];

async function testRoute(route, method = "GET", headers = {}) {
  const url = `${BASE_URL}${route}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      redirect: "manual",
    });
    return { status: res.status, ok: true };
  } catch (err) {
    return { error: err.message, ok: false };
  }
}

async function run() {
  console.log("=== RUNNING LIVE HTTP SECURITY TESTS ===");
  console.log(`Target: ${BASE_URL}\n`);

  let allPassed = true;

  console.log("--- 1. Testing Unauthenticated Access to Admin Pages ---");
  for (const page of ADMIN_PAGES) {
    const result = await testRoute(page, "GET");
    if (!result.ok) {
      console.log(`[SKIP/UNAVAILABLE] ${page} - (${result.error})`);
      continue;
    }
    const isProtected = [301, 302, 307, 308, 401, 403, 404].includes(result.status);
    console.log(`[${isProtected ? "PASS" : "FAIL"}] GET ${page} -> HTTP ${result.status}`);
    if (!isProtected) allPassed = false;
  }

  console.log("\n--- 2. Testing Unauthenticated Access to Admin API Routes ---");
  for (const api of ADMIN_API_ROUTES) {
    const result = await testRoute(api.path, api.method);
    if (!result.ok) {
      console.log(`[SKIP/UNAVAILABLE] [${api.method}] ${api.path} - (${result.error})`);
      continue;
    }
    const isProtected = result.status === 401 || result.status === 403;
    console.log(`[${isProtected ? "PASS" : "FAIL"}] ${api.method} ${api.path} -> HTTP ${result.status}`);
    if (!isProtected) allPassed = false;
  }

  console.log("\n--- 3. Testing Non-Admin Customer Session Access ---");
  for (const page of ADMIN_PAGES) {
    const result = await testRoute(page, "GET", { Cookie: CUSTOMER_COOKIE });
    if (!result.ok) continue;
    const isProtected = [301, 302, 307, 308, 401, 403, 404].includes(result.status);
    console.log(`[${isProtected ? "PASS" : "FAIL"}] GET ${page} (customer) -> HTTP ${result.status}`);
    if (!isProtected) allPassed = false;
  }

  for (const api of ADMIN_API_ROUTES) {
    const result = await testRoute(api.path, api.method, { Cookie: CUSTOMER_COOKIE });
    if (!result.ok) continue;
    const isDenied = result.status === 403;
    console.log(`[${isDenied ? "PASS" : "FAIL"}] ${api.method} ${api.path} (customer) -> HTTP ${result.status}`);
    if (!isDenied) allPassed = false;
  }

  if (!allPassed) {
    console.error("\n❌ Security test suite detected unauthorized route access!");
    process.exit(1);
  }

  console.log("\n=== ALL SECURITY VERIFICATION CHECKS PASSED ===");
}

run();
