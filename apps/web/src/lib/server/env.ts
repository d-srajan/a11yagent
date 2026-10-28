import { envBoolean, parseEnv } from "@a11yagent/core";
import { z } from "zod";

// Server-only settings. Nothing here may be prefixed NEXT_PUBLIC_: these are
// read in route handlers and server components and never reach the browser.
const WebEnv = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  // Salt for the IP hash: without it, the 4 billion IPv4 hashes are a lookup table.
  IP_HASH_SALT: z.string().min(32, "IP_HASH_SALT must be at least 32 characters"),
  SCANS_PER_IP_PER_DAY: z.coerce.number().int().min(0).default(5),
});
export type WebEnv = z.infer<typeof WebEnv>;

let cached: WebEnv | null = null;

// Parsed lazily, not at import time: `next build` imports route modules
// without production secrets, and a missing variable should fail the request
// that needs it with a clear message rather than the build.
export function webEnv(): WebEnv {
  cached ??= parseEnv(WebEnv);
  return cached;
}

// The kill switch is read on every request, separately from webEnv(), so the
// maintenance message still shows when the rest of the config is broken.
export function scansEnabled(): boolean {
  return envBoolean(process.env.SCANS_ENABLED, true);
}

export function turnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
}
