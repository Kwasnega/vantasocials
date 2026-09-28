import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VANTA — Social growth, simplified",
  description: "A refined marketplace for social growth services.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
