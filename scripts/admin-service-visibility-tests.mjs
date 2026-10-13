import assert from "node:assert/strict";
import fs from "node:fs";
import { deriveAdminServiceVisibility } from "../lib/admin/service-visibility.ts";

const platforms = [
  { id: "instagram", active: true },
  { id: "tiktok", active: true },
  { id: "legacy", active: false },
];
const services = [
  { id: "published-1", platform_id: "instagram", active: true },
  { id: "published-2", platform_id: "tiktok", active: true },
  { id: "unpublished", platform_id: "instagram", active: false },
  { id: "orphan-active", platform_id: "legacy", active: true },
  { id: "orphan-hidden", platform_id: "missing-platform", active: false },
];

const visibility = deriveAdminServiceVisibility(platforms, services);
assert.deepEqual(
  visibility.customerPlatforms.map(({ id }) => id),
  ["instagram", "tiktok"],
  "admin cards include every customer-active platform, including platforms with no current services",
);
assert.deepEqual(
  [...visibility.publishedByPlatform.entries()].map(([id, rows]) => [id, rows.map(({ id: serviceId }) => serviceId)]),
  [["instagram", ["published-1"]], ["tiktok", ["published-2"]]],
);
assert.deepEqual(visibility.hiddenServices.map(({ id }) => id), ["unpublished"]);
assert.deepEqual(
  visibility.unavailablePlatformServices.map(({ id }) => id),
  ["orphan-active", "orphan-hidden"],
  "services under inactive or missing platforms remain visible to admins, but are distinct from the customer catalog",
);

const adminPage = fs.readFileSync("app/admin/services/page.tsx", "utf8");
const catalogSource = fs.readFileSync("lib/catalog/services.ts", "utf8");
const homepageRoute = fs.readFileSync("app/api/homepage/catalog/route.ts", "utf8");
const showcase = fs.readFileSync("components/home/ServicesShowcase.tsx", "utf8");

assert.match(adminPage, /deriveAdminServiceVisibility\(platforms, services\)/);
assert.match(adminPage, /select\("id,name,slug,logo,color,description,active"\)\.order\("name"\)/);
assert.match(adminPage, /Services on inactive or missing platforms/);
assert.match(catalogSource, /\.eq\("active", true\)/);
assert.match(catalogSource, /\.in\("platform_id",/);
assert.match(homepageRoute, /Cache-Control.*no-store/);
assert.match(showcase, /fetch\("\/api\/homepage\/catalog", \{ cache: "no-store" \}\)/);

console.log("admin-service-visibility-tests: passed");
