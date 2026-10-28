import type { PageView } from "@/lib/scan-view";

export function PagesList({ pages }: { pages: PageView[] }) {
  return (
    <section aria-labelledby="pages-heading" className="mt-10">
      <h2 id="pages-heading" className="text-2xl font-semibold">Pages checked</h2>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {pages.map((page) => (
          <li key={page.url} className="min-w-0 overflow-hidden rounded-lg border">
            {page.screenshotUrl ? (
              <a href={page.screenshotUrl} target="_blank" rel="noreferrer noopener" className="block focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                {/* Signed Storage URLs expire, so next/image's optimizer cache would only get in the way. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.screenshotUrl}
                  alt={`Screenshot of ${page.title || page.url}`}
                  className="h-40 w-full border-b object-cover object-top"
                  loading="lazy"
                />
                <span className="sr-only"> (full screenshot opens in a new tab)</span>
              </a>
            ) : null}
            <div className="p-3 text-sm">
              <p className="font-medium">{page.title || "Untitled page"}</p>
              <p className="break-all text-muted-foreground">{page.url}</p>
              <p className="mt-1">
                {page.findingCount} finding{page.findingCount === 1 ? "" : "s"} · {page.needsReview} need review
                {page.httpStatus && page.httpStatus >= 400 ? ` · HTTP ${page.httpStatus}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
