import type { Metadata } from "next";
import { PostHogUserIdentifier } from "../components/auth/LogoutButton";
import { getCurrentUser } from "../lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "VANTA — Social growth, simplified",
  description: "A refined marketplace for social growth services.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const isSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const user = isSupabaseConfigured ? await getCurrentUser() : null;

  return <html lang="en"><body>{user && <PostHogUserIdentifier userId={user.id} email={user.email} />}{children}</body></html>;
}
