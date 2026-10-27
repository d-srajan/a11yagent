import type { ScanReport } from "@a11yagent/core";

const pad = (text: string, width: number): string => (text.length > width ? text.slice(0, width - 1) + "…" : text.padEnd(width));

// Human-readable summary for the terminal; the JSON report is the real output.
export function formatSummary(report: ScanReport, top = 15): string {
  const lines: string[] = [];
  const s = report.summary;
  lines.push(`Scanned ${s.pages} page(s) of ${report.normalizedUrl} in ${(report.timings.totalMs / 1000).toFixed(1)}s`);
  lines.push(`${s.findings} findings grouped into ${s.issues} issues (critical ${s.issuesByImpact.critical ?? 0}, serious ${s.issuesByImpact.serious ?? 0}, moderate ${s.issuesByImpact.moderate ?? 0}, minor ${s.issuesByImpact.minor ?? 0})`);
  lines.push(`${s.needsReview} element(s) need human review (axe "incomplete")`);

  lines.push("", "Pages:");
  for (const page of report.pages) {
    const status = page.error ? `ERROR ${page.error}` : `${page.httpStatus ?? "?"}`;
    lines.push(`  ${pad(new URL(page.url).pathname, 28)} ${pad(status, 8)} ${String(page.findingCount).padStart(3)} findings`);
  }
  for (const skipped of report.skippedPages) lines.push(`  (skipped ${skipped.url}: ${skipped.reason})`);

  lines.push("", `Top issues:`, `  ${pad("#", 3)} ${pad("score", 6)} ${pad("impact", 9)} ${pad("rule", 24)} ${pad("count", 5)} ${pad("pages", 5)} example`);
  for (const issue of report.issues.slice(0, top)) {
    lines.push(
      `  ${pad(String(issue.rank), 3)} ${pad(issue.severityScore.toFixed(1), 6)} ${pad(issue.impact, 9)} ${pad(issue.ruleId, 24)} ${pad(String(issue.occurrenceCount), 5)} ${pad(String(issue.pageCount), 5)} ${issue.exampleSelector}`,
    );
  }
  if (report.issues.length > top) lines.push(`  … and ${report.issues.length - top} more in the JSON report`);

  lines.push("", `Alt-text candidates (${report.altCandidates.length}):`);
  for (const c of report.altCandidates) {
    lines.push(`  "${c.alt}" [${c.reasons.join(", ")}] on ${new URL(c.pageUrl).pathname} ${c.selector}`);
  }
  return lines.join("\n");
}
