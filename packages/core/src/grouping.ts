import type { Finding, Issue } from "./report-schema.js";
import { compareIssues, highestImpact, isBlocker, severityScore } from "./scoring.js";

// "The same broken button in a shared header" shows up once per page, with a
// selector that differs only by position. Normalizing the selector lets all
// copies collapse into one issue with an occurrence count.
//   strip :nth-child(n), and ids containing digits (#post-123, #ember42)
export function normalizeSelector(selector: string): string {
  return selector
    .split(/(\s*>>>\s*|\s*[>+~]\s*|\s+)/)
    .map((part, i) => {
      if (i % 2 === 1) return part.trim() ? ` ${part.trim()} ` : " ";
      const stripped = part.replace(/:nth-child\(\s*\d+\s*\)/g, "").replace(/#(?:\\.|[\w-])*\d(?:\\.|[\w-])*/g, "");
      return stripped || (part ? "*" : "");
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function groupKeyOf(finding: Pick<Finding, "ruleId" | "selector">): string {
  return `${finding.ruleId}|${normalizeSelector(finding.selector)}`;
}

export function groupFindings(findings: Finding[], startPageId: string): Issue[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = groupKeyOf(finding);
    const list = groups.get(key);
    if (list) list.push(finding);
    else groups.set(key, [finding]);
  }

  const issues: Omit<Issue, "rank">[] = [];
  for (const [groupKey, members] of groups) {
    const first = members[0];
    if (!first) continue;
    const impact = highestImpact(members.map((f) => f.impact));
    const onStartPage = members.some((f) => f.pageId === startPageId);
    const blocker = isBlocker(first.ruleId, members);
    issues.push({
      id: crypto.randomUUID(),
      ruleId: first.ruleId,
      groupKey,
      source: first.source,
      impact,
      severityScore: severityScore({ impact, occurrences: members.length, onStartPage, blocker }),
      occurrenceCount: members.length,
      pageCount: new Set(members.map((f) => f.pageId)).size,
      onStartPage,
      blocker,
      findingIds: members.map((f) => f.id),
      wcag: [...new Set(members.flatMap((f) => f.wcag))].sort(),
      help: typeof first.data.help === "string" ? first.data.help : first.message,
      helpUrl: typeof first.data.helpUrl === "string" ? first.data.helpUrl : null,
      exampleSelector: first.selector,
      exampleHtml: first.htmlSnippet,
    });
  }

  return issues.sort(compareIssues).map((issue, i) => ({ ...issue, rank: i + 1 }));
}
