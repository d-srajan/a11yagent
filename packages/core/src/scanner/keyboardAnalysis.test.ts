import { describe, expect, it } from "vitest";
import { analyzeWalk, detectTrap, keyboardFindings } from "./keyboardAnalysis.js";
import type { InteractiveElement, TabStops, WalkStop } from "./types.js";

const stop = (path: string, overrides: Partial<WalkStop> = {}): WalkStop => ({
  path,
  tag: "button",
  role: "button",
  name: path,
  html: `<button>${path}</button>`,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  inFrame: false,
  focusVisible: true,
  ...overrides,
});

const el = (path: string, overrides: Partial<InteractiveElement> = {}): InteractiveElement => ({
  path,
  tag: "a",
  role: "link",
  name: path,
  html: "",
  groupKey: null,
  container: null,
  related: [],
  ...overrides,
});

const cycle = (paths: string[], times: number): WalkStop[] => Array.from({ length: times }, (_, i) => stop(paths[i % paths.length] ?? ""));

describe("detectTrap", () => {
  it("detects focus cycling among 3 elements for 10 presses before the last element", () => {
    const sequence = [stop("a"), stop("b"), ...cycle(["x", "y", "z"], 12)];
    expect(detectTrap(sequence, "footer")).toEqual({ cycle: ["x", "y", "z"], startPress: 2 });
  });

  it("ignores cycles of 4 or more elements", () => {
    expect(detectTrap(cycle(["w", "x", "y", "z"], 20), "footer")).toBeNull();
  });

  it("is not a trap once the last tabbable element has been reached", () => {
    expect(detectTrap([stop("a"), stop("last"), ...cycle(["x", "y"], 12)], "last")).toBeNull();
  });

  it("is not a trap when focus escapes to the browser in between", () => {
    const sequence = [stop("a"), stop("b"), null, stop("a"), stop("b"), null, stop("a"), stop("b"), null, stop("a"), stop("b")];
    expect(detectTrap(sequence, "zzz")).toBeNull();
  });

  it("does not count presses inside an iframe", () => {
    expect(detectTrap(Array.from({ length: 12 }, () => stop("iframe", { inFrame: true })), "footer")).toBeNull();
  });

  it("needs at least 10 presses", () => {
    expect(detectTrap(cycle(["x", "y"], 9), "footer")).toBeNull();
  });
});

describe("analyzeWalk", () => {
  const stops: TabStops = {
    tabbableOrder: ["a", "b", "radio-1"],
    interactive: [
      el("a"),
      el("b"),
      el("div.card", { tag: "div", role: null }),
      el("nav-div", { tag: "div", container: "nav" }),
      el("radio-1", { groupKey: "radio:size" }),
      el("radio-2", { groupKey: "radio:size" }),
      el("card-wrapper", { tag: "div", related: ["a"] }),
    ],
  };

  it("reports interactive elements that never got focus after a full lap", () => {
    const result = analyzeWalk([stop("a"), stop("b"), stop("radio-1"), null], stops, true);
    expect(result.unreachable.map((e) => e.path)).toEqual(["div.card", "nav-div"]);
  });

  it("does not report unreachable elements when the walk did not finish a lap", () => {
    expect(analyzeWalk([stop("a"), stop("b")], stops, false).unreachable).toEqual([]);
  });

  it("suppresses unreachable findings behind a keyboard trap", () => {
    const result = analyzeWalk(cycle(["a", "b"], 12), { ...stops, tabbableOrder: ["a", "b", "c"] }, false);
    expect(result.trap).not.toBeNull();
    expect(result.unreachable).toEqual([]);
  });

  it("reports each element without a visible focus change once", () => {
    const result = analyzeWalk([stop("a", { focusVisible: false }), stop("b"), stop("a", { focusVisible: false }), null], stops, true);
    expect(result.invisible.map((s) => s.path)).toEqual(["a"]);
  });
});

describe("keyboardFindings", () => {
  it("maps each result to a finding with the spec's impact and WCAG criterion", () => {
    const sequence = [stop("x"), ...cycle(["x", "y"], 11)];
    const analysis = { trap: { cycle: ["x", "y"], startPress: 0 }, unreachable: [el("div.card")], invisible: [stop("b")] };
    const findings = keyboardFindings(analysis, sequence);
    expect(findings.map((f) => [f.ruleId, f.impact, f.wcag[0], f.selector])).toEqual([
      ["a11y-keyboard-trap", "critical", "2.1.2", "x"],
      ["a11y-unreachable", "serious", "2.1.1", "div.card"],
      ["a11y-focus-visible", "serious", "2.4.7", "b"],
    ]);
  });
});
