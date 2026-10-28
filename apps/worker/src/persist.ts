import type { ScanReport } from "@a11yagent/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportToRows } from "./reportRows.js";

// Findings arrive in the hundreds on big pages; chunking keeps each request
// well under PostgREST's body limits.
const CHUNK = 500;

async function insertAll(db: SupabaseClient, table: string, rows: Record<string, unknown>[], chunk = CHUNK): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`insert ${table} failed: ${error.message}`);
  }
}

// A retried attempt starts from nothing: whatever an interrupted attempt
// wrote would otherwise show up twice in the report. Deleting pages cascades
// to findings; issues cascade to fixes; agent_steps go too.
export async function clearScanResults(db: SupabaseClient, scanId: string): Promise<void> {
  for (const table of ["agent_steps", "issues", "pages"]) {
    const { error } = await db.from(table).delete().eq("scan_id", scanId);
    if (error) throw new Error(`clear ${table} failed: ${error.message}`);
  }
}

// Parents before children so every foreign key already exists.
export async function writeReport(db: SupabaseClient, scanId: string, report: ScanReport): Promise<void> {
  const rows = reportToRows(scanId, report);
  // One page per request: axe_raw can be a few hundred KB on a busy page.
  await insertAll(db, "pages", rows.pages, 1);
  await insertAll(db, "findings", rows.findings);
  await insertAll(db, "issues", rows.issues);
  await insertAll(db, "agent_steps", rows.steps);

  const usage = report.llm?.usage;
  const { error } = await db
    .from("scans")
    .update({
      llm_calls: usage?.calls ?? 0,
      tokens_in: usage?.tokensIn ?? 0,
      tokens_out: usage?.tokensOut ?? 0,
      progress: { pagesFound: report.pages.length, pagesScanned: report.pages.length, issuesFound: report.issues.length, fixesVerified: 0 },
    })
    .eq("id", scanId);
  if (error) throw new Error(`update scan totals failed: ${error.message}`);
}
