import { envBoolean, parseEnv } from "@a11yagent/core";
import { z } from "zod";

export const WorkerEnv = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    ALLOW_LOCAL_TARGETS: z
      .string()
      .optional()
      .transform((value) => envBoolean(value, false)),
  })
  // The SSRF guard's one escape hatch must never be open in production: a
  // leftover dev setting would let strangers scan the worker's own machine.
  .refine((env) => !(env.NODE_ENV === "production" && env.ALLOW_LOCAL_TARGETS), {
    message: "ALLOW_LOCAL_TARGETS must not be set when NODE_ENV=production",
    path: ["ALLOW_LOCAL_TARGETS"],
  });
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadEnv(): WorkerEnv {
  return parseEnv(WorkerEnv);
}
