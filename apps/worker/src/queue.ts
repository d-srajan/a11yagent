import { ScanRow, type ScanProgress, type ScanStatus } from "@a11yagent/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// The worker's only view of the queue. Keeping it behind an interface lets the
// poller be tested without a database.
export interface ScanQueue {
  claimNext(): Promise<ScanRow | null>;
  markDone(scanId: string): Promise<void>;
  markFailed(scanId: string, error: string): Promise<void>;
  setStatus(scanId: string, status: ScanStatus, progress?: ScanProgress): Promise<void>;
  // Hands an interrupted scan back: requeued if it has attempts left, failed otherwise.
  release(scan: ScanRow): Promise<"requeued" | "failed">;
}

// Must match the "attempts < 2" in claim_next_scan() (supabase/migrations).
export const MAX_ATTEMPTS = 2;
const ACTIVE_STATUSES = ["crawling", "scanning", "analyzing", "fixing"];

export function createSupabaseClient(url: string, serviceRoleKey: string): SupabaseClient {
  // Server-side service-role client: no browser session to persist or refresh.
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseQueue(db: SupabaseClient): ScanQueue {
  return {
    async claimNext() {
      const { data, error } = await db.rpc("claim_next_scan");
      if (error) throw new Error(`claim_next_scan failed: ${error.message}`);
      // The function returns setof scans: [] when the queue is empty.
      const rows = z.array(ScanRow).parse(data);
      return rows[0] ?? null;
    },

    async markDone(scanId) {
      const { error } = await db
        .from("scans")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", scanId);
      if (error) throw new Error(`markDone failed: ${error.message}`);
    },

    async markFailed(scanId, message) {
      const { error } = await db
        .from("scans")
        .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
        .eq("id", scanId);
      if (error) throw new Error(`markFailed failed: ${error.message}`);
    },

    async setStatus(scanId, status, progress) {
      const { error } = await db
        .from("scans")
        .update({ status, ...(progress ? { progress } : {}) })
        .eq("id", scanId);
      if (error) throw new Error(`setStatus failed: ${error.message}`);
    },

    // Only touches a scan that is still running, so it can never undo a
    // "done" written a moment earlier.
    async release(scan) {
      const outOfAttempts = scan.attempts >= MAX_ATTEMPTS;
      const update = outOfAttempts
        ? { status: "failed", error: `Our scanner restarted while working on this scan (attempt ${scan.attempts} of ${MAX_ATTEMPTS}). Please submit it again.`, finished_at: new Date().toISOString() }
        : { status: "queued", claimed_at: null };
      const { error } = await db.from("scans").update(update).eq("id", scan.id).in("status", ACTIVE_STATUSES);
      if (error) throw new Error(`release failed: ${error.message}`);
      return outOfAttempts ? "failed" : "requeued";
    },
  };
}
