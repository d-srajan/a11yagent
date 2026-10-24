import { ScanRow } from "@a11yagent/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// The worker's only view of the queue. Keeping it behind an interface lets the
// poller be tested without a database.
export interface ScanQueue {
  claimNext(): Promise<ScanRow | null>;
  markDone(scanId: string): Promise<void>;
  markFailed(scanId: string, error: string): Promise<void>;
}

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
  };
}
