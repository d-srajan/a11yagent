import { groupFindings } from "../grouping.js";
import { createLogger, type Logger } from "../logger.js";
import { checkUrl } from "../net/ssrfGuard.js";
import { ScanReport, type Finding, type PageResult } from "../report-schema.js";
import { findAltCandidates, type PageImages } from "./altCandidates.js";
import { openScanBrowser } from "./browser.js";
import { fetchRobots, fetchSitemapUrls } from "./discover.js";
import { scanPage, type SaveScreenshot } from "./scanPage.js";
import { normalizeUrl, pickPages } from "./urls.js";

export const DEFAULT_MAX_PAGES = 5;
export const HARD_MAX_PAGES = 10;
export const PAGE_DELAY_MS = 1000;
export const DEFAULT_USER_AGENT = "A11yAgentBot/0.1 (+https://github.com/d-srajan/a11yagent)";

export interface ScanSiteOptions {
  maxPages?: number;
  allowLocal?: boolean;
  userAgent?: string;
  log?: Logger;
  saveScreenshot?: SaveScreenshot;
  onProgress?: (progress: { pagesFound: number; pagesScanned: number }) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The whole Phase 1 pipeline: crawl, three checks per page, group, rank.
// No LLM anywhere. Throws SsrfError before touching the network if the start
// URL is not allowed.
export async function scanSite(startUrl: string, options: ScanSiteOptions = {}): Promise<ScanReport> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const log = options.log ?? createLogger({ level: "warn" });
  const allowLocal = options.allowLocal ?? false;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const maxPages = Math.min(HARD_MAX_PAGES, Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES));

  const { url } = await checkUrl(startUrl, { allowLocal });
  url.hash = "";
  const fetchOptions = { userAgent, allowLocal };

  const browser = await openScanBrowser({ allowLocal, userAgent, log });
  try {
    const first = await scanPage(browser, url.href, { index: 0, isStartPage: true, log, saveScreenshot: options.saveScreenshot });
    if (first.page.error && first.page.httpStatus === null) {
      throw new Error(`Could not load ${url.href}: ${first.page.error}`);
    }
    // Discover from where the start page actually landed: example.com often
    // redirects to www.example.com, and every link then lives on www. The
    // redirect already passed the guard; robots.txt never applied to the
    // start page, so fetching it now changes nothing.
    const base = new URL(first.page.finalUrl ?? url.href);
    const robots = await fetchRobots(base.origin, fetchOptions, log);
    const sitemapUrls = await fetchSitemapUrls(base.origin, robots.rules, fetchOptions, log);
    const source = sitemapUrls.length > 0 ? "sitemap" : "links";
    const candidates = source === "sitemap" ? sitemapUrls : first.links;
    const pick = pickPages(base.href, candidates, maxPages, robots.rules);
    const discoveryMs = Date.now() - started;
    log.info("pages discovered", { source, candidates: candidates.length, picked: pick.pages.length });
    options.onProgress?.({ pagesFound: pick.pages.length, pagesScanned: 1 });

    const scans = [first];
    for (const [i, pageUrl] of pick.pages.slice(1).entries()) {
      await sleep(PAGE_DELAY_MS); // be polite to small sites
      scans.push(await scanPage(browser, pageUrl, { index: i + 1, isStartPage: false, log, saveScreenshot: options.saveScreenshot }));
      options.onProgress?.({ pagesFound: pick.pages.length, pagesScanned: scans.length });
    }

    const pages: PageResult[] = scans.map((s) => s.page);
    const findings: Finding[] = scans.flatMap((s) => s.findings);
    const issues = groupFindings(findings, first.page.id);
    const altCandidates = findAltCandidates(scans.map<PageImages>((s) => ({ pageId: s.page.id, pageUrl: s.page.url, images: s.images })));

    for (const blocked of browser.proxyBlocked()) {
      log.info("proxy blocked a request", { url: blocked.url, reason: blocked.reason });
    }

    const issuesByImpact: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const issue of issues) issuesByImpact[issue.impact] = (issuesByImpact[issue.impact] ?? 0) + 1;

    // Parsing our own output catches schema drift here instead of in the DB.
    return ScanReport.parse({
      version: 1,
      startUrl,
      normalizedUrl: normalizeUrl(url),
      startedAt,
      finishedAt: new Date().toISOString(),
      options: { maxPages, allowLocal, userAgent },
      discovery: { source, robotsStatus: robots.status, candidates: candidates.length },
      pages,
      skippedPages: pick.skipped,
      findings,
      issues,
      altCandidates,
      summary: {
        pages: pages.length,
        findings: findings.length,
        issues: issues.length,
        issuesByImpact,
        needsReview: pages.reduce((sum, p) => sum + p.incompleteCount, 0),
      },
      timings: { totalMs: Date.now() - started, discoveryMs },
    });
  } finally {
    await browser.close();
  }
}
