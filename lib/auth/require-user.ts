import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient, getCurrentUser } from "../supabase/server";

export async function requireUser(nextPath: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return { user, db: createSupabaseAdminClient() };
}
