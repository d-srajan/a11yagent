import type { Logger, ScanProgress, ScanRow } from "@a11yagent/core";
import { enrichReport } from "@a11yagent/core/agent";
import type { LlmConfig } from "@a11yagent/core/llm";
import { scanSite } from "@a11yagent/core/scanner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countLlmCallsToday } from "./agentSteps.js";
import { clearScanResults, writeReport } from "./persist.js";
import type { ProcessScan } from "./poller.js";
import type { ScanQueue } from "./queue.js";
import { screenshotPath, uploadScreenshot } from "./storage.js";

export interface RunScanDeps {
  db: SupabaseClient;
  queue: ScanQueue;
  llm: LlmConfig;
  log: Logger;
  allowLocal: boolean;
  defaultMaxPages: number;
}

// The worker's real pipeline: the same scanSite + enrichReport the CLI and
// eval runner use, plus progress updates and the database writes. Throwing
// here makes the poller mark the scan failed with the error message.
export function createProcessScan(deps: RunScanDeps): ProcessScan {
  return async (scan: ScanRow) => {
    const log = deps.log.child({ scanId: scan.id });
    if (scan.attempts > 1) await clearScanResults(deps.db, scan.id);

    // Progress writes are chained, not awaited inside the scanner's callback,
    // so a slow DB never slows the crawl; a failed write only costs UX.
    let progressWrites = Promise.resolve();
    const report = (status: ScanRow["status"], progress: ScanProgress): void => {
      progressWrites = progressWrites
        .then(() => deps.queue.setStatus(scan.id, status, progress))
        .catch((err: unknown) => log.warn("progress update failed", { err }));
    };

    const scanned = await scanSite(scan.url, {
      allowLocal: deps.allowLocal,
      maxPages: scan.options.maxPages ?? deps.defaultMaxPages,
      log,
      onProgress: (p) => report("scanning", { pagesFound: p.pagesFound, pagesScanned: p.pagesScanned }),
      saveScreenshot: async ({ index, url }, jpeg) => {
        const path = screenshotPath(scan.id, index, url);
        try {
          await uploadScreenshot(deps.db, path, jpeg);
          return path;
        } catch (err) {
          // A report without a thumbnail beats a failed scan.
          log.warn("screenshot upload failed", { err });
          return null;
        }
      },
    });
    report("analyzing", { pagesFound: scanned.pages.length, pagesScanned: scanned.pages.length, issuesFound: scanned.issues.length });
    await progressWrites;

    // Like the CLI: the LLM stage never fails the scan. Parts it can't run
    // (budget, daily cap, providers down) come back marked "unavailable".
    const enriched = await enrichReport(scanned, {
      config: deps.llm,
      llmCallsToday: await countLlmCallsToday(deps.db),
      log,
      allowLocal: deps.allowLocal,
      userAgent: scanned.options.userAgent,
      scanId: scan.id,
    });

    await writeReport(deps.db, scan.id, enriched);
    log.info("report written", { pages: enriched.pages.length, issues: enriched.issues.length, llmCalls: enriched.llm?.usage.calls ?? 0 });
  };
}
