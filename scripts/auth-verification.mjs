import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const login = read("app/login/page.tsx") + read("components/auth/AuthForm.tsx");
const signup = read("app/signup/page.tsx") + read("components/auth/AuthForm.tsx");
const profileMigration = read("supabase/migrations/20260928000002_auth_profiles.sql");
const admin = read("lib/admin/auth.ts");
const catalog = read("lib/catalog/services.ts");
const accountOrders = read("app/account/orders/page.tsx") + read("app/account/orders/[id]/page.tsx");
const adminLayout = read("app/admin/layout.tsx");
const assertions = [
  [login.includes("signInWithPassword"), "login uses Supabase password auth"],
  [signup.includes("signUp"), "signup uses Supabase auth"],
  [signup.includes("password !== confirm"), "signup validates password confirmation"],
  [login.includes("startsWith(\"/\")") && login.includes("startsWith(\"//\")"), "login constrains next redirects"],
  [read("components/auth/LogoutButton.tsx").includes("signOut"), "logout uses Supabase signOut"],
  [profileMigration.includes("after insert on auth.users") && profileMigration.includes("values (new.id"), "profile trigger uses auth user id"],
  [admin.includes("is_admin"), "admin authorization checks is_admin"],
  [catalog.includes("selling_rate") && !catalog.includes("provider_rate"), "public catalog excludes provider economics"],
  [accountOrders.includes("eq(\"user_id\", user.id)"), "customer order queries are user-scoped"],
  [adminLayout.includes("requireAdmin"), "admin shell uses server-side admin authorization"],
];
const failed = assertions.filter(([ok]) => !ok);
if (failed.length) { console.error(`Auth verification failed: ${failed.map(([, label]) => label).join(", ")}`); process.exit(1); }
console.log(`Auth verification: PASS (${assertions.length} checks)`);
