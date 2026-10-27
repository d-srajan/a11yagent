import type { Logger } from "@a11yagent/core";
import { DEFAULT_USER_AGENT, openScanBrowser } from "@a11yagent/core/scanner";
import type { ResolvedElements, Resolver } from "./match.js";

// Ground truth is written by a person ("button.cart"), and the scanner writes
// whatever selector axe or the CSS-path builder picks ("button"). Comparing
// the strings would turn every naming difference into a miss, and a fuzzy
// string match would be guesswork. So we ask the page itself: load each
// fixture page once and record which elements every selector selects.
// Uses the same guarded browser as scans, so the eval obeys the SSRF rule.
export async function resolveSelectors(baseUrl: string, wanted: Map<string, Set<string>>, log: Logger): Promise<Resolver> {
  const resolved = new Map<string, Map<string, ResolvedElements | null>>();
  const browser = await openScanBrowser({ allowLocal: true, userAgent: DEFAULT_USER_AGENT, log });
  try {
    for (const [page, selectors] of wanted) {
      const { page: tab, context } = await browser.newPage();
      try {
        await tab.goto(new URL(page, baseUrl).href, { waitUntil: "load" });
        const list = [...selectors];
        const out = await tab.evaluate((sels: string[]) => {
          const index = new Map<Element, number>();
          document.querySelectorAll("*").forEach((el, i) => index.set(el, i));
          return sels.map((sel) => {
            let els: Element[];
            try {
              els = Array.from(document.querySelectorAll(sel));
            } catch {
              return null; // not plain CSS, e.g. an iframe path with ">>>"
            }
            const lineage = new Set<number>();
            for (const el of els) {
              for (let n: Element | null = el; n; n = n.parentElement) lineage.add(index.get(n) ?? -1);
            }
            return { self: els.map((el) => index.get(el) ?? -1), lineage: [...lineage] };
          });
        }, list);
        resolved.set(page, new Map(list.map((sel, i) => [sel, out[i] ?? null])));
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  return (page, selector) => {
    const hit = resolved.get(page)?.get(selector);
    return hit && hit.self.length > 0 ? hit : undefined;
  };
}

// A ground-truth selector that selects nothing is a bug in the ground truth,
// and would otherwise read as a scanner miss. Report it loudly.
export function brokenGroundTruth(entries: { id: string; page: string; selector: string }[], resolve: Resolver): string[] {
  return entries.filter((e) => !resolve(e.page, e.selector)).map((e) => `${e.id}: ${e.selector} selects nothing on ${e.page}`);
}
