import { createLogger } from "@a11yagent/core";
import { loadEnv } from "./env.js";
import { startHealthServer } from "./health.js";
import { startPollLoop, type ProcessScan } from "./poller.js";
import { createSupabaseClient, createSupabaseQueue } from "./queue.js";

const env = loadEnv();
const log = createLogger({ level: env.LOG_LEVEL, base: { service: "worker" } });

// Phase 0: no real work yet. Phase 1+ replaces this with the scan pipeline.
const processScan: ProcessScan = async () => {};

const queue = createSupabaseQueue(
  createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
);
const loop = startPollLoop({ queue, processScan, log, intervalMs: env.POLL_INTERVAL_MS });
const server = startHealthServer(env.PORT, loop.lastPollAt);

log.info("worker started", { port: env.PORT, pollIntervalMs: env.POLL_INTERVAL_MS });

const shutdown = async (signal: string): Promise<void> => {
  log.info("shutting down", { signal });
  // Let the in-flight scan reach a terminal status before exiting.
  await loop.stop();
  server.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
