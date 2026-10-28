import type { z } from "zod";

// Validates environment variables once at startup so a missing or malformed
// value fails loudly with every problem listed, instead of surfacing later as
// an undefined deep inside a request.
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}

// Env values are strings; "false", "0" and "" must not become true.
export function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

// Loads a .env file without overriding variables already set in the shell,
// so `DAILY_LLM_CALL_CAP=0 pnpm scan ...` beats the file. Returns false when
// the file doesn't exist.
export function loadEnvFileUnderShell(file: string): boolean {
  const shell = { ...process.env };
  try {
    process.loadEnvFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  Object.assign(process.env, shell);
  return true;
}
