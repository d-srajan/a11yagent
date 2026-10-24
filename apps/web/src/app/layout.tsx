import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "a11yagent: free accessibility audits with verified fixes",
  description:
    "Paste a URL and get the five accessibility problems to fix first, with code fixes proven in a real browser.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
