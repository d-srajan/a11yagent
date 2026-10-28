import { z } from "zod";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const SiteverifyResponse = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

// The widget in the browser only proves something to Cloudflare; the token
// means nothing until our server asks Cloudflare whether it is valid. Tokens
// are single-use, so a replayed token from one solve fails here.
export async function verifyTurnstile(token: string, secret: string, remoteIp: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = SiteverifyResponse.safeParse(await res.json());
    return parsed.success && parsed.data.success;
  } catch {
    // Fail closed: if Cloudflare is unreachable we cannot tell bots from people.
    return false;
  }
}
