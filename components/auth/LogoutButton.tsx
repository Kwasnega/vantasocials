"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export function LogoutButton() {
  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    window.location.href = "/";
  }
  return <button type="button" onClick={logout}>Log out</button>;
}
