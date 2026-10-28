"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { reportToMarkdown } from "@/lib/report-markdown";
import type { ScanView } from "@/lib/scan-view";

export function CopyMarkdown({ scan }: { scan: ScanView }) {
  const [message, setMessage] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(scan, window.location.href));
      setMessage("Copied the report as Markdown.");
    } catch {
      setMessage("Your browser blocked clipboard access. Try again, or copy the page text.");
    }
  }

  return (
    <div className="shrink-0">
      <Button type="button" variant="outline" onClick={copy}>
        Copy as Markdown
      </Button>
      <p role="status" className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
