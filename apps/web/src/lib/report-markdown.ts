import type { IssueView, ScanView } from "./scan-view";

export const DISCLAIMER =
  "Automated testing catches only part of WCAG issues and cannot certify WCAG or ADA compliance. A human review is still needed.";

// Markdown fences break if the snippet itself contains ```; a longer fence is
// always safe (CommonMark closes on a fence at least as long as the opener).
function fence(code: string, lang = "html"): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

export function issueHeading(issue: IssueView): string {
  return issue.title ?? issue.help ?? issue.ruleId;
}

function issueMarkdown(issue: IssueView): string {
  const where = `${issue.occurrenceCount} occurrence${issue.occurrenceCount === 1 ? "" : "s"} on ${issue.pageCount} page${issue.pageCount === 1 ? "" : "s"}`;
  const lines = [`### ${issue.rank}. ${issueHeading(issue)}`, "", `**${issue.impact}** · \`${issue.ruleId}\` · ${where}`, ""];
  if (issue.explanation) lines.push(issue.explanation, "");
  if (issue.whoIsAffected) lines.push(`**Who is affected:** ${issue.whoIsAffected}`, "");
  if (issue.howToFix) lines.push(`**How to fix:** ${issue.howToFix}`, "");
  if (!issue.explanation && issue.help) lines.push(issue.help, "");
  if (issue.exampleHtml) {
    lines.push(`Example${issue.examplePageUrl ? ` on ${issue.examplePageUrl}` : ""}:`, "", fence(issue.exampleHtml), "");
  }
  if (issue.helpUrl) lines.push(`More: ${issue.helpUrl}`, "");
  return lines.join("\n");
}

export function reportToMarkdown(scan: ScanView, reportUrl: string): string {
  const report = scan.report;
  if (!report) return "";
  const s = report.summary;
  const impact = (["critical", "serious", "moderate", "minor"] as const).map((k) => `${s.issuesByImpact[k]} ${k}`).join(", ");
  return [
    `# Accessibility report for ${scan.url}`,
    "",
    `Scanned ${s.pages} page${s.pages === 1 ? "" : "s"} on ${scan.finishedAt?.slice(0, 10) ?? scan.createdAt.slice(0, 10)} with a11yagent. Full report: ${reportUrl}`,
    "",
    `**${s.issues} issue${s.issues === 1 ? "" : "s"}** (${impact}) from ${s.findings} findings. ${s.needsReview} items need human review.`,
    "",
    "## Issues, most important first",
    "",
    ...report.issues.map(issueMarkdown),
    "---",
    "",
    `_${DISCLAIMER}_`,
    "",
  ].join("\n");
}
