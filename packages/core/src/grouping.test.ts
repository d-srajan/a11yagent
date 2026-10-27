import { describe, expect, it } from "vitest";
import { groupFindings, normalizeSelector } from "./grouping.js";
import type { Finding } from "./report-schema.js";

const START = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
let n = 0;

function finding(overrides: Partial<Finding>): Finding {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    pageId: OTHER,
    pageUrl: "https://example.com/other",
    source: "axe",
    ruleId: "button-name",
    impact: "critical",
    wcag: ["4.1.2"],
    selector: "header > button",
    htmlSnippet: "<button></button>",
    message: "Fix this",
    data: { help: "Buttons must have discernible text" },
    ...overrides,
  };
}

describe("normalizeSelector", () => {
  it("strips :nth-child(n)", () => {
    expect(normalizeSelector("ul > li:nth-child(3) > a")).toBe("ul > li > a");
  });

  it("strips ids containing digits but keeps meaningful ids", () => {
    expect(normalizeSelector("#post-123 > .title")).toBe("* > .title");
    expect(normalizeSelector("div#ember42.card")).toBe("div.card");
    expect(normalizeSelector("#send")).toBe("#send");
  });

  it("collapses whitespace around combinators", () => {
    expect(normalizeSelector("nav>ul   li:nth-child(2)")).toBe("nav > ul li");
  });

  it("keeps frame separators", () => {
    expect(normalizeSelector("iframe:nth-child(1) >>> button")).toBe("iframe >>> button");
  });
});

describe("groupFindings", () => {
  it("collapses the same element pattern across pages into one issue", () => {
    const issues = groupFindings(
      [
        finding({ pageId: START, selector: "header > li:nth-child(1) > button" }),
        finding({ pageId: OTHER, selector: "header > li:nth-child(4) > button" }),
        finding({ pageId: OTHER, selector: "header > li:nth-child(5) > button" }),
      ],
      START,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ occurrenceCount: 3, pageCount: 2, onStartPage: true, rank: 1 });
    expect(issues[0]?.findingIds).toHaveLength(3);
  });

  it("keeps different rules and different patterns apart", () => {
    const issues = groupFindings(
      [finding({ selector: ".a" }), finding({ selector: ".b" }), finding({ selector: ".a", ruleId: "link-name" })],
      START,
    );
    expect(issues).toHaveLength(3);
  });

  it("ranks by severity score", () => {
    const issues = groupFindings(
      [
        finding({ ruleId: "color-contrast", impact: "serious", selector: ".low" }),
        finding({ ruleId: "a11y-keyboard-trap", source: "keyboard", impact: "critical", selector: "#dialog-input" }),
        finding({ ruleId: "image-alt", impact: "critical", selector: ".hero", pageId: START }),
      ],
      START,
    );
    expect(issues.map((i) => [i.ruleId, i.rank, i.severityScore])).toEqual([
      ["a11y-keyboard-trap", 1, 20],
      ["image-alt", 2, 15],
      ["color-contrast", 3, 6],
    ]);
  });

  it("takes the highest impact in the group and the help text of its first member", () => {
    const [issue] = groupFindings([finding({ impact: "moderate" }), finding({ impact: "critical" })], START);
    expect(issue?.impact).toBe("critical");
    expect(issue?.help).toBe("Buttons must have discernible text");
  });
});
