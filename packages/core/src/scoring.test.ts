import { describe, expect, it } from "vitest";
import { compareIssues, highestImpact, isBlocker, severityScore, type ScoreInput } from "./scoring.js";

const base: ScoreInput = { impact: "serious", occurrences: 1, onStartPage: false, blocker: false };

describe("severityScore", () => {
  it("uses the impact weight: critical 10, serious 6, moderate 3, minor 1", () => {
    expect(severityScore({ ...base, impact: "critical" })).toBe(10);
    expect(severityScore({ ...base, impact: "serious" })).toBe(6);
    expect(severityScore({ ...base, impact: "moderate" })).toBe(3);
    expect(severityScore({ ...base, impact: "minor" })).toBe(1);
  });

  it("grows with 1 + ln(occurrences)", () => {
    expect(severityScore({ ...base, occurrences: 1 })).toBe(6);
    expect(severityScore({ ...base, occurrences: 10 })).toBeCloseTo(6 * (1 + Math.log(10)), 2);
    // Logarithmic: 100 copies score far less than 100x one copy.
    expect(severityScore({ ...base, occurrences: 100 })).toBeLessThan(6 * 10);
  });

  it("treats zero or negative occurrences as one", () => {
    expect(severityScore({ ...base, occurrences: 0 })).toBe(6);
  });

  it("multiplies by 1.5 when the issue is on the start page", () => {
    expect(severityScore({ ...base, onStartPage: true })).toBe(9);
  });

  it("multiplies by 2 for blockers", () => {
    expect(severityScore({ ...base, blocker: true })).toBe(12);
  });

  it("combines every factor", () => {
    const score = severityScore({ impact: "critical", occurrences: 3, onStartPage: true, blocker: true });
    expect(score).toBeCloseTo(10 * (1 + Math.log(3)) * 1.5 * 2, 2);
  });

  it("rounds to two decimals so reports are stable", () => {
    const score = severityScore({ ...base, occurrences: 7 });
    expect(Math.round(score * 100) / 100).toBe(score);
  });
});

describe("isBlocker", () => {
  it("always counts a keyboard trap", () => {
    expect(isBlocker("a11y-keyboard-trap", [{ data: {} }])).toBe(true);
  });

  it.each(["nav", "form", "group"])("counts unreachable elements inside %s", (container) => {
    expect(isBlocker("a11y-unreachable", [{ data: { container: null } }, { data: { container } }])).toBe(true);
  });

  it("does not count unreachable elements elsewhere, or other rules", () => {
    expect(isBlocker("a11y-unreachable", [{ data: { container: null } }])).toBe(false);
    expect(isBlocker("button-name", [{ data: { container: "nav" } }])).toBe(false);
  });
});

describe("ranking helpers", () => {
  it("picks the highest impact", () => {
    expect(highestImpact(["minor", "serious", "moderate"])).toBe("serious");
    expect(highestImpact([])).toBe("minor");
  });

  it("sorts by score, then impact, then occurrences, then group key", () => {
    const issues = [
      { severityScore: 6, impact: "serious" as const, occurrenceCount: 1, groupKey: "b" },
      { severityScore: 6, impact: "serious" as const, occurrenceCount: 1, groupKey: "a" },
      { severityScore: 6, impact: "critical" as const, occurrenceCount: 1, groupKey: "z" },
      { severityScore: 20, impact: "minor" as const, occurrenceCount: 1, groupKey: "y" },
      { severityScore: 6, impact: "serious" as const, occurrenceCount: 4, groupKey: "c" },
    ];
    expect(issues.sort(compareIssues).map((i) => i.groupKey)).toEqual(["y", "z", "c", "a", "b"]);
  });
});
