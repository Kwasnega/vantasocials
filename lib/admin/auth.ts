import "server-only";

import { cache } from "react";
import { getCurrentUser, createSupabaseAdminClient } from "../supabase/server";

export const requireAdmin = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return { user: null, admin: null } as const;
  const { data, error } = await createSupabaseAdminClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error("Unable to verify admin access.", { cause: error });
  if (!data?.is_admin) return { user, admin: null } as const;
  return { user, admin: { id: user.id } } as const;
});
