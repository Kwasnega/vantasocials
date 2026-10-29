import fs from "fs";
import path from "path";

function findCounts(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") findCounts(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = fs.readFileSync(full, "utf8");
      const lines = code.split("\n");
      lines.forEach((line, i) => {
        if (/count:\s*["'](planned|exact|estimated)["']/.test(line)) {
          console.log(`${full}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
}
findCounts("app");
