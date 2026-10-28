import { fileURLToPath } from "node:url";
import { loadEnvFileUnderShell, type Logger, type ScanReport } from "@a11yagent/core";
import { enrichReport } from "@a11yagent/core/agent";
import { loadLlmConfig } from "@a11yagent/core/llm";
import { countLlmCallsToday } from "./agentSteps.js";
import { createSupabaseClient } from "./queue.js";

// The worker's .env holds the provider keys; the CLI reads the same file so
// there is one place to put them. Variables already set in the shell win,
// which is how you test "invalid Gemini key" or DAILY_LLM_CALL_CAP=0.
export function loadWorkerEnvFile(): string | null {
  const file = fileURLToPath(new URL("../.env", import.meta.url));
  return loadEnvFileUnderShell(file) ? file : null;
}

// With Supabase configured, the CLI respects the same global daily cap as the
// worker. Without it (pure local use) there is nothing to count against.
async function llmCallsToday(log: Logger): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  try {
    return await countLlmCallsToday(createSupabaseClient(url, key));
  } catch (err) {
    log.warn("could not count today's LLM calls; assuming 0 for this local run", { error: err });
    return 0;
  }
}

export async function runLlmStage(report: ScanReport, options: { allowLocal: boolean; log: Logger }): Promise<ScanReport> {
  const config = loadLlmConfig();
  for (const s of config.skipped) options.log.warn("LLM provider skipped: missing env", { provider: s.name, missing: s.missing });
  if (config.providers.length === 0) options.log.warn("no LLM provider configured; explanations will be marked unavailable");
  return enrichReport(report, {
    config,
    llmCallsToday: await llmCallsToday(options.log),
    log: options.log,
    allowLocal: options.allowLocal,
    userAgent: report.options.userAgent,
  });
}
