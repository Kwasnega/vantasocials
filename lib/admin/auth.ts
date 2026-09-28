import "server-only";

import { getCurrentUser, createSupabaseAdminClient } from "../supabase/server";

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { user: null, admin: null } as const;
  const { data, error } = await createSupabaseAdminClient().from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (error || !data?.is_admin) return { user, admin: null } as const;
  return { user, admin: { id: user.id } } as const;
}
