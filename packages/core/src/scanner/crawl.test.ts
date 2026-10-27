import { describe, expect, it } from "vitest";
import { parseRobots } from "./robots.js";
import { normalizeUrl, pickPages } from "./urls.js";

describe("normalizeUrl", () => {
  it("keeps origin and path, lowercases the host, drops query and hash", () => {
    expect(normalizeUrl("https://Example.COM/About?x=1#team")).toBe("https://example.com/About");
  });
});

describe("parseRobots", () => {
  const robots = parseRobots(`
    # comment
    User-agent: *
    Disallow: /private/
    Allow: /private/press
    Disallow: /*.php$

    User-agent: Googlebot
    Disallow: /

    Sitemap: https://example.com/sitemap.xml
  `);

  it("applies the * group when there is no A11yAgentBot group", () => {
    expect(robots.isAllowed("/private/notes")).toBe(false);
    expect(robots.isAllowed("/about")).toBe(true);
  });

  it("lets the longest match win, Allow on ties", () => {
    expect(robots.isAllowed("/private/press")).toBe(true);
  });

  it("supports * and $", () => {
    expect(robots.isAllowed("/index.php")).toBe(false);
    expect(robots.isAllowed("/index.php?x=1")).toBe(true);
  });

  it("collects sitemaps", () => {
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("prefers our own group over *", () => {
    const ours = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: A11yAgentBot\nDisallow: /admin");
    expect(ours.isAllowed("/about")).toBe(true);
    expect(ours.isAllowed("/admin")).toBe(false);
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(parseRobots("User-agent: *\nDisallow:").isAllowed("/anything")).toBe(true);
  });
});

describe("pickPages", () => {
  const start = "https://example.com/";

  it("puts the start page first, then shortest paths, capped at maxPages", () => {
    const pick = pickPages(start, ["/blog/2024/post", "/contact", "/about", "/blog"], 3);
    expect(pick.pages).toEqual(["https://example.com/", "https://example.com/blog", "https://example.com/about"]);
    expect(pick.skipped.map((s) => s.url)).toEqual(["https://example.com/contact", "https://example.com/blog/2024/post"]);
  });

  it("skips other origins, fragments, query duplicates, non-HTML files and /index.html", () => {
    const pick = pickPages(
      start,
      ["https://other.com/x", "/#top", "/menu?a=1", "/menu?a=2", "/file.pdf", "/logo.png", "/index.html", "mailto:a@b.c"],
      10,
    );
    expect(pick.pages).toEqual(["https://example.com/", "https://example.com/menu?a=1"]);
  });

  it("respects robots.txt for every page except the start page", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /");
    const pick = pickPages(start, ["/about"], 5, robots);
    expect(pick.pages).toEqual(["https://example.com/"]);
    expect(pick.skipped[0]?.reason).toContain("robots.txt");
  });
});
