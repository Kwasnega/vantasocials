import fs from "node:fs";
import path from "node:path";

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next" && e.name !== ".git") {
        scan(full);
      }
    } else if (e.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx") || full.endsWith(".js") || full.endsWith(".mjs"))) {
      const code = fs.readFileSync(full, "utf8");
      const tables = ['"platforms"', '"services"', '"service_input_fields"'];
      for (const t of tables) {
        if (code.includes(t)) {
          // Check if there is an insert, update, delete, or upsert targeting this table
          const regex = new RegExp(`\\.from\\(${t.replace(/"/g, '\\"')}\\)[\\s\\S]*?\\.(insert|update|delete|upsert)\\(`, "m");
          if (regex.test(code)) {
            console.log(`MUTATION: ${full} targets ${t}`);
          }
        }
      }
    }
  }
}

console.log("=== Scanning app ===");
scan("app");
console.log("=== Scanning lib ===");
scan("lib");
console.log("=== Scanning scripts ===");
scan("scripts");
