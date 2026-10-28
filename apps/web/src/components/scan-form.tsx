"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiError } from "@/lib/scan-view";
import { Turnstile, type TurnstileHandle } from "./turnstile";

interface ScanFormProps {
  enabled: boolean;
  siteKey: string | null;
}

export function ScanForm({ enabled, siteKey }: ScanFormProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [widget, setWidget] = useState<TurnstileHandle | null>(null);

  if (!enabled || !siteKey) {
    return (
      <div className="mt-8 rounded-lg border p-5" role="status">
        <p className="font-semibold">Scanning is paused for maintenance.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Existing report links still work. Please try again later.
        </p>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, turnstileToken: token }),
      });
      const body = (await res.json()) as { id?: string } & Partial<ApiError>;
      if (res.ok && body.id) {
        router.push(`/scans/${body.id}`);
        return;
      }
      setError(body.message ?? "Something went wrong. Please try again.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    // Turnstile tokens are single-use: every failed submit needs a fresh one.
    setToken("");
    widget?.reset();
    setBusy(false);
  }

  return (
    <form className="mt-8" onSubmit={onSubmit} aria-describedby="scan-status">
      <label htmlFor="scan-url" className="block text-sm font-medium">
        Website URL
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <Input
          id="scan-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://example.com"
          required
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" size="lg" disabled={busy || !token}>
          {busy ? "Starting…" : "Scan site"}
        </Button>
      </div>
      <Turnstile siteKey={siteKey} onToken={setToken} onReady={setWidget} />
      <p id="scan-status" className="mt-2 text-sm text-muted-foreground" role={error ? "alert" : undefined}>
        {error ? <span className="font-medium text-foreground">{error}</span> : token ? "Up to 5 pages, about 2 minutes." : "Waiting for the human check to finish…"}
      </p>
    </form>
  );
}
