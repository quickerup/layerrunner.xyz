import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Layer Runners — AI operating layer for modern software",
  description:
    "Layer Runners plans, executes, verifies, and explains work across GitHub, Supabase, Cloudflare, and Telegram.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
