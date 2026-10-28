import type { Impact } from "@a11yagent/core";
import { issueHeading } from "@/lib/report-markdown";
import type { IssueView } from "@/lib/scan-view";

// Text plus colour, never colour alone; each pair meets 4.5:1 in both themes.
const IMPACT_STYLE: Record<Impact, string> = {
  critical: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  serious: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
  moderate: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100",
  minor: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
};

export function IssueCard({ issue }: { issue: IssueView }) {
  const headingId = `issue-${issue.id}`;
  const where = `${issue.occurrenceCount} time${issue.occurrenceCount === 1 ? "" : "s"} on ${issue.pageCount} page${issue.pageCount === 1 ? "" : "s"}`;

  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">#{issue.rank}</span>
        <span className={`rounded px-2 py-0.5 font-medium capitalize ${IMPACT_STYLE[issue.impact]}`}>{issue.impact}</span>
        <code className="break-all text-muted-foreground">{issue.ruleId}</code>
        <span className="text-muted-foreground">· {where}</span>
      </div>
      <h3 id={headingId} className="mt-2 text-lg font-semibold">{issueHeading(issue)}</h3>

      {issue.explanation ? (
        <div className="mt-2 space-y-2">
          <p>{issue.explanation}</p>
          {issue.whoIsAffected ? (
            <p><span className="font-medium">Who is affected:</span> {issue.whoIsAffected}</p>
          ) : null}
          {issue.howToFix ? (
            <p><span className="font-medium">How to fix:</span> {issue.howToFix}</p>
          ) : null}
        </div>
      ) : issue.help && issue.help !== issueHeading(issue) ? (
        <p className="mt-2">{issue.help}</p>
      ) : null}

      {issue.exampleHtml ? (
        <details className="mt-3">
          <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            Example HTML{issue.examplePageUrl ? ` on ${new URL(issue.examplePageUrl).pathname}` : ""}
          </summary>
          {/* Rendered as text by React: page HTML is untrusted and never injected. */}
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
            <code>{issue.exampleHtml}</code>
          </pre>
          {issue.exampleSelector ? (
            <p className="mt-1 break-all text-xs text-muted-foreground">Selector: <code>{issue.exampleSelector}</code></p>
          ) : null}
        </details>
      ) : null}

      {issue.helpUrl ? (
        <p className="mt-3 text-sm">
          <a href={issue.helpUrl} className="underline" target="_blank" rel="noreferrer noopener">
            Learn more about {issue.ruleId}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : null}
    </section>
  );
}
