import Link from "next/link";
import { DISCLAIMER } from "@/lib/report-markdown";

export function SiteHeader() {
  return (
    <header className="py-6">
      <Link href="/" className="rounded-sm text-lg font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        a11yagent
      </Link>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t py-6 text-sm text-muted-foreground">
      <p>Scan sites you own or manage.</p>
      <p className="mt-1">{DISCLAIMER}</p>
    </footer>
  );
}
