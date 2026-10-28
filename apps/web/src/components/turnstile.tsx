"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

// Minimal typing for Cloudflare's script API (no extra npm dependency).
interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileHandle {
  reset(): void;
}

interface TurnstileProps {
  siteKey: string;
  onToken(token: string): void;
  onReady(handle: TurnstileHandle): void;
}

// Explicit rendering, so React owns when the widget is created and removed.
export function Turnstile({ siteKey, onToken, onReady }: TurnstileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(() => typeof window !== "undefined" && !!window.turnstile);

  useEffect(() => {
    const api = window.turnstile;
    if (!loaded || !api || !ref.current) return;
    const id = api.render(ref.current, {
      sitekey: siteKey,
      callback: (token: string) => onToken(token),
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
    onReady({ reset: () => api.reset(id) });
    return () => api.remove(id);
  }, [loaded, siteKey, onToken, onReady]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setLoaded(true)} onReady={() => setLoaded(true)} />
      <div ref={ref} className="mt-3 min-h-[65px]" />
    </>
  );
}
