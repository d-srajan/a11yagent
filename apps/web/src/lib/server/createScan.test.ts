import { describe, expect, it, vi } from "vitest";
import { createScan, withScheme, type CreateScanDeps } from "./createScan";

const NOW = new Date("2026-10-28T12:00:00Z");

function deps(overrides: Partial<CreateScanDeps> = {}): CreateScanDeps {
  return {
    scansEnabled: true,
    perIpLimit: 5,
    ipHash: "hash-1",
    verifyTurnstile: vi.fn(async () => true),
    checkUrl: vi.fn(async (url: string) => new URL(url)),
    findRecentScan: vi.fn(async () => null),
    countScansByIp: vi.fn(async () => 0),
    insertScan: vi.fn(async () => "new-id"),
    now: () => NOW,
    ...overrides,
  };
}

const body = { url: "https://Example.com/menu?x=1#top", turnstileToken: "tok" };

describe("createScan", () => {
  it("queues a valid scan with the normalized URL and IP hash", async () => {
    const d = deps();
    expect(await createScan(body, d)).toEqual({ kind: "created", id: "new-id" });
    expect(d.insertScan).toHaveBeenCalledWith({
      url: "https://example.com/menu?x=1#top",
      normalized_url: "https://example.com/menu",
      requester_ip_hash: "hash-1",
    });
  });

  it("returns the maintenance message before doing any other work", async () => {
    const d = deps({ scansEnabled: false });
    const result = await createScan(body, d);
    expect(result).toMatchObject({ kind: "rejected", status: 503, code: "maintenance" });
    expect(d.verifyTurnstile).not.toHaveBeenCalled();
  });

  it("rejects a failed Turnstile check before resolving the URL", async () => {
    const d = deps({ verifyTurnstile: vi.fn(async () => false) });
    expect(await createScan(body, d)).toMatchObject({ status: 403, code: "turnstile" });
    expect(d.checkUrl).not.toHaveBeenCalled();
  });

  it("rejects URLs the SSRF guard refuses, before the queue", async () => {
    const d = deps({ checkUrl: vi.fn(async () => Promise.reject(new Error("Refused: 10.0.0.1 is a private address."))) });
    expect(await createScan({ ...body, url: "http://10.0.0.1" }, d)).toMatchObject({ status: 400, code: "url_refused", message: expect.stringContaining("private") });
    expect(d.insertScan).not.toHaveBeenCalled();
  });

  it("returns a recent scan of the same URL instead of queueing, without spending quota", async () => {
    const d = deps({ findRecentScan: vi.fn(async () => "old-id"), countScansByIp: vi.fn(async () => 99) });
    expect(await createScan(body, d)).toEqual({ kind: "cached", id: "old-id" });
    expect(d.findRecentScan).toHaveBeenCalledWith("https://example.com/menu", new Date("2026-10-27T12:00:00Z"));
    expect(d.insertScan).not.toHaveBeenCalled();
  });

  it("blocks the 6th scan from one IP in 24 hours with a friendly message", async () => {
    const d = deps({ countScansByIp: vi.fn(async () => 5) });
    expect(await createScan(body, d)).toMatchObject({ status: 429, code: "rate_limited", message: expect.stringContaining("5 free scans") });
    expect(d.insertScan).not.toHaveBeenCalled();
  });

  it("allows the 5th scan", async () => {
    expect(await createScan(body, deps({ countScansByIp: vi.fn(async () => 4) }))).toMatchObject({ kind: "created" });
  });

  it("rejects a missing URL", async () => {
    expect(await createScan({ url: "  " }, deps())).toMatchObject({ status: 400, code: "invalid_body" });
  });
});

describe("withScheme", () => {
  it("adds https:// only when there is no scheme", () => {
    expect(withScheme("example.com")).toBe("https://example.com");
    expect(withScheme("http://example.com")).toBe("http://example.com");
    expect(withScheme("file:///etc/passwd")).toBe("file:///etc/passwd");
  });
});
