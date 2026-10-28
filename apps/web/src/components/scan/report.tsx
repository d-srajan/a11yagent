import type { Impact } from "@a11yagent/core";
import { DISCLAIMER } from "@/lib/report-markdown";
import type { ReportView, ScanView } from "@/lib/scan-view";
import { AgentTimeline } from "./agent-timeline";
import { CopyMarkdown } from "./copy-markdown";
import { IssueCard } from "./issue-card";
import { PagesList } from "./pages-list";

const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function Report({ scan, report }: { scan: ScanView; report: ReportView }) {
  const s = report.summary;
  const duration = formatDuration(s.durationMs);

  return (
    <article aria-labelledby="report-heading" className="mt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 id="report-heading" className="text-3xl font-bold tracking-tight">Accessibility report</h1>
          <p className="mt-2 break-words text-muted-foreground">
            {scan.url}
            {duration ? ` · finished in ${duration}` : ""}
          </p>
        </div>
        <CopyMarkdown scan={scan} />
      </div>

      <section aria-labelledby="summary-heading" className="mt-8">
        <h2 id="summary-heading" className="sr-only">Summary</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Issues to fix" value={s.issues} />
          <Stat label="Pages checked" value={s.pages} />
          <Stat label="Findings" value={s.findings} hint="before grouping duplicates" />
          <Stat label="Need human review" value={s.needsReview} />
        </dl>
        <p className="mt-3 text-sm">
          {IMPACTS.map((k) => `${s.issuesByImpact[k]} ${k}`).join(" · ")}
        </p>
        {!report.explanationsAvailable && s.issues > 0 ? (
          <p className="mt-3 rounded-md border p-3 text-sm">
            Plain-English explanations are unavailable for this scan (the AI budget was used up or the
            providers were down). Each issue shows the scanner&apos;s own description instead.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="issues-heading" className="mt-10">
        <h2 id="issues-heading" className="text-2xl font-semibold">Issues, most important first</h2>
        {report.issues.length === 0 ? (
          <p className="mt-4">No automatically detectable issues were found. A human review is still worthwhile.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {report.issues.map((issue) => (
              <li key={issue.id}>
                <IssueCard issue={issue} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {report.needsReviewByRule.length > 0 ? (
        <section aria-labelledby="review-heading" className="mt-10">
          <h2 id="review-heading" className="text-2xl font-semibold">Needs human review</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            axe-core could not decide these automatically (for example text over a background image). They
            are not counted as issues.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {report.needsReviewByRule.map((r) => (
              <li key={r.ruleId} className="rounded-md border px-2 py-1">
                <code>{r.ruleId}</code>: {r.count}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PagesList pages={report.pages} />
      <AgentTimeline steps={report.steps} summary={s} />

      <p className="mt-10 rounded-md border p-4 text-sm">{DISCLAIMER}</p>
    </article>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
