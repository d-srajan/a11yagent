import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger, envBoolean } from "@a11yagent/core";
import { SsrfError } from "@a11yagent/core/net";
import { scanSite } from "@a11yagent/core/scanner";
import { parseCliArgs, usage } from "./cliArgs.js";
import { formatSummary } from "./cliSummary.js";

// pnpm scan <url> [--allow-local] [--out report.json] [--max-pages n]
// Runs the exact pipeline the worker will run, minus the database.

const out = (text: string): void => void process.stdout.write(text + "\n");
const fail = (text: string, code: number): never => {
  process.stderr.write(text + "\n");
  process.exit(code);
};

const args = parseCliArgs(process.argv.slice(2));
if (!args.ok) fail(`${args.error}\n\n${usage}`, 64);
if (args.ok && args.help) {
  out(usage);
  process.exit(0);
}
if (!args.ok || args.help) process.exit(64); // narrows the type; unreachable

const allowLocal = args.allowLocal || envBoolean(process.env.ALLOW_LOCAL_TARGETS, false);
if (allowLocal && process.env.NODE_ENV === "production") {
  fail("Refused: --allow-local / ALLOW_LOCAL_TARGETS cannot be used when NODE_ENV=production.", 2);
}

const log = createLogger({
  level: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
  base: { service: "scan-cli" },
  write: (line) => void process.stderr.write(line + "\n"), // stdout stays for the summary
});

const outPath = path.resolve(args.out);
const shotDir = outPath.replace(/\.json$/i, "") + "-screenshots";

try {
  const report = await scanSite(args.url, {
    allowLocal,
    maxPages: args.maxPages,
    log,
    saveScreenshot: async ({ index, url }, jpeg) => {
      await mkdir(shotDir, { recursive: true });
      const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
      const file = path.join(shotDir, `${String(index).padStart(2, "0")}-${slug}.jpg`);
      await writeFile(file, jpeg);
      return path.relative(path.dirname(outPath), file);
    },
  });
  await writeFile(outPath, JSON.stringify(report, null, 2) + "\n");
  out(formatSummary(report));
  out(`\nReport written to ${outPath}`);
} catch (err) {
  if (err instanceof SsrfError) {
    const loopback = /loopback/.test(err.message) || (err.reason === "port" && /127\.0\.0\.1/.test(err.url));
    const hint = loopback && !allowLocal ? "\nScanning your own machine for development? Use http://127.0.0.1:<port> with --allow-local." : "";
    fail(err.message + hint, 2);
  }
  fail(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, 1);
}
