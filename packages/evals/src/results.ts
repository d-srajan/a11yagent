import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanReport } from "@a11yagent/core";
import type { MatchResult } from "./match.js";
import type { Metrics } from "./metrics.js";

export const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Small on purpose: these files are committed as the run history, so they
// keep metrics and per-issue outcomes, not the full scan report.
export interface RunRecord {
  version: 1;
  startedAt: string;
  finishedAt: string;
  gitSha: string | null;
  // Whether the working tree had uncommitted changes: a result from a dirty
  // tree can't be reproduced from gitSha alone.
  dirty: boolean;
  options: { keyboardWalk: boolean };
  metrics: Metrics;
  issues: { id: string; page: string; rule: string; detected: boolean; kind: string | null; reportedSelector: string | null }[];
  controlFalsePositives: { page: string; rule: string; selector: string; kind: string }[];
  unmatched: { page: string; rule: string; selector: string; kind: string }[];
  scan: { pages: number; findings: number; totalMs: number };
}

function isDirty(): boolean {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
  } catch {
    return false;
  }
}

export function buildRecord(args: {
  startedAt: string;
  keyboardWalk: boolean;
  metrics: Metrics;
  result: MatchResult;
  report: ScanReport;
}): RunRecord {
  const brief = (ev: { page: string; ruleId: string; selector: string; kind: string }): RunRecord["unmatched"][number] => ({
    page: ev.page,
    rule: ev.ruleId,
    selector: ev.selector,
    kind: ev.kind,
  });
  return {
    version: 1,
    startedAt: args.startedAt,
    finishedAt: new Date().toISOString(),
    gitSha: gitSha(),
    dirty: isDirty(),
    options: { keyboardWalk: args.keyboardWalk },
    metrics: args.metrics,
    issues: args.result.entries.map(({ entry, evidence }) => ({
      id: entry.id,
      page: entry.page,
      rule: entry.expected_rule,
      detected: evidence !== null,
      kind: evidence?.kind ?? null,
      reportedSelector: evidence?.selector ?? null,
    })),
    controlFalsePositives: args.result.control.map(brief),
    unmatched: args.result.unmatched.map(brief),
    scan: { pages: args.report.pages.length, findings: args.report.findings.length, totalMs: args.report.timings.totalMs },
  };
}

// <timestamp>.json, with ":" replaced so the name is valid on every OS.
export async function writeRecord(record: RunRecord, dir = RESULTS_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
  return file;
}
