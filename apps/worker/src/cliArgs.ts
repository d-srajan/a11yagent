import { parseArgs } from "node:util";

export const usage = `Usage: pnpm scan <url> [--allow-local] [--out report.json] [--max-pages n]

  --allow-local   Allow http://127.0.0.1 on any port (fixtures and local dev only)
  --out <file>    Where to write the JSON report (default: report.json)
  --max-pages <n> Pages to scan, 1-10 (default: 10 for the CLI)`;

// The CLI is a local tool, so it scans up to the hard cap by default; the
// public service uses MAX_PAGES_PER_SCAN (5). See DECISIONS.md.
export const CLI_DEFAULT_MAX_PAGES = 10;

export type CliArgs =
  | { ok: true; help: true }
  | { ok: true; help: false; url: string; allowLocal: boolean; out: string; maxPages: number }
  | { ok: false; error: string };

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      // pnpm forwards a literal "--" when users type `pnpm scan -- <url>`;
      // parseArgs would treat every flag after it as a positional.
      args: argv[0] === "--" ? argv.slice(1) : argv,
      allowPositionals: true,
      options: {
        "allow-local": { type: "boolean", default: false },
        out: { type: "string", default: "report.json" },
        "max-pages": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const { values, positionals } = parsed;
  if (values.help) return { ok: true, help: true };
  const [url, ...extra] = positionals;
  if (!url || extra.length > 0) return { ok: false, error: "Expected exactly one URL." };

  const maxPages = values["max-pages"] === undefined ? CLI_DEFAULT_MAX_PAGES : Number(values["max-pages"]);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
    return { ok: false, error: "--max-pages must be a whole number from 1 to 10." };
  }
  return { ok: true, help: false, url, allowLocal: values["allow-local"], out: values.out, maxPages };
}
