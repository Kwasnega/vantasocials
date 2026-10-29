import fs from "node:fs";
import path from "node:path";

function scan(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      scan(full);
    } else if (f.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
      const code = fs.readFileSync(full, "utf8");
      if (code.includes('.select("*")') || code.includes(".select('*')") || code.includes(".select()")) {
        console.log("SELECT_STAR:", full);
      }
    }
  }
}

console.log("Scanning app/admin and app/api/admin...");
scan("app/admin");
scan("app/api/admin");
