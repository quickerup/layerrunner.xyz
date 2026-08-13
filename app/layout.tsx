import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "LayerRunner",
  description: "AI-powered orchestration and operations for modern software teams.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
