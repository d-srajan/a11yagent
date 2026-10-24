import { parseEnv } from "@a11yagent/core";
import { z } from "zod";

const WorkerEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadEnv(): WorkerEnv {
  return parseEnv(WorkerEnv);
}
