import { ScanRow } from "@a11yagent/core";
import { z } from "zod";
import type { ScanView } from "../scan-view";
import { buildReport } from "./buildReport";
import { FindingRow, IssueRow, PageRow, StepRow } from "./rows";
import { db } from "./supabase";

const SCREENSHOT_BUCKET = "screenshots";
// Long enough to read a report, short enough that a leaked link soon dies.
const SIGNED_URL_SECONDS = 60 * 60;
const ACTIVE = ["crawling", "scanning", "analyzing", "fixing"];

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data as T;
}

// Concurrency is 1, so a queued scan waits for every older queued scan plus
// whatever is running now.
async function countAhead(createdAt: string): Promise<number> {
  const [older, running] = await Promise.all([
    db().from("scans").select("id", { count: "exact", head: true }).eq("status", "queued").lt("created_at", createdAt),
    db().from("scans").select("id", { count: "exact", head: true }).in("status", ACTIVE),
  ]);
  if (older.error || running.error) throw new Error("queue position query failed");
  return (older.count ?? 0) + (running.count ?? 0);
}

async function signScreenshots(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await db().storage.from(SCREENSHOT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  // A missing thumbnail is not worth failing the whole report over.
  if (error || !data) return new Map();
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
}

export async function loadScan(id: string): Promise<ScanView | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { data, error } = await db().from("scans").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`load scan failed: ${error.message}`);
  if (!data) return null;
  const scan = ScanRow.parse(data);

  const view: ScanView = {
    id: scan.id,
    url: scan.url,
    status: scan.status,
    progress: scan.progress,
    error: scan.error,
    createdAt: scan.created_at,
    finishedAt: scan.finished_at,
    queueAhead: scan.status === "queued" ? await countAhead(scan.created_at) : null,
    report: null,
  };
  if (scan.status !== "done") return view;

  const [pages, findings, issues, steps] = await Promise.all([
    db().from("pages").select("id,url,title,http_status,screenshot_path,created_at,needs_review:axe_raw->incompleteByRule").eq("scan_id", id).order("created_at"),
    db().from("findings").select("id,page_id,selector,html_snippet,message,data").eq("scan_id", id),
    db().from("issues").select("id,rule_id,impact,severity_score,rank,occurrence_count,page_count,finding_ids,title,explanation,who_is_affected,how_to_fix").eq("scan_id", id).order("rank"),
    db().from("agent_steps").select("id,agent,step,kind,name,input,output,provider,model,tokens_in,tokens_out,latency_ms,error").eq("scan_id", id).order("id"),
  ]);
  const pageRows = z.array(PageRow).parse(must(pages, "load pages"));

  view.report = buildReport({
    scan,
    pages: pageRows,
    findings: z.array(FindingRow).parse(must(findings, "load findings")),
    issues: z.array(IssueRow).parse(must(issues, "load issues")),
    steps: z.array(StepRow).parse(must(steps, "load agent_steps")),
    screenshotUrls: await signScreenshots(pageRows.flatMap((p) => (p.screenshot_path ? [p.screenshot_path] : []))),
  });
  return view;
}
