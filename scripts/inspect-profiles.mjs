import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, "m"));
  return m ? m[1].trim() : process.env[k];
};

const db = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: profiles, error: pErr } = await db.from("profiles").select("*");
  console.log("PROFILES SAMPLE:", profiles, pErr);

  // Check auth.users if accessible or list user emails
  const { data: users, error: uErr } = await db.auth.admin.listUsers();
  console.log("AUTH USERS:", users?.users?.map(u => ({ id: u.id, email: u.email, role: u.role, created_at: u.created_at })), uErr);
}

main().catch(console.error);
