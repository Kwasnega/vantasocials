import fs from "fs";
import path from "path";

function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      const regex = /<a\s+[^>]*href=["'](\/admin[^"']*)["']/g;
      let m;
      while ((m = regex.exec(code)) !== null) {
        console.log(`FOUND_RAW_A: ${full} -> ${m[0]}`);
      }
    }
  }
}
scan("app/admin");
scan("components/admin");
