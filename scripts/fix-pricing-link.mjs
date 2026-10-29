import fs from "fs";

let content = fs.readFileSync("app/admin/pricing/page.tsx", "utf8");
if (!content.includes('import Link from "next/link";')) {
  content = content.replace('import { redirect } from "next/navigation";', 'import Link from "next/link";\nimport { redirect } from "next/navigation";');
}
content = content.replace('<a href="/admin/services">Admin Services</a>', '<Link href="/admin/services">Admin Services</Link>');
fs.writeFileSync("app/admin/pricing/page.tsx", content);
console.log("Updated app/admin/pricing/page.tsx successfully");
