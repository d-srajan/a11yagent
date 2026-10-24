import type { Logger, ScanRow } from "@a11yagent/core";
import type { ScanQueue } from "./queue.js";

export type ProcessScan = (scan: ScanRow) => Promise<void>;

export type PollOutcome = "idle" | "processed" | "failed" | "error";

// One poll: claim at most one scan and run it to a terminal status.
// Errors never escape, so a single bad scan or a DB blip cannot kill the loop.
export async function pollOnce(
  queue: ScanQueue,
  processScan: ProcessScan,
  log: Logger,
): Promise<PollOutcome> {
  let scan: ScanRow | null;
  try {
    scan = await queue.claimNext();
  } catch (err) {
    log.error("claim failed", { err });
    return "error";
  }

  log.debug("poll", { claimed: scan?.id ?? null });
  if (!scan) return "idle";

  const scanLog = log.child({ scanId: scan.id, attempt: scan.attempts });
  scanLog.info("claimed scan", { url: scan.url });
  try {
    await processScan(scan);
    await queue.markDone(scan.id);
    scanLog.info("scan done");
    return "processed";
  } catch (err) {
    scanLog.error("scan failed", { err });
    try {
      await queue.markFailed(scan.id, err instanceof Error ? err.message : String(err));
    } catch (markErr) {
      // Leave it: claim_next_scan() will retry or fail it after the stale timeout.
      scanLog.error("could not mark scan failed", { err: markErr });
    }
    return "failed";
  }
}

export interface PollLoop {
  stop(): Promise<void>;
  lastPollAt(): Date | null;
}

// setTimeout chaining instead of setInterval: the next poll is scheduled only
// after the current one finishes, so polls never overlap and only one scan
// runs at a time (MAX_CONCURRENT_SCANS = 1).
export function startPollLoop(opts: {
  queue: ScanQueue;
  processScan: ProcessScan;
  log: Logger;
  intervalMs: number;
}): PollLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();
  let last: Date | null = null;

  const tick = (): void => {
    if (stopped) return;
    last = new Date();
    inFlight = pollOnce(opts.queue, opts.processScan, opts.log).finally(() => {
      if (!stopped) timer = setTimeout(tick, opts.intervalMs);
    });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
    lastPollAt: () => last,
  };
}
