import { createHash } from "node:crypto";

// On Vercel both headers are written by the platform (client-sent values are
// overwritten), so they can't be spoofed to dodge the rate limit. Behind
// another proxy the left-most x-forwarded-for entry is client-controlled;
// re-check this before hosting the web app anywhere else.
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

// Only this hash is stored, never the IP itself (SPEC: Cost controls).
export function hashIp(ip: string | null, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip ?? "unknown"}`).digest("hex");
}
