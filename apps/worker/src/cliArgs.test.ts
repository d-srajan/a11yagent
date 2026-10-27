import { describe, expect, it } from "vitest";
import { CLI_DEFAULT_MAX_PAGES, parseCliArgs } from "./cliArgs.js";

describe("parseCliArgs", () => {
  it("parses a URL with defaults", () => {
    expect(parseCliArgs(["https://example.com"])).toEqual({
      ok: true,
      help: false,
      url: "https://example.com",
      allowLocal: false,
      out: "report.json",
      maxPages: CLI_DEFAULT_MAX_PAGES,
    });
  });

  it("parses every flag, and ignores a forwarded --", () => {
    expect(parseCliArgs(["--", "http://127.0.0.1:4173", "--allow-local", "--out", "r.json", "--max-pages", "3"])).toMatchObject({
      ok: true,
      allowLocal: true,
      out: "r.json",
      maxPages: 3,
    });
  });

  it("rejects missing URLs, bad page counts and unknown flags", () => {
    expect(parseCliArgs([]).ok).toBe(false);
    expect(parseCliArgs(["https://a.com", "--max-pages", "11"]).ok).toBe(false);
    expect(parseCliArgs(["https://a.com", "--nope"]).ok).toBe(false);
  });
});
