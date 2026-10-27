import type { Evidence, EvidenceKind } from "./evidence.js";
import type { GroundTruthEntry } from "./groundTruth.js";

// Where a selector lands in the page's DOM. Elements are identified by their
// position in document order, so two different selector strings that pick
// the same node compare equal. lineage = the matched elements plus all their
// ancestors.
export interface ResolvedElements {
  self: number[];
  lineage: number[];
}

// Returns undefined when the selector is invalid or the page was not loaded.
export type Resolver = (page: string, selector: string) => ResolvedElements | undefined;

export interface EntryResult {
  entry: GroundTruthEntry;
  evidence: Evidence | null;
}

export interface MatchResult {
  entries: EntryResult[];
  // Evidence not used by any planted issue, split by page type.
  unmatched: Evidence[];
  control: Evidence[];
}

// A real finding is the strongest evidence; prefer it when several match.
const KIND_PRIORITY: Record<EvidenceKind, number> = { finding: 0, alt_candidate: 1, needs_review: 2 };

// Same page, same rule, and the reported element is the planted element or
// sits inside it. Inside counts because some checks report a child: the
// keyboard trap is reported on the input where focus gets stuck, inside the
// planted dialog. The reverse (a finding on an ancestor) does not count, or
// a finding on <html> would match every planted issue on the page.
export function evidenceMatches(entry: GroundTruthEntry, ev: Evidence, resolve: Resolver): boolean {
  if (ev.page !== entry.page || ev.ruleId !== entry.expected_rule) return false;
  const planted = resolve(entry.page, entry.selector);
  const reported = resolve(ev.page, ev.selector);
  if (!planted || !reported) return false;
  return reported.lineage.some((el) => planted.self.includes(el));
}

// One-to-one matching: each piece of evidence can satisfy at most one planted
// issue. Otherwise one finding on a shared element could "detect" several
// planted issues and inflate recall. Greedy is enough here: planted issues
// on the same page and rule sit on different elements, so there are no
// real conflicts to optimize.
export function matchGroundTruth(
  entries: GroundTruthEntry[],
  evidence: Evidence[],
  resolve: Resolver,
  controlPages: string[],
): MatchResult {
  const ordered = [...evidence].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const used = new Set<Evidence>();
  const results: EntryResult[] = entries.map((entry) => {
    const hit = ordered.find((ev) => !used.has(ev) && evidenceMatches(entry, ev, resolve)) ?? null;
    if (hit) used.add(hit);
    return { entry, evidence: hit };
  });
  const leftover = evidence.filter((ev) => !used.has(ev));
  return {
    entries: results,
    unmatched: leftover.filter((ev) => !controlPages.includes(ev.page)),
    control: leftover.filter((ev) => controlPages.includes(ev.page)),
  };
}
