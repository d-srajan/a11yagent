import { ScanForm } from "@/components/scan-form";

const steps = [
  { title: "Scan", body: "axe-core and a keyboard walk check up to 10 pages of your site." },
  { title: "Rank", body: "Duplicate findings are grouped and ranked so you see what matters first." },
  { title: "Fix", body: "An agent writes fixes and proves each one in a real browser before showing it." },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 sm:px-6">
      <header className="py-6">
        <p className="text-lg font-semibold">a11yagent</p>
      </header>

      <main id="main" className="flex-1 py-12">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Find the five accessibility fixes that matter most.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Paste a URL. Get a plain-English report in under three minutes, with fixes verified in a
          real browser. Free, no account needed.
        </p>

        <ScanForm />

        <section aria-labelledby="how-heading" className="mt-16">
          <h2 id="how-heading" className="text-2xl font-semibold">
            How it works
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-lg border p-5">
                <h3 className="font-semibold">
                  {i + 1}. {step.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t py-6 text-sm text-muted-foreground">
        <p>Scan sites you own or manage.</p>
        <p className="mt-1">
          Automated testing catches only part of WCAG issues and cannot certify WCAG or ADA
          compliance. A human review is still needed.
        </p>
      </footer>
    </div>
  );
}
