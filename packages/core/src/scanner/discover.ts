import type { Logger } from "../logger.js";
import { guardedFetch, type GuardedFetchOptions } from "../net/guardedFetch.js";
import { ALLOW_ALL, parseRobots, type RobotsRules } from "./robots.js";

export interface RobotsResult {
  rules: RobotsRules;
  status: number | null;
}

// A missing or broken robots.txt means "no restrictions". RFC 9309 says to
// assume "disallow all" on 5xx, but we fetch at most 10 pages of a site the
// user asked us to scan, so failing open is the friendlier trade-off here.
export async function fetchRobots(origin: string, fetchOptions: GuardedFetchOptions, log: Logger): Promise<RobotsResult> {
  try {
    const res = await guardedFetch(`${origin}/robots.txt`, { ...fetchOptions, maxBytes: 500_000 });
    if (res.status === 200) return { rules: parseRobots(res.body), status: res.status };
    return { rules: ALLOW_ALL, status: res.status };
  } catch (err) {
    log.warn("robots.txt fetch failed; assuming no restrictions", { origin, error: err });
    return { rules: ALLOW_ALL, status: null };
  }
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) =>
    (m[1] ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
  );
}

async function fetchXml(url: string, fetchOptions: GuardedFetchOptions): Promise<string | null> {
  const res = await guardedFetch(url, { ...fetchOptions, maxBytes: 5_000_000 });
  return res.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(res.body) ? res.body : null;
}

// Page URLs from robots.txt Sitemap: lines, else /sitemap.xml. A sitemap
// index is followed one level deep, for at most 3 child sitemaps.
export async function fetchSitemapUrls(
  origin: string,
  robots: RobotsRules,
  fetchOptions: GuardedFetchOptions,
  log: Logger,
): Promise<string[]> {
  const sameOrigin = (u: string): boolean => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  };
  const roots = robots.sitemaps.filter(sameOrigin);
  if (roots.length === 0) roots.push(`${origin}/sitemap.xml`);

  const urls: string[] = [];
  for (const root of roots.slice(0, 3)) {
    try {
      const xml = await fetchXml(root, fetchOptions);
      if (!xml) continue;
      if (/<sitemapindex[\s>]/i.test(xml)) {
        for (const child of extractLocs(xml).filter(sameOrigin).slice(0, 3)) {
          const childXml = await fetchXml(child, fetchOptions);
          if (childXml) urls.push(...extractLocs(childXml));
        }
      } else {
        urls.push(...extractLocs(xml));
      }
    } catch (err) {
      log.debug("sitemap fetch failed", { url: root, error: err });
    }
  }
  return urls.filter(sameOrigin);
}
