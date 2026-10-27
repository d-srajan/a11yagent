import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { classifyAddress, type AddressVerdict } from "./ipRanges.js";

// The service fetches URLs for anonymous strangers. Without this guard a user
// could point the worker at http://169.254.169.254/ (cloud credentials) or at
// anything else on the private network the worker sits in.

export type SsrfReason = "invalid_url" | "scheme" | "credentials" | "port" | "dns" | "blocked_address";

export class SsrfError extends Error {
  override readonly name = "SsrfError";
  constructor(
    readonly reason: SsrfReason,
    message: string,
    readonly url: string,
  ) {
    super(message);
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

export interface GuardOptions {
  // Evals and local dev only: lets exactly 127.0.0.1 through, on any port.
  allowLocal?: boolean;
  resolve?: Resolver;
}

export interface CheckedUrl {
  url: URL;
  addresses: string[];
}

// The one address ALLOW_LOCAL_TARGETS opens up. Not 127.0.0.0/8, not ::1,
// not "localhost": the narrower the hole, the less it can be abused.
export const LOCAL_DEV_ADDRESS = "127.0.0.1";
const ALLOWED_PORTS = new Set([80, 443]);

const systemResolver: Resolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export function isAddressAllowed(ip: string, allowLocal = false): AddressVerdict {
  if (allowLocal && ip === LOCAL_DEV_ADDRESS) return { blocked: false };
  return classifyAddress(ip);
}

export function blockedAddressMessage(href: string, host: string, ip: string, label: string): string {
  const resolves = host === ip ? `${ip} is` : `${host} resolves to ${ip}, which is`;
  const article = /^[aeiou]|^IPv6|^IETF/i.test(label) ? "an" : "a";
  return `Refused to fetch ${href}: ${resolves} ${article} ${label} address. a11yagent only scans public websites.`;
}

function hostnameOf(url: URL): string {
  // URL keeps IPv6 literals in brackets and allows a trailing root dot ("localhost.").
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

// Validates a URL and every address its host resolves to. Throws SsrfError.
// Call it again for every redirect hop and every request: DNS answers can
// change between calls (DNS rebinding), so a past "ok" proves nothing.
export async function checkUrl(input: string | URL, options: GuardOptions = {}): Promise<CheckedUrl> {
  const raw = String(input);
  let url: URL;
  try {
    // The WHATWG parser also normalizes tricks like http://2130706433/ to 127.0.0.1.
    url = new URL(raw);
  } catch {
    throw new SsrfError("invalid_url", `Refused: "${raw}" is not a valid URL.`, raw);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("scheme", `Refused to fetch ${url.href}: only http and https URLs can be scanned.`, url.href);
  }
  if (url.username || url.password) {
    throw new SsrfError("credentials", `Refused to fetch ${url.href}: URLs with embedded credentials are not allowed.`, url.href);
  }

  const host = hostnameOf(url);
  if (!host) throw new SsrfError("invalid_url", `Refused: "${raw}" has no host.`, url.href);

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (options.resolve ?? systemResolver)(host);
    } catch {
      addresses = [];
    }
    if (addresses.length === 0) {
      throw new SsrfError("dns", `Refused to fetch ${url.href}: could not resolve ${host}.`, url.href);
    }
  }

  // Reject if ANY answer is internal: an attacker controls their own DNS and
  // can return one public and one private address.
  for (const ip of addresses) {
    const verdict = isAddressAllowed(ip, options.allowLocal);
    if (verdict.blocked) {
      throw new SsrfError("blocked_address", blockedAddressMessage(url.href, host, ip, verdict.label), url.href);
    }
  }

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const localDev = options.allowLocal === true && addresses.every((ip) => ip === LOCAL_DEV_ADDRESS);
  if (!ALLOWED_PORTS.has(port) && !localDev) {
    throw new SsrfError("port", `Refused to fetch ${url.href}: only ports 80 and 443 are allowed, not ${port}.`, url.href);
  }

  return { url, addresses };
}
