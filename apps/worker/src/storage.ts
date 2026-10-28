import type { SupabaseClient } from "@supabase/supabase-js";

export const SCREENSHOT_BUCKET = "screenshots";

// The bucket is private (SPEC: Storage): the web API hands out short-lived
// signed URLs. Creating it here instead of in a migration means a fresh
// Supabase project works without a manual step.
export async function ensureScreenshotBucket(db: SupabaseClient): Promise<void> {
  const { data } = await db.storage.getBucket(SCREENSHOT_BUCKET);
  if (data) return;
  const { error } = await db.storage.createBucket(SCREENSHOT_BUCKET, { public: false, allowedMimeTypes: ["image/jpeg"] });
  if (error && !/already exists/i.test(error.message)) throw new Error(`create screenshots bucket failed: ${error.message}`);
}

export function screenshotPath(scanId: string, index: number, url: string): string {
  const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "home";
  return `${scanId}/${String(index).padStart(2, "0")}-${slug}.jpg`;
}

// upsert: a retried attempt overwrites the first attempt's files at the same paths.
export async function uploadScreenshot(db: SupabaseClient, path: string, jpeg: Buffer): Promise<void> {
  const { error } = await db.storage.from(SCREENSHOT_BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload screenshot failed: ${error.message}`);
}
