import { createLogger } from "@a11yagent/core";
import { NextResponse } from "next/server";
import { loadScan } from "@/lib/server/loadScan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ base: { service: "web", route: "GET /api/scans/:id" } });

// Polled every 2 s by the progress page. Anyone with the (unguessable) id can
// read the report; there is nothing else to authorize.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const scan = await loadScan(id);
    if (!scan) return NextResponse.json({ code: "not_found", message: "No scan with that id. Reports are deleted after 30 days." }, { status: 404 });
    return NextResponse.json(scan, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error("load scan failed", { scanId: id, err });
    return NextResponse.json({ code: "server_error", message: "Could not load this scan. Please refresh." }, { status: 500 });
  }
}
