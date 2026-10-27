import type { AddressInfo } from "node:net";
import { createLogger } from "@a11yagent/core";
import { scanSite } from "@a11yagent/core/scanner";
import { GROUND_TRUTH_PATH, startFixtureServer } from "@a11yagent/fixtures";
import { collectEvidence } from "./evidence.js";
import { formatReport } from "./format.js";
import { loadGroundTruth } from "./groundTruth.js";
import { matchGroundTruth } from "./match.js";
import { computeMetrics } from "./metrics.js";
import { brokenGroundTruth, resolveSelectors } from "./resolve.js";
import { buildRecord, writeRecord } from "./results.js";

// pnpm eval [--no-keyboard]
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
const unknown = argv.filter((a) => a !== "--no-keyboard");
if (unknown.length > 0) fail(`Unknown argument: ${unknown.join(" ")}\nUsage: pnpm eval [--no-keyboard]`, 64);
const keyboardWalk = !argv.includes("--no-keyboard");

// The eval scans 127.0.0.1, which the SSRF guard only allows with
// ALLOW_LOCAL_TARGETS. Same production refusal as the CLI (DECISIONS.md D12).
if (process.env.NODE_ENV === "production") fail("Refused: pnpm eval needs ALLOW_LOCAL_TARGETS, which is not allowed when NODE_ENV=production.", 2);
process.env.ALLOW_LOCAL_TARGETS = "true";

const log = createLogger({
  level: process.env.LOG_LEVEL === "debug" ? "debug" : "warn",
  base: { service: "evals" },
  write: (line) => void process.stderr.write(line + "\n"),
});

const startedAt = new Date().toISOString();
const groundTruth = await loadGroundTruth(GROUND_TRUTH_PATH);
// Port 0: the OS picks a free port, so a running `pnpm fixtures:serve` never collides.
const server = await startFixtureServer(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

try {
  out(`Scanning ${baseUrl} (keyboard walk ${keyboardWalk ? "on" : "off"})...`);
  // maxPages 10: the fixture has 7 pages and every one must be scanned,
  // including the control page (DECISIONS.md D15).
  const report = await scanSite(baseUrl, { allowLocal: true, maxPages: 10, keyboardWalk, log });
  const evidence = collectEvidence(report);

  const wanted = new Map<string, Set<string>>();
  const want = (page: string, selector: string): void => {
    const set = wanted.get(page) ?? new Set<string>();
    wanted.set(page, set.add(selector));
  };
  for (const e of groundTruth.issues) want(e.page, e.selector);
  for (const ev of evidence) want(ev.page, ev.selector);
  const resolve = await resolveSelectors(baseUrl, wanted, log);

  const broken = brokenGroundTruth(groundTruth.issues, resolve);
  if (broken.length > 0) fail(`ground_truth.json has selectors that match nothing:\n  ${broken.join("\n  ")}`, 1);

  const result = matchGroundTruth(groundTruth.issues, evidence, resolve, groundTruth.control_pages);
  const metrics = computeMetrics(result);
  out(formatReport(metrics, result, keyboardWalk ? "full pipeline" : "ablation: keyboard walk disabled"));

  const file = await writeRecord(buildRecord({ startedAt, keyboardWalk, metrics, result, report }));
  out(`\nResults written to ${file}`);
  process.exitCode = metrics.passed ? 0 : 1;
} finally {
  server.close();
}
