import type { AltReview, AltVerdict, Logger, ScanReport } from "@a11yagent/core";
import { reviewAltText } from "@a11yagent/core/agent";
import { Budget, createMemoryTrace, LlmClient, type LlmConfig } from "@a11yagent/core/llm";
import { captureImage, DEFAULT_USER_AGENT, openScanBrowser } from "@a11yagent/core/scanner";
import { pageKey } from "./evidence.js";
import type { AltCase } from "./groundTruth.js";
import type { Resolver } from "./match.js";

export interface AltCaseResult {
  id: string;
  verdict: AltVerdict | null;
  accept: AltVerdict[];
  correct: boolean;
  // "scan": the pipeline reviewed it as a candidate. "direct": not a
  // candidate (good alt text), so the eval asked the reviewer itself.
  via: "scan" | "direct" | "missing";
  suggestedAlt: string | null;
}

export interface AltAccuracy {
  correct: number;
  total: number;
  cases: AltCaseResult[];
  // Calls spent on "direct" reviews. Kept out of the per-scan cost metric,
  // because a real scan never makes them.
  extraCalls: number;
}

type Image = NonNullable<ScanReport["pages"][number]["images"]>[number];

// Finds the image the case points at by DOM identity, like the issue matcher.
function findImage(report: ScanReport, c: AltCase, resolve: Resolver): Image | null {
  const want = resolve(c.page, c.selector);
  if (!want) return null;
  for (const page of report.pages) {
    if (pageKey(page.url) !== c.page) continue;
    for (const img of page.images ?? []) {
      const got = resolve(c.page, img.selector);
      if (got?.self.some((el) => want.self.includes(el))) return img;
    }
  }
  return null;
}

export function imageSelectors(report: ScanReport): { page: string; selector: string }[] {
  return report.pages.flatMap((p) => (p.images ?? []).map((img) => ({ page: pageKey(p.url), selector: img.selector })));
}

export async function altVerdictAccuracy(args: { cases: AltCase[]; report: ScanReport; resolve: Resolver; config: LlmConfig; log: Logger }): Promise<AltAccuracy> {
  const { cases, report, resolve, config, log } = args;
  const reviewsBySrcAlt = new Map(report.altCandidates.filter((c) => c.review).map((c) => [`${c.src}\u0000${c.alt}`, c.review as AltReview]));

  const budget = new Budget({ maxCalls: 10, maxOutputTokens: 15_000, dailyRemaining: config.limits.DAILY_LLM_CALL_CAP });
  const client = new LlmClient({ providers: config.providers, budget, log, timeoutMs: config.limits.LLM_TIMEOUT_MS });
  const sink = createMemoryTrace(crypto.randomUUID());
  const browser = await openScanBrowser({ allowLocal: true, userAgent: DEFAULT_USER_AGENT, log });
  const results: AltCaseResult[] = [];
  try {
    for (const c of cases) {
      const img = findImage(report, c, resolve);
      let review: AltReview | null = null;
      let via: AltCaseResult["via"] = "missing";
      if (img) {
        review = reviewsBySrcAlt.get(`${img.src}\u0000${img.alt}`) ?? null;
        via = "scan";
        const isCandidate = report.altCandidates.some((cand) => cand.src === img.src && cand.alt === img.alt);
        if (!review && !isCandidate) {
          const outcome = await reviewAltText(img, { client, sink, log, capture: (src) => captureImage(browser, src) });
          review = outcome.status === "reviewed" ? outcome.review : null;
          via = "direct";
        }
      }
      const verdict = review?.verdict ?? null;
      results.push({ id: c.id, verdict, accept: c.accept, correct: verdict !== null && c.accept.includes(verdict), via, suggestedAlt: review?.suggestedAlt ?? null });
    }
  } finally {
    await browser.close();
  }
  return { correct: results.filter((r) => r.correct).length, total: results.length, cases: results, extraCalls: budget.usage().calls };
}
