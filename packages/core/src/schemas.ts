import { z } from "zod";

// Mirrors the CHECK constraint on scans.status in supabase/migrations.
export const ScanStatus = z.enum([
  "queued",
  "crawling",
  "scanning",
  "analyzing",
  "fixing",
  "done",
  "failed",
]);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const TERMINAL_STATUSES: readonly ScanStatus[] = ["done", "failed"];

export const ScanProgress = z.object({
  pagesFound: z.number().int().nonnegative().optional(),
  pagesScanned: z.number().int().nonnegative().optional(),
  issuesFound: z.number().int().nonnegative().optional(),
  fixesVerified: z.number().int().nonnegative().optional(),
});
export type ScanProgress = z.infer<typeof ScanProgress>;

export const ScanOptions = z.object({
  maxPages: z.number().int().min(1).max(10).optional(),
  includeFixes: z.boolean().optional(),
});
export type ScanOptions = z.infer<typeof ScanOptions>;

// The shape of a scans row as returned by claim_next_scan() over PostgREST.
export const ScanRow = z.object({
  id: z.uuid(),
  url: z.string(),
  normalized_url: z.string(),
  status: ScanStatus,
  progress: ScanProgress,
  options: ScanOptions,
  requester_ip_hash: z.string().nullable(),
  claimed_at: z.string().nullable(),
  attempts: z.number().int(),
  error: z.string().nullable(),
  llm_calls: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type ScanRow = z.infer<typeof ScanRow>;

export * from "./report-schema.js";
