import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createLogger, loadEnvFileUnderShell } from "@a11yagent/core";
import { enrichReport, MAX_EXPLAINED_ISSUES } from "@a11yagent/core/agent";
import { loadLlmConfig } from "@a11yagent/core/llm";
import { DEFAULT_USER_AGENT, scanSite } from "@a11yagent/core/scanner";
import { GROUND_TRUTH_PATH, startFixtureServer } from "@a11yagent/fixtures";
import { altVerdictAccuracy, imageSelectors, type AltAccuracy } from "./altAccuracy.js";
import { collectEvidence } from "./evidence.js";
import { formatReport } from "./format.js";
import { loadGroundTruth } from "./groundTruth.js";
import { matchGroundTruth } from "./match.js";
import { computeMetrics } from "./metrics.js";
import { brokenGroundTruth, resolveSelectors } from "./resolve.js";
import { buildRecord, writeRecord } from "./results.js";

// pnpm eval [--no-keyboard] [--llm]
// Serves Bad Bakery on 127.0.0.1, runs the same scanSite() the CLI and worker
// use, grades it against ground_truth.json, prints a table, and writes
// packages/evals/results/<timestamp>.json. Exits 1 when a target is missed,
// so it can gate CI later.

const out = (text: string): void => void process.stdout.write(text + "\n");
const fail = (text: string, code: number): never => {
  process.stderr.write(text + "\n");
  process.exit(code);
};

const argv = process.argv.slice(2);
const unknown = argv.filter((a) => a !== "--no-keyboard" && a !== "--llm" && a !== "--");
if (unknown.length > 0) fail(`Unknown argument: ${unknown.join(" ")}\nUsage: pnpm eval [--no-keyboard] [--llm]`, 64);
const keyboardWalk = !argv.includes("--no-keyboard");
// --llm runs the same LLM stage as `pnpm scan --llm`, with keys from
// apps/worker/.env, and adds alt verdict accuracy and cost to the table.
const useLlm = argv.includes("--llm");
if (useLlm) loadEnvFileUnderShell(fileURLToPath(new URL("../../../apps/worker/.env", import.meta.url)));

// The eval scans 127.0.0.1, which the SSRF guard only allows with
// ALLOW_LOCAL_TARGETS. Same production refusal as the CLI (DECISIONS.md D12).
if (process.env.NODE_ENV === "production") fail("Refused: pnpm eval needs ALLOW_LOCAL_TARGETS, which is not allowed when NODE_ENV=production.", 2);
process.env.ALLOW_LOCAL_TARGETS = "true";

const log = createLogger({
  level: process.env.LOG_LEVEL === "debug" ? "debug" : "warn",
  base: { service: "evals" },
  write: (line) => void process.stderr.write(line + "\n"),
});

const config = useLlm ? loadLlmConfig() : null;
if (config && config.providers.length === 0) fail("--llm needs at least one provider configured (see apps/worker/.env.example).", 2);

const startedAt = new Date().toISOString();
const groundTruth = await loadGroundTruth(GROUND_TRUTH_PATH);
// Port 0: the OS picks a free port, so a running `pnpm fixtures:serve` never collides.
const server = await startFixtureServer(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

try {
  out(`Scanning ${baseUrl} (keyboard walk ${keyboardWalk ? "on" : "off"})...`);
  // maxPages 10: the fixture has 7 pages and every one must be scanned,
  // including the control page (DECISIONS.md D15).
  const scanned = await scanSite(baseUrl, { allowLocal: true, maxPages: 10, keyboardWalk, log });
  const report = config ? await enrichReport(scanned, { config, llmCallsToday: 0, log, allowLocal: true, userAgent: DEFAULT_USER_AGENT }) : scanned;
  const evidence = collectEvidence(report, { altCandidates: !useLlm });

  const wanted = new Map<string, Set<string>>();
  const want = (page: string, selector: string): void => {
    const set = wanted.get(page) ?? new Set<string>();
    wanted.set(page, set.add(selector));
  };
  for (const e of groundTruth.issues) want(e.page, e.selector);
  for (const ev of evidence) want(ev.page, ev.selector);
  for (const c of groundTruth.alt_cases) want(c.page, c.selector);
  for (const img of imageSelectors(report)) want(img.page, img.selector);
  const resolve = await resolveSelectors(baseUrl, wanted, log);

  const broken = brokenGroundTruth([...groundTruth.issues, ...groundTruth.alt_cases], resolve);
  if (broken.length > 0) fail(`ground_truth.json has selectors that match nothing:\n  ${broken.join("\n  ")}`, 1);

  const result = matchGroundTruth(groundTruth.issues, evidence, resolve, groundTruth.control_pages);
  let alt: AltAccuracy | null = null;
  if (config) {
    out("Checking alt verdicts...");
    alt = await altVerdictAccuracy({ cases: groundTruth.alt_cases, report, resolve, config, log });
  }
  const usage = report.llm?.usage;
  const metrics = computeMetrics(
    result,
    alt && usage && report.llm
      ? {
          altCorrect: alt.correct,
          altTotal: alt.total,
          ...usage,
          explained: report.issues.filter((i) => i.explanation).length,
          explainable: Math.min(MAX_EXPLAINED_ISSUES, report.issues.length),
          explainerStatus: report.llm.explainer.status,
          extraEvalCalls: alt.extraCalls,
        }
      : null,
  );
  const label = [keyboardWalk ? "full pipeline" : "ablation: keyboard walk disabled", useLlm ? "with LLM" : "no LLM"].join(", ");
  out(formatReport(metrics, result, label, alt));

  const file = await writeRecord(buildRecord({ startedAt, keyboardWalk, llm: useLlm, metrics, result, report, alt }));
  out(`\nResults written to ${file}`);
  process.exitCode = metrics.passed ? 0 : 1;
} finally {
  server.close();
}
