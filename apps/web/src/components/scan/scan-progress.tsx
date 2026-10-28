import type { ScanStatus } from "@a11yagent/core";
import type { ScanView } from "@/lib/scan-view";

const STAGES: { status: ScanStatus[]; label: string }[] = [
  { status: ["queued"], label: "Waiting in the queue" },
  { status: ["crawling"], label: "Opening the site and finding pages" },
  { status: ["scanning"], label: "Checking each page (axe-core and a keyboard walk)" },
  { status: ["analyzing", "fixing"], label: "Reviewing alt text and writing explanations with AI" },
];

function stageIndex(status: ScanStatus): number {
  return STAGES.findIndex((s) => s.status.includes(status));
}

// What the user sees while the worker runs. The status line is a polite live
// region, so screen-reader users hear each stage change without having to
// hunt for it.
export function ScanProgressPanel({ scan, stale }: { scan: ScanView; stale: boolean }) {
  const current = stageIndex(scan.status);
  const { pagesFound, pagesScanned } = scan.progress;
  const pageText = pagesFound ? `${pagesScanned ?? 0} of ${pagesFound} pages checked` : null;
  const queueText =
    scan.queueAhead === null ? null : scan.queueAhead === 0 ? "You're next." : `${scan.queueAhead} scan${scan.queueAhead === 1 ? "" : "s"} ahead of yours.`;

  return (
    <section aria-labelledby="progress-heading" className="mt-6">
      <h1 id="progress-heading" className="text-3xl font-bold tracking-tight">Scanning your site</h1>
      <p className="mt-2 break-words text-muted-foreground">{scan.url}</p>

      <p className="mt-6 font-medium" role="status" aria-live="polite">
        {STAGES[current]?.label ?? "Working"}…{pageText ? ` ${pageText}.` : ""} {queueText}
      </p>

      {pagesFound ? (
        <progress
          className="mt-3 h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
          max={pagesFound}
          value={pagesScanned ?? 0}
          aria-label="Pages checked"
        />
      ) : null}

      <ol className="mt-6 space-y-3">
        {STAGES.map((stage, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={stage.label} className="flex items-start gap-3" aria-current={state === "current" ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={
                  "mt-1 inline-block size-3 shrink-0 rounded-full border-2 " +
                  (state === "done" ? "border-primary bg-primary" : state === "current" ? "animate-pulse border-primary" : "border-input")
                }
              />
              <span className={state === "todo" ? "text-muted-foreground" : ""}>
                {stage.label}
                <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-sm text-muted-foreground">
        Most scans finish in under 3 minutes. You can leave this page open; it updates by itself, and
        this link will show the report when it&apos;s ready.
      </p>
      {stale ? <p className="mt-2 text-sm">Having trouble reaching the server; still retrying.</p> : null}
    </section>
  );
}
