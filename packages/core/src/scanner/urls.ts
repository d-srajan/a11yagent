import type { RobotsRules } from "./robots.js";

// origin + path, lowercased host, no hash, no query. Matches scans.normalized_url.
export function normalizeUrl(input: string | URL): string {
  const url = new URL(String(input));
  return url.origin + url.pathname;
}

const NON_HTML = /\.(?:pdf|jpe?g|png|gif|svg|webp|avif|bmp|ico|css|m?js|json|xml|txt|csv|zip|gz|tgz|tar|rar|7z|mp[34]|m4a|mov|avi|webm|ogg|wav|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|rss|atom|exe|dmg|apk|ics)$/i;

export function isLikelyHtml(url: URL): boolean {
  return !NON_HTML.test(url.pathname);
}

export interface PagePick {
  pages: string[];
  skipped: { url: string; reason: string }[];
}

// Dedupe key: "/" and "/index.html" are the same page on static hosts.
function pageKey(url: URL): string {
  return normalizeUrl(url).replace(/\/index\.html?$/i, "/");
}

function depth(url: URL): number {
  return url.pathname.split("/").filter(Boolean).length;
}

// Start page first, then the shortest paths, capped at maxPages. Shortest
// first because top-level pages (pricing, contact) are usually the ones
// visitors actually reach; deep blog archives repeat the same templates.
export function pickPages(startUrl: string, candidates: string[], maxPages: number, robots?: RobotsRules): PagePick {
  const start = new URL(startUrl);
  start.hash = "";
  const seen = new Set([pageKey(start)]);
  const skipped: PagePick["skipped"] = [];
  const eligible: URL[] = [];

  for (const raw of candidates) {
    let url: URL;
    try {
      url = new URL(raw, start);
    } catch {
      continue;
    }
    url.hash = "";
    if (url.origin !== start.origin || (url.protocol !== "http:" && url.protocol !== "https:")) continue;
    const key = pageKey(url);
    // Query-string variants of a path are duplicates for our purposes.
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isLikelyHtml(url)) continue;
    // Respected for every page except the one the user submitted.
    if (robots && !robots.isAllowed(url.pathname + url.search)) {
      skipped.push({ url: url.href, reason: "disallowed by robots.txt" });
      continue;
    }
    eligible.push(url);
  }

  eligible.sort((a, b) => depth(a) - depth(b) || a.href.length - b.href.length || a.href.localeCompare(b.href));
  const chosen = eligible.slice(0, Math.max(0, maxPages - 1));
  for (const url of eligible.slice(chosen.length)) skipped.push({ url: url.href, reason: `over the ${maxPages}-page limit` });
  return { pages: [start.href, ...chosen.map((u) => u.href)], skipped };
}
