import type { ScanReport } from "@a11yagent/core";
import { z } from "zod";

// Everything the scanner says about a page element, in one shape. Phase 1
// reports problems three ways, and the eval has to see all of them:
// - finding: an axe violation or keyboard-walk result (the normal case)
// - alt_candidate: alt text the rules flagged; the Phase 3 reviewer turns
//   confirmed ones into a11y-alt-quality findings
// - needs_review: an axe "incomplete" node (see DECISIONS.md D13)
export const EVIDENCE_KINDS = ["finding", "alt_candidate", "needs_review"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  kind: EvidenceKind;
  page: string;
  ruleId: string;
  selector: string;
  // Finding id, or a readable label for the kinds that have no id.
  ref: string;
}

export const ALT_QUALITY_RULE = "a11y-alt-quality";

// "http://127.0.0.1:4173/" -> "index.html", "/about.html" -> "about.html".
export function pageKey(url: string): string {
  const path = new URL(url).pathname.replace(/^\/+/, "");
  return path === "" || path.endsWith("/") ? path + "index.html" : path;
}

// axeRaw is stored as unknown in the report; read only what we need.
const AxeIncomplete = z.object({
  incomplete: z.array(z.object({ id: z.string(), nodes: z.array(z.object({ target: z.array(z.unknown()) })) })),
});

const joinTarget = (target: unknown[]): string =>
  target.map((p) => (Array.isArray(p) ? p.join(" >>> ") : String(p))).join(" >>> ");

export function collectEvidence(report: ScanReport): Evidence[] {
  const evidence: Evidence[] = report.findings.map((f) => ({
    kind: "finding",
    page: pageKey(f.pageUrl),
    ruleId: f.ruleId,
    selector: f.selector,
    ref: f.id,
  }));
  for (const c of report.altCandidates) {
    evidence.push({ kind: "alt_candidate", page: pageKey(c.pageUrl), ruleId: ALT_QUALITY_RULE, selector: c.selector, ref: `alt "${c.alt}"` });
  }
  for (const page of report.pages) {
    const raw = AxeIncomplete.safeParse(page.axeRaw);
    if (!raw.success) continue;
    for (const item of raw.data.incomplete) {
      for (const node of item.nodes) {
        evidence.push({ kind: "needs_review", page: pageKey(page.url), ruleId: item.id, selector: joinTarget(node.target), ref: `incomplete ${item.id}` });
      }
    }
  }
  return evidence;
}
