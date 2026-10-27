import type { Logger } from "../logger.js";
import type { Finding, PageResult } from "../report-schema.js";
import { runAxe } from "./axeCheck.js";
import { VIEWPORT, type ScanBrowser } from "./browser.js";
import { runKeyboardWalk } from "./keyboardWalk.js";
import { runProbe } from "./pageProbe.js";
import type { ImageRecord } from "./types.js";

export const NAV_TIMEOUT_MS = 30_000;
export const NETWORK_IDLE_CAP_MS = 15_000;
export const MAX_SCREENSHOT_HEIGHT = 6000;

export type SaveScreenshot = (page: { id: string; url: string; index: number }, jpeg: Buffer) => Promise<string | null>;

export interface PageScan {
  page: PageResult;
  findings: Finding[];
  images: ImageRecord[];
  links: string[];
}

export interface ScanPageOptions {
  index: number;
  isStartPage: boolean;
  log: Logger;
  saveScreenshot?: SaveScreenshot | undefined;
}

export async function scanPage(browser: ScanBrowser, url: string, options: ScanPageOptions): Promise<PageScan> {
  const started = Date.now();
  const id = crypto.randomUUID();
  const log = options.log.child({ page: url });
  const { page, context, blocked } = await browser.newPage();

  const result: PageResult = {
    id,
    url,
    finalUrl: null,
    isStartPage: options.isStartPage,
    title: null,
    httpStatus: null,
    screenshotPath: null,
    findingCount: 0,
    incompleteCount: 0,
    incompleteByRule: {},
    blockedRequests: blocked,
    keyboard: null,
    axeRaw: null,
    error: null,
    durationMs: 0,
  };
  const findings: Finding[] = [];
  let images: ImageRecord[] = [];
  let links: string[] = [];

  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_CAP_MS }).catch(() => {});
    result.httpStatus = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = (await page.title()) || null;
    links = await page.$$eval("a[href]", (anchors) => anchors.map((a) => (a as HTMLAnchorElement).href));

    if (options.saveScreenshot) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const jpeg = await page.screenshot({
        type: "jpeg",
        quality: 60,
        fullPage: true,
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(Math.max(height, 1), MAX_SCREENSHOT_HEIGHT) },
      });
      result.screenshotPath = await options.saveScreenshot({ id, url, index: options.index }, jpeg);
    }

    // Order matters: axe and the image probe read the page as loaded; the
    // keyboard walk moves focus and injects a style, so it runs last.
    const attach = (raw: Omit<Finding, "id" | "pageId" | "pageUrl">): Finding => ({ ...raw, id: crypto.randomUUID(), pageId: id, pageUrl: url });
    const axe = await runAxe(page);
    findings.push(...axe.findings.map(attach));
    result.incompleteCount = axe.incompleteCount;
    result.incompleteByRule = axe.incompleteByRule;
    result.axeRaw = axe.raw;

    images = await runProbe<ImageRecord[]>(page, "images");

    const keyboard = await runKeyboardWalk(page);
    findings.push(...keyboard.findings.map(attach));
    result.keyboard = keyboard.result;
  } catch (err) {
    result.error = err instanceof Error ? err.message.split("\n")[0] ?? err.message : String(err);
    log.warn("page scan failed", { error: result.error });
  } finally {
    await context.close().catch(() => {});
  }

  result.findingCount = findings.length;
  result.durationMs = Date.now() - started;
  log.info("page scanned", { findings: findings.length, ms: result.durationMs, error: result.error });
  return { page: result, findings, images, links };
}
