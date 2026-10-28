"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ScanView } from "@/lib/scan-view";
import { Report } from "./report";
import { ScanProgressPanel } from "./scan-progress";

const POLL_MS = 2000;
const isFinal = (scan: ScanView): boolean => scan.status === "done" || scan.status === "failed";

export function ScanLive({ initial }: { initial: ScanView }) {
  const [scan, setScan] = useState(initial);
  const [stale, setStale] = useState(false);
  // Bumped after a failed poll so the effect schedules another try.
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    if (isFinal(scan)) return;
    // setTimeout, not setInterval: the next poll waits for this one, so a
    // slow response never stacks requests.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/scans/${scan.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        setScan((await res.json()) as ScanView);
        setStale(false);
      } catch {
        // Keep showing the last known state and try again next tick.
        setStale(true);
        setRetries((n) => n + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [scan, retries]);

  if (scan.status === "done" && scan.report) return <Report scan={scan} report={scan.report} />;

  if (scan.status === "failed") {
    return (
      <section aria-labelledby="failed-heading" className="mt-6 rounded-lg border p-5">
        <h1 id="failed-heading" className="text-2xl font-bold">The scan could not finish</h1>
        <p className="mt-2 break-words text-muted-foreground">{scan.url}</p>
        <p className="mt-4">{scan.error ?? "Something went wrong while scanning."}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          Check that the site is public and loads in a normal browser, then try again from the{" "}
          <Link href="/" className="underline">home page</Link>.
        </p>
      </section>
    );
  }

  return <ScanProgressPanel scan={scan} stale={stale} />;
}
