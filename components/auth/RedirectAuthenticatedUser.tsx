import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/supabase/server";

export async function RedirectAuthenticatedUser({ next }: { next?: string }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const destination = next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/account";
  redirect(destination);
}
