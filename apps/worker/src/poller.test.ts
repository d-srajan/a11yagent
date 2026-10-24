import { createLogger, type ScanRow } from "@a11yagent/core";
import { describe, expect, it, vi } from "vitest";
import { pollOnce } from "./poller.js";
import type { ScanQueue } from "./queue.js";

const silent = createLogger({ write: () => {} });

const scan: ScanRow = {
  id: "8f8b6c1e-6b8e-4c43-9d1a-2f4b7e7f1a10",
  url: "https://example.com",
  normalized_url: "https://example.com/",
  status: "crawling",
  progress: {},
  options: {},
  requester_ip_hash: null,
  claimed_at: "2026-10-23T00:00:00Z",
  attempts: 1,
  error: null,
  llm_calls: 0,
  tokens_in: 0,
  tokens_out: 0,
  created_at: "2026-10-23T00:00:00Z",
  finished_at: null,
};

function fakeQueue(next: ScanRow | null): ScanQueue {
  return {
    claimNext: vi.fn(async () => next),
    markDone: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
  };
}

describe("pollOnce", () => {
  it("is idle when the queue is empty", async () => {
    const queue = fakeQueue(null);
    expect(await pollOnce(queue, async () => {}, silent)).toBe("idle");
    expect(queue.markDone).not.toHaveBeenCalled();
  });

  it("marks a claimed scan done after processing", async () => {
    const queue = fakeQueue(scan);
    expect(await pollOnce(queue, async () => {}, silent)).toBe("processed");
    expect(queue.markDone).toHaveBeenCalledWith(scan.id);
  });

  it("marks the scan failed when processing throws", async () => {
    const queue = fakeQueue(scan);
    const outcome = await pollOnce(queue, async () => Promise.reject(new Error("boom")), silent);
    expect(outcome).toBe("failed");
    expect(queue.markFailed).toHaveBeenCalledWith(scan.id, "boom");
  });

  it("survives a claim error instead of crashing the loop", async () => {
    const queue = fakeQueue(null);
    vi.mocked(queue.claimNext).mockRejectedValueOnce(new Error("db down"));
    expect(await pollOnce(queue, async () => {}, silent)).toBe("error");
  });
});
