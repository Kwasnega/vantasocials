"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();
  async function logout() { await createSupabaseBrowserClient().auth.signOut(); router.replace("/"); router.refresh(); }
  return <button type="button" onClick={logout}>Log out</button>;
}
