import type { ReportView, StepView } from "@/lib/scan-view";

const AGENT_LABEL: Record<string, string> = {
  explainer: "Explainer",
  alt_reviewer: "Alt-text reviewer",
  fixer: "Fixer",
};

// "How the agent worked": every agent_steps row, in order. Showing failed
// attempts too is deliberate: a 429 followed by a fallback provider is part
// of the honest story of how the report was made.
export function AgentTimeline({ steps, summary }: { steps: StepView[]; summary: ReportView["summary"] }) {
  return (
    <section aria-labelledby="timeline-heading" className="mt-10">
      <h2 id="timeline-heading" className="text-2xl font-semibold">How the agent worked</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The scan itself is plain code (axe-core and a keyboard walk). AI was used only for the steps
        below: {summary.llmCalls} model call{summary.llmCalls === 1 ? "" : "s"}, {summary.tokensIn.toLocaleString("en")} tokens in,{" "}
        {summary.tokensOut.toLocaleString("en")} tokens out.
      </p>
      {steps.length === 0 ? (
        <p className="mt-4">No AI steps ran for this scan.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {steps.map((step) => (
            <li key={step.id} className="min-w-0 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">
                  {AGENT_LABEL[step.agent] ?? step.agent} · step {step.step}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase">{step.kind === "llm" ? "model call" : "tool"}</span>
                <code className="break-all">{step.name}</code>
              </div>
              <p className="mt-1 break-words text-muted-foreground">
                {[step.provider && step.model ? `${step.provider} / ${step.model}` : step.model, step.latencyMs !== null ? `${step.latencyMs.toLocaleString("en")} ms` : null, step.tokensOut !== null ? `${step.tokensIn ?? 0} → ${step.tokensOut} tokens` : null]
                  .filter(Boolean)
                  .join(" · ") || "no model"}
              </p>
              {step.inputSummary ? <p className="mt-1 break-words"><span className="font-medium">In:</span> {step.inputSummary}</p> : null}
              {step.outputSummary ? <p className="mt-1 break-words"><span className="font-medium">Out:</span> {step.outputSummary}</p> : null}
              {step.error ? <p className="mt-1 break-words"><span className="font-medium">Error:</span> {step.error}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
