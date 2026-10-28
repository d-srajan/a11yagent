import { createLogger } from "@a11yagent/core";
import { checkUrl } from "@a11yagent/core/net";
import { NextResponse } from "next/server";
import { createScan, MAINTENANCE } from "@/lib/server/createScan";
import { scansEnabled, webEnv } from "@/lib/server/env";
import { clientIp, hashIp } from "@/lib/server/ip";
import { db } from "@/lib/server/supabase";
import { verifyTurnstile } from "@/lib/server/turnstile";

// DNS lookups for the SSRF pre-check need Node, not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger({ base: { service: "web", route: "POST /api/scans" } });

export async function POST(request: Request): Promise<NextResponse> {
  // Answered before reading config, so the kill switch works even when the
  // rest of the environment is broken.
  if (!scansEnabled()) return NextResponse.json({ code: MAINTENANCE.code, message: MAINTENANCE.message }, { status: MAINTENANCE.status });

  const body: unknown = await request.json().catch(() => null);
  const env = webEnv();
  const ip = clientIp(request.headers);

  try {
    const result = await createScan(body, {
      scansEnabled: true,
      perIpLimit: env.SCANS_PER_IP_PER_DAY,
      ipHash: hashIp(ip, env.IP_HASH_SALT),
      verifyTurnstile: (token) => verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip),
      // No allowLocal here, ever: the public API only accepts public sites.
      checkUrl: async (url) => (await checkUrl(url)).url,
      async findRecentScan(normalizedUrl, since) {
        const { data, error } = await db()
          .from("scans")
          .select("id")
          .eq("normalized_url", normalizedUrl)
          .neq("status", "failed")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw new Error(`cache lookup failed: ${error.message}`);
        return data[0]?.id ?? null;
      },
      async countScansByIp(ipHash, since) {
        const { count, error } = await db()
          .from("scans")
          .select("id", { count: "exact", head: true })
          .eq("requester_ip_hash", ipHash)
          .gte("created_at", since.toISOString());
        if (error) throw new Error(`rate limit count failed: ${error.message}`);
        return count ?? 0;
      },
      async insertScan(row) {
        const { data, error } = await db().from("scans").insert(row).select("id").single();
        if (error) throw new Error(`insert scan failed: ${error.message}`);
        return data.id as string;
      },
    });

    if (result.kind === "rejected") {
      return NextResponse.json({ code: result.code, message: result.message }, { status: result.status });
    }
    log.info("scan accepted", { scanId: result.id, cached: result.kind === "cached" });
    return NextResponse.json({ id: result.id, cached: result.kind === "cached" }, { status: result.kind === "created" ? 201 : 200 });
  } catch (err) {
    log.error("create scan failed", { err });
    return NextResponse.json({ code: "server_error", message: "Something went wrong on our side. Please try again." }, { status: 500 });
  }
}
