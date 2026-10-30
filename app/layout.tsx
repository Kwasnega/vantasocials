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

  return (
    <html lang="en">
      <body>
        {user && <PostHogUserIdentifier userId={user.id} email={user.email} />}
        {children}
        <footer style={{
          textAlign: "center",
          padding: "20px 16px",
          fontSize: "13px",
          color: "#6b4f88",
          borderTop: "1px solid #1e0f2e",
          marginTop: "40px",
        }}>
          Built by{" "}
          <a
            href="https://www.linkedin.com/in/kwartengkwame"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#9b7fc4", fontWeight: 700, textDecoration: "none" }}
          >
            Kxy
          </a>
        </footer>
      </body>
    </html>
  );
}
