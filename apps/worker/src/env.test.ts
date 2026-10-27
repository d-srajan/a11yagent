import { parseEnv } from "@a11yagent/core";
import { describe, expect, it } from "vitest";
import { WorkerEnv } from "./env.js";

const base = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "placeholder-not-a-real-key" };

describe("WorkerEnv", () => {
  it("allows ALLOW_LOCAL_TARGETS outside production", () => {
    expect(parseEnv(WorkerEnv, { ...base, ALLOW_LOCAL_TARGETS: "true" }).ALLOW_LOCAL_TARGETS).toBe(true);
  });

  it("refuses to start with ALLOW_LOCAL_TARGETS in production", () => {
    expect(() => parseEnv(WorkerEnv, { ...base, NODE_ENV: "production", ALLOW_LOCAL_TARGETS: "true" })).toThrow(/ALLOW_LOCAL_TARGETS/);
    expect(parseEnv(WorkerEnv, { ...base, NODE_ENV: "production", ALLOW_LOCAL_TARGETS: "false" }).ALLOW_LOCAL_TARGETS).toBe(false);
  });
});
