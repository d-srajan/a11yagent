import { describe, expect, it } from "vitest";
import { collectEvidence, pageKey, type Evidence } from "./evidence.js";
import type { GroundTruthEntry } from "./groundTruth.js";
import { matchGroundTruth, type ResolvedElements, type Resolver } from "./match.js";
import { computeMetrics } from "./metrics.js";

// A fake DOM per page: selector -> element ids, plus a parent map.
function fakeResolver(pages: Record<string, { selectors: Record<string, number[]>; parent: Record<number, number> }>): Resolver {
  return (page, selector) => {
    const dom = pages[page];
    const self = dom?.selectors[selector];
    if (!dom || !self) return undefined;
    const lineage = new Set<number>();
    for (const id of self) {
      for (let n: number | undefined = id; n !== undefined; n = dom.parent[n]) lineage.add(n);
    }
    return { self, lineage: [...lineage] } satisfies ResolvedElements;
  };
}

const entry = (over: Partial<GroundTruthEntry>): GroundTruthEntry => ({
  id: "x",
  page: "index.html",
  selector: "button.cart",
  expected_rule: "button-name",
  fixable: true,
  notes: "",
  ...over,
});
const ev = (over: Partial<Evidence>): Evidence => ({ kind: "finding", page: "index.html", ruleId: "button-name", selector: "button", ref: "f1", ...over });

// html(0) > body(1) > button.cart(2), dialog(3) > input(4); accessible.html has a button(10).
const resolve = fakeResolver({
  "index.html": {
    selectors: { "button.cart": [2], button: [2], html: [0], ".help-dialog": [3], "#help-question": [4], "#nope": [] },
    parent: { 1: 0, 2: 1, 3: 1, 4: 3 },
  },
  "accessible.html": { selectors: { button: [10] }, parent: {} },
});

describe("matchGroundTruth", () => {
  it("matches different selector strings that hit the same element", () => {
    const r = matchGroundTruth([entry({})], [ev({})], resolve, []);
    expect(r.entries[0]?.evidence?.ref).toBe("f1");
  });

  it("requires the same rule and the same page", () => {
    const r = matchGroundTruth([entry({})], [ev({ ruleId: "link-name" }), ev({ page: "menu.html" })], resolve, []);
    expect(r.entries[0]?.evidence).toBeNull();
    expect(r.unmatched).toHaveLength(2);
  });

  it("accepts evidence inside the planted element but not on an ancestor", () => {
    const trap = entry({ selector: ".help-dialog", expected_rule: "a11y-keyboard-trap" });
    const inside = matchGroundTruth([trap], [ev({ ruleId: "a11y-keyboard-trap", selector: "#help-question" })], resolve, []);
    expect(inside.entries[0]?.evidence).not.toBeNull();
    const ancestor = matchGroundTruth([entry({})], [ev({ selector: "html" })], resolve, []);
    expect(ancestor.entries[0]?.evidence).toBeNull();
  });

  it("never matches selectors that resolve to nothing", () => {
    const r = matchGroundTruth([entry({ selector: "#nope" })], [ev({ selector: "#nope" })], resolve, []);
    expect(r.entries[0]?.evidence).toBeNull();
  });

  it("uses each piece of evidence for at most one planted issue", () => {
    const r = matchGroundTruth([entry({ id: "a" }), entry({ id: "b" })], [ev({})], resolve, []);
    expect(r.entries.filter((e) => e.evidence)).toHaveLength(1);
  });

  it("prefers a real finding over weaker evidence", () => {
    const r = matchGroundTruth([entry({})], [ev({ kind: "needs_review", ref: "n" }), ev({ ref: "f" })], resolve, []);
    expect(r.entries[0]?.evidence?.ref).toBe("f");
    expect(r.unmatched.map((u) => u.ref)).toEqual(["n"]);
  });

  it("puts every leftover on a control page into control", () => {
    const r = matchGroundTruth([], [ev({ page: "accessible.html", kind: "alt_candidate" })], resolve, ["accessible.html"]);
    expect(r.control).toHaveLength(1);
    expect(r.unmatched).toHaveLength(0);
  });
});

describe("computeMetrics", () => {
  it("computes recall, finding-only recall and control false positives", () => {
    const entries = [entry({ id: "a" }), entry({ id: "b", selector: ".help-dialog", expected_rule: "a11y-keyboard-trap" })];
    const evidence = [ev({}), ev({ kind: "needs_review", ruleId: "a11y-keyboard-trap", selector: "#help-question" })];
    const m = computeMetrics(matchGroundTruth(entries, evidence, resolve, []));
    expect(m).toMatchObject({ planted: 2, detected: 2, recall: 1, findingRecall: 0.5, controlFalsePositives: 0, passed: true });
  });

  it("fails on any control false positive even at full recall", () => {
    const m = computeMetrics(matchGroundTruth([entry({})], [ev({}), ev({ page: "accessible.html", ref: "fp" })], resolve, ["accessible.html"]));
    expect(m.recall).toBe(1);
    expect(m.controlFalsePositives).toBe(1);
    expect(m.passed).toBe(false);
  });

  it("fails below 90% recall", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry({ id: `e${i}`, selector: i === 0 ? "button.cart" : "#nope" }));
    expect(computeMetrics(matchGroundTruth(entries, [ev({})], resolve, [])).passed).toBe(false);
  });
});

describe("evidence", () => {
  it("maps URLs to page keys", () => {
    expect(pageKey("http://127.0.0.1:4173/")).toBe("index.html");
    expect(pageKey("http://127.0.0.1:4173/about.html?x=1")).toBe("about.html");
    expect(pageKey("http://127.0.0.1:4173/blog/")).toBe("blog/index.html");
  });

  it("collects alt candidates and axe incomplete nodes alongside findings", () => {
    const page = "http://127.0.0.1:4173/about.html";
    const report = {
      findings: [{ id: "f", pageUrl: page, ruleId: "link-name", selector: ".social" }],
      altCandidates: [{ pageUrl: page, selector: "img.team-photo", alt: "team_photo_03.jpg" }],
      pages: [{ url: page, axeRaw: { violations: [], incomplete: [{ id: "duplicate-id-aria", nodes: [{ target: ["section > h2"] }] }] } }],
    } as unknown as Parameters<typeof collectEvidence>[0];
    expect(collectEvidence(report).map((e) => [e.kind, e.ruleId, e.selector])).toEqual([
      ["finding", "link-name", ".social"],
      ["alt_candidate", "a11y-alt-quality", "img.team-photo"],
      ["needs_review", "duplicate-id-aria", "section > h2"],
    ]);
  });
});
