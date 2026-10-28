import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScanLive } from "@/components/scan/scan-live";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { loadScan } from "@/lib/server/loadScan";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accessibility report · a11yagent",
  // Reports are public to anyone with the link, but not meant for search engines.
  robots: { index: false, follow: false },
};

// The first render comes from the server (no flash of "loading"); the client
// component then polls GET /api/scans/:id until the scan is done or failed.
export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = await loadScan(id);
  if (!scan) notFound();

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 sm:px-6">
      <SiteHeader />
      <main id="main" className="min-w-0 flex-1 pb-12">
        <ScanLive initial={scan} />
      </main>
      <SiteFooter />
    </div>
  );
}
