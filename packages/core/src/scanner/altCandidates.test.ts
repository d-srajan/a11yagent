import { describe, expect, it } from "vitest";
import { altReasons, findAltCandidates } from "./altCandidates.js";
import type { ImageRecord } from "./types.js";

describe("altReasons", () => {
  it.each(["IMG_2041.JPG", "team_photo_03.jpg", "hero.webp", "DSC_0042", "20240611-1"])("flags file name %s", (alt) => {
    expect(altReasons(alt)).toContain("file_name");
  });

  it.each(["image", "Photo", "logo.", "ICON", "graphic"])("flags generic word %s", (alt) => {
    expect(altReasons(alt)).toContain("generic_word");
  });

  it("flags alt text under 4 characters", () => {
    expect(altReasons("pic")).toContain("too_short");
    expect(altReasons("cake")).not.toContain("too_short");
  });

  it('flags "image of" and "picture of"', () => {
    expect(altReasons("Image of a cake")).toContain("redundant_prefix");
    expect(altReasons("picture of the shop")).toContain("redundant_prefix");
  });

  it.each(["A long golden baguette with a crisp crust", "Team photo from our 2019 opening", "Bad Bakery home"])(
    "leaves good alt text alone: %s",
    (alt) => expect(altReasons(alt)).toEqual([]),
  );
});

describe("findAltCandidates", () => {
  const img = (src: string, alt: string): ImageRecord => ({ selector: "img", src, alt, surroundingText: "", inLink: false });
  const PAGE_A = "00000000-0000-4000-8000-00000000000a";
  const PAGE_B = "00000000-0000-4000-8000-00000000000b";

  it("flags the same alt used on 3+ different images", () => {
    const candidates = findAltCandidates([
      { pageId: PAGE_A, pageUrl: "https://x.test/", images: [img("/a.png", "Fresh bread"), img("/b.png", "Fresh bread")] },
      { pageId: PAGE_B, pageUrl: "https://x.test/b", images: [img("/c.png", "Fresh bread")] },
    ]);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => c.reasons.includes("repeated"))).toBe(true);
  });

  it("does not treat one image repeated on every page as a repeat, and dedupes it", () => {
    const logo = img("/logo.svg", "Bad Bakery home");
    expect(
      findAltCandidates([
        { pageId: PAGE_A, pageUrl: "https://x.test/", images: [logo] },
        { pageId: PAGE_B, pageUrl: "https://x.test/b", images: [logo] },
        { pageId: PAGE_B, pageUrl: "https://x.test/c", images: [logo] },
      ]),
    ).toEqual([]);

    const badLogo = img("/logo.svg", "logo");
    const candidates = findAltCandidates([
      { pageId: PAGE_A, pageUrl: "https://x.test/", images: [badLogo] },
      { pageId: PAGE_B, pageUrl: "https://x.test/b", images: [badLogo] },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ occurrences: 2, pageId: PAGE_A, reasons: ["generic_word"] });
  });
});
