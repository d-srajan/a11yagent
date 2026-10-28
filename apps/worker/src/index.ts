import { createLogger, type ScanRow } from "@a11yagent/core";
import { loadLlmConfig } from "@a11yagent/core/llm";
import { loadEnv } from "./env.js";
import { startHealthServer } from "./health.js";
import { startPollLoop, type ProcessScan } from "./poller.js";
import { createSupabaseClient, createSupabaseQueue, type ScanQueue } from "./queue.js";
import { createProcessScan } from "./runScan.js";
import { ensureScreenshotBucket } from "./storage.js";

const env = loadEnv();
const log = createLogger({ level: env.LOG_LEVEL, base: { service: "worker" } });
const db = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const supabaseQueue = createSupabaseQueue(db);

const llm = loadLlmConfig();
for (const s of llm.skipped) log.warn("LLM provider skipped: missing env", { provider: s.name, missing: s.missing });
await ensureScreenshotBucket(db);

// Kill switch: with SCANS_ENABLED=false the worker keeps polling (so
// /healthz stays green) but never claims anything.
const queue: ScanQueue = env.SCANS_ENABLED ? supabaseQueue : { ...supabaseQueue, claimNext: async () => null };
if (!env.SCANS_ENABLED) log.warn("SCANS_ENABLED=false: not claiming scans");

// Remember the scan in flight so a shutdown can hand it back to the queue.
let current: ScanRow | null = null;
const runScan = createProcessScan({ db, queue, llm, log, allowLocal: env.ALLOW_LOCAL_TARGETS, defaultMaxPages: env.MAX_PAGES_PER_SCAN });
const processScan: ProcessScan = async (scan) => {
  current = scan;
  try {
    await runScan(scan);
  } finally {
    current = null;
  }
};

const loop = startPollLoop({ queue, processScan, log, intervalMs: env.POLL_INTERVAL_MS });
const server = startHealthServer(env.PORT, loop.lastPollAt);

log.info("worker started", { port: env.PORT, pollIntervalMs: env.POLL_INTERVAL_MS, providers: llm.providers.map((p) => p.name) });

// A scan takes minutes and `docker stop` waits 10 s, so waiting for it to
// finish would end in SIGKILL and a scan stuck until the 10-minute stale
// timeout. Instead, hand it straight back: requeued if it has an attempt
// left (the next worker start picks it up at once), failed if not.
const shutdown = async (signal: string): Promise<void> => {
  log.info("shutting down", { signal });
  const inFlight = current;
  if (inFlight) {
    try {
      const outcome = await supabaseQueue.release(inFlight);
      log.info("released in-flight scan", { scanId: inFlight.id, attempts: inFlight.attempts, outcome });
    } catch (err) {
      log.error("could not release in-flight scan; the stale timeout will retry it", { scanId: inFlight.id, err });
    }
    server.close();
    process.exit(0);
  }
  await loop.stop();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
