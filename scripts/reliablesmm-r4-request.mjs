const payload = { service: process.env.RELIABLESMM_SERVICE, link: process.env.R4_TEST_LINK, quantity: Number(process.env.R4_TEST_QUANTITY) };
let response;
for (const base of ["http://127.0.0.1:3002", "http://127.0.0.1:3001", "http://127.0.0.1:3000"]) {
  try { const candidate = await fetch(`${base}/api/internal/reliablesmm/r4`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (candidate.status !== 404) { response = candidate; break; } } catch {}
}
if (!response) { console.error("R4 Next.js server endpoint is unavailable."); process.exit(1); }
const body = await response.json().catch(() => null);
if (!response.ok) { console.error(JSON.stringify(body)); process.exit(1); }
console.log(JSON.stringify(body));
