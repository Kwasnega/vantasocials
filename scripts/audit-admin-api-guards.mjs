import fs from "node:fs";
import path from "node:path";

function findRoutes(dir) {
  let routes = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      routes = routes.concat(findRoutes(full));
    } else if (f.name === "route.ts") {
      routes.push(full);
    }
  }
  return routes;
}

const files = findRoutes("app/api/admin");
console.log(`Found ${files.length} admin API routes.`);
for (const f of files) {
  const code = fs.readFileSync(f, "utf8");
  const hasRequireAdmin = code.includes("requireAdmin");
  const hasUserCheck = code.includes("401");
  const hasAdminCheck = code.includes("403");
  console.log(`${f.replace(/\\/g, "/")}: requireAdmin=${hasRequireAdmin}, 401=${hasUserCheck}, 403=${hasAdminCheck}`);
}
