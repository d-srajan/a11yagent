import { readFile } from "node:fs/promises";
import { AltVerdict } from "@a11yagent/core";
import { z } from "zod";

// Field names follow the spec's ground_truth.json format (snake_case), so the
// file reads the same as the table in SPEC.md.
export const GroundTruthEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  // Page file name relative to the site root, e.g. "index.html".
  page: z.string().regex(/^[a-z0-9/-]+\.html$/),
  selector: z.string().min(1),
  expected_rule: z.string().min(1),
  fixable: z.boolean(),
  notes: z.string(),
});
export type GroundTruthEntry = z.infer<typeof GroundTruthEntry>;

// Planted alt texts with the verdicts a good reviewer may give. Includes
// good alts, which the deterministic filter never nominates: the eval sends
// those to the reviewer directly, to check it leaves good alt text alone.
export const AltCase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  page: z.string().regex(/^[a-z0-9/-]+\.html$/),
  selector: z.string().min(1),
  accept: z.array(AltVerdict).min(1),
  notes: z.string(),
});
export type AltCase = z.infer<typeof AltCase>;

export const GroundTruth = z
  .object({
    version: z.literal(1),
    // Clean pages: anything reported there is a false positive.
    control_pages: z.array(z.string()).min(1),
    issues: z.array(GroundTruthEntry).min(1),
    alt_cases: z.array(AltCase).default([]),
  })
  .superRefine((gt, ctx) => {
    const seen = new Set<string>();
    for (const issue of gt.issues) {
      if (seen.has(issue.id)) ctx.addIssue({ code: "custom", message: `duplicate id ${issue.id}` });
      seen.add(issue.id);
      if (gt.control_pages.includes(issue.page)) {
        ctx.addIssue({ code: "custom", message: `${issue.id} is planted on control page ${issue.page}` });
      }
    }
  });
export type GroundTruth = z.infer<typeof GroundTruth>;

export async function loadGroundTruth(file: string): Promise<GroundTruth> {
  return GroundTruth.parse(JSON.parse(await readFile(file, "utf8")));
}
