import { normalizeUrl } from "@a11yagent/core";
import { z } from "zod";

// The rules for POST /api/scans, with every side effect injected so the
// order of checks can be unit-tested without Supabase or Cloudflare.
//
// Order matters, cheapest and most decisive first:
// 1. kill switch: costs nothing, and maintenance beats every other message
// 2. body shape and Turnstile: drop bots before doing any DNS work for them
// 3. URL + SSRF pre-check: nothing internal ever reaches the queue
// 4. 24-hour cache: a repeat costs nothing, so it does not use up the quota
// 5. per-IP daily limit
// 6. insert the queued row

export const CreateScanBody = z.object({
  url: z.string().trim().min(1, "Enter a URL to scan.").max(2048, "That URL is too long."),
  turnstileToken: z.string().max(4096).default(""),
});

export const CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface CreateScanDeps {
  scansEnabled: boolean;
  perIpLimit: number;
  ipHash: string;
  verifyTurnstile(token: string): Promise<boolean>;
  // Throws (an SsrfError) when the URL must not be scanned; returns the parsed URL otherwise.
  checkUrl(url: string): Promise<URL>;
  findRecentScan(normalizedUrl: string, since: Date): Promise<string | null>;
  countScansByIp(ipHash: string, since: Date): Promise<number>;
  insertScan(row: { url: string; normalized_url: string; requester_ip_hash: string }): Promise<string>;
  now?: () => Date;
}

export type CreateScanResult =
  | { kind: "created"; id: string }
  | { kind: "cached"; id: string }
  | { kind: "rejected"; status: 400 | 403 | 429 | 503; code: string; message: string };

const reject = (status: 400 | 403 | 429 | 503, code: string, message: string): CreateScanResult => ({ kind: "rejected", status, code, message });

// People paste "example.com"; the scanner needs a scheme. https is the safe guess.
export function withScheme(input: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
}

export const MAINTENANCE = {
  kind: "rejected",
  status: 503,
  code: "maintenance",
  message: "Scanning is paused for maintenance. Existing reports still work; please try again later.",
} as const satisfies CreateScanResult;

export async function createScan(body: unknown, deps: CreateScanDeps): Promise<CreateScanResult> {
  if (!deps.scansEnabled) return MAINTENANCE;

  const parsed = CreateScanBody.safeParse(body);
  if (!parsed.success) return reject(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid request.");

  if (!(await deps.verifyTurnstile(parsed.data.turnstileToken))) {
    return reject(403, "turnstile", "We couldn't confirm you're human. Please complete the check and try again.");
  }

  let url: URL;
  try {
    url = await deps.checkUrl(withScheme(parsed.data.url));
  } catch (err) {
    return reject(400, "url_refused", err instanceof Error ? err.message : "That URL can't be scanned.");
  }
  const normalized = normalizeUrl(url);
  const now = deps.now?.() ?? new Date();

  const cachedId = await deps.findRecentScan(normalized, new Date(now.getTime() - CACHE_WINDOW_MS));
  if (cachedId) return { kind: "cached", id: cachedId };

  const used = await deps.countScansByIp(deps.ipHash, new Date(now.getTime() - RATE_WINDOW_MS));
  if (used >= deps.perIpLimit) {
    return reject(
      429,
      "rate_limited",
      `You've used all ${deps.perIpLimit} free scans for today. Please try again tomorrow. Reports you already ran still work.`,
    );
  }

  const id = await deps.insertScan({ url: url.href, normalized_url: normalized, requester_ip_hash: deps.ipHash });
  return { kind: "created", id };
}
