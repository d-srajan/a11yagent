import { describe, expect, it } from "vitest";
import { z } from "zod";
import { envBoolean, parseEnv } from "./env.js";
import { createLogger, type LogLevel } from "./logger.js";
import { ScanStatus } from "./schemas.js";

describe("createLogger", () => {
  it("writes one JSON line per entry and respects the level threshold", () => {
    const lines: { line: string; level: LogLevel }[] = [];
    const log = createLogger({ level: "info", write: (line, level) => lines.push({ line, level }) });

    log.debug("hidden");
    log.info("poll", { claimed: false });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]?.line ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "info", msg: "poll", claimed: false });
  });

  it("serializes errors and merges child fields", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) }).child({ scanId: "abc" });

    log.error("failed", { err: new Error("boom") });

    const entry = JSON.parse(lines[0] ?? "{}") as { scanId: string; err: { message: string } };
    expect(entry.scanId).toBe("abc");
    expect(entry.err.message).toBe("boom");
  });
});

describe("parseEnv", () => {
  const schema = z.object({ SUPABASE_URL: z.url() });

  it("returns parsed values", () => {
    expect(parseEnv(schema, { SUPABASE_URL: "https://x.supabase.co" }).SUPABASE_URL).toBe(
      "https://x.supabase.co",
    );
  });

  it("lists every invalid variable", () => {
    expect(() => parseEnv(schema, {})).toThrow(/SUPABASE_URL/);
  });
});

describe("envBoolean", () => {
  it("treats only explicit truthy strings as true", () => {
    expect(envBoolean("true", false)).toBe(true);
    expect(envBoolean("false", true)).toBe(false);
    expect(envBoolean("0", true)).toBe(false);
    expect(envBoolean(undefined, true)).toBe(true);
  });
});

describe("ScanStatus", () => {
  it("rejects statuses the database would reject", () => {
    expect(ScanStatus.safeParse("done").success).toBe(true);
    expect(ScanStatus.safeParse("running").success).toBe(false);
  });
});
