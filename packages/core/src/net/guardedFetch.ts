import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { createGuardedLookup } from "./guardedLookup.js";
import { checkUrl, SsrfError } from "./ssrfGuard.js";

export interface GuardedFetchOptions {
  userAgent: string;
  allowLocal?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface GuardedResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

function requestOnce(url: URL, options: GuardedFetchOptions): Promise<IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      {
        headers: { "user-agent": options.userAgent, accept: "text/plain, application/xml, text/xml, */*;q=0.5" },
        lookup: createGuardedLookup(options.allowLocal),
        timeout: options.timeoutMs ?? 10_000,
      },
      resolve,
    );
    req.on("timeout", () => req.destroy(new Error(`timed out fetching ${url.href}`)));
    req.on("error", reject);
  });
}

function readBody(res: IncomingMessage, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - (size - chunk.length)));
        res.destroy();
        resolve({ body: Buffer.concat(chunks).toString("utf8"), truncated: true });
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), truncated: false }));
    res.on("error", reject);
  });
}

// Small text fetches from Node (robots.txt, sitemaps). Redirects are followed
// by hand so that every hop is re-checked: a public URL that 302s to
// http://169.254.169.254/ must be refused, not followed.
export async function guardedFetch(input: string, options: GuardedFetchOptions): Promise<GuardedResponse> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url } = await checkUrl(current, { allowLocal: options.allowLocal ?? false });
    const res = await requestOnce(url, options);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume();
      current = new URL(location, url).href;
      continue;
    }
    const { body, truncated } = await readBody(res, options.maxBytes ?? 1_000_000);
    return { url: url.href, status, contentType: res.headers["content-type"] ?? "", body, truncated };
  }
  throw new SsrfError("invalid_url", `Refused: more than ${maxRedirects} redirects from ${input}.`, input);
}
