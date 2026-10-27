import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { Impact } from "../report-schema.js";
import type { RawFinding } from "./types.js";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// empty-heading is tagged "best-practice" only, so the WCAG tags above would
// never run it, but the spec counts it as a planted issue. Enabling the one
// rule, instead of all best-practice rules, keeps the noise down.
export const AXE_EXTRA_RULES = ["empty-heading"];

const SNIPPET_LIMIT = 1000;

export function truncate(text: string, limit = SNIPPET_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}

// "wcag143" -> "1.4.3", "wcag1410" -> "1.4.10".
export function wcagCriteria(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

// axe targets are arrays: one selector per frame or shadow root on the way down.
function joinTarget(target: unknown): string {
  const parts = Array.isArray(target) ? target : [target];
  return parts.map((p) => (Array.isArray(p) ? p.join(" >>> ") : String(p))).join(" >>> ");
}

export interface AxeOutcome {
  findings: RawFinding[];
  incompleteCount: number;
  incompleteByRule: Record<string, number>;
  raw: { violations: unknown; incomplete: unknown };
}

export async function runAxe(page: Page): Promise<AxeOutcome> {
  const extraRules = Object.fromEntries(AXE_EXTRA_RULES.map((id) => [id, { enabled: true }]));
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: AXE_TAGS }, rules: extraRules })
    .analyze();

  const findings: RawFinding[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      findings.push({
        source: "axe",
        ruleId: violation.id,
        impact: (node.impact ?? violation.impact ?? "moderate") as Impact,
        wcag: wcagCriteria(violation.tags),
        selector: joinTarget(node.target),
        htmlSnippet: truncate(node.html),
        message: node.failureSummary ?? violation.help,
        data: { help: violation.help, description: violation.description, helpUrl: violation.helpUrl },
      });
    }
  }

  const incompleteByRule: Record<string, number> = {};
  let incompleteCount = 0;
  for (const item of results.incomplete) {
    incompleteByRule[item.id] = item.nodes.length;
    incompleteCount += item.nodes.length;
  }

  // Passes and inapplicable rules are dropped: they are most of the payload
  // and nothing downstream reads them.
  return { findings, incompleteCount, incompleteByRule, raw: { violations: results.violations, incomplete: results.incomplete } };
}
