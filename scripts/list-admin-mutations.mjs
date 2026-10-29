import fs from "fs";
import path from "path";

function findMutations(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findMutations(full);
    else if (entry.name === "route.ts") {
      const code = fs.readFileSync(full, "utf8");
      const methods = [];
      for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
        if (code.includes(`export async function ${m}`)) methods.push(m);
      }
      if (methods.length > 0) {
        console.log(`${full.replace(/^.*app[\\\/]api[\\\/]admin[\\\/]/, "")} -> ${methods.join(", ")}`);
      }
    }
  }
}
findMutations("app/api/admin");
