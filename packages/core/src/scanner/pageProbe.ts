import type { Page } from "playwright";

// Runs INSIDE the scanned page via page.evaluate(pageProbe, kind). Playwright
// serializes the function source, so it must be self-contained: no imports,
// no references to anything outside its own body. It is our fixed code; no
// page-provided or model-provided string is ever evaluated.

export type ProbeKind = "tabStops" | "active" | "images";

export function pageProbe(kind: ProbeKind): unknown {
  const esc = (s: string): string => CSS.escape(s);
  const count = (sel: string): number => {
    try {
      return document.querySelectorAll(sel).length;
    } catch {
      return 0;
    }
  };

  // Short, readable, unique selector: id if unique, else tag.class chain with
  // :nth-child only where siblings would be ambiguous.
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.documentElement) {
      if (node.id && count("#" + esc(node.id)) === 1) {
        parts.unshift("#" + esc(node.id));
        break;
      }
      const tag = node.tagName.toLowerCase();
      const classes = Array.from(node.classList).filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 2);
      let compound = tag + classes.map((c) => "." + c).join("");
      const parent: Element | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.matches(compound));
        if (siblings.length > 1) compound += `:nth-child(${Array.from(parent.children).indexOf(node) + 1})`;
      }
      parts.unshift(compound);
      if (count(parts.join(" > ")) === 1) break;
      node = parent;
    }
    return parts.join(" > ");
  };

  const text = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
  const nameOf = (el: Element): string => {
    const aria = text(el.getAttribute("aria-label"));
    if (aria) return aria;
    const ids = el.getAttribute("aria-labelledby");
    if (ids) {
      const t = text(ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
      if (t) return t;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const label = text(el.labels?.[0]?.textContent);
      if (label) return label;
    }
    const inner = text(el instanceof HTMLElement ? el.innerText : el.textContent);
    if (inner) return inner.slice(0, 80);
    return text(el.querySelector("img[alt]")?.getAttribute("alt") ?? el.getAttribute("title") ?? el.getAttribute("placeholder"));
  };
  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") {
      const type = (el as HTMLInputElement).type;
      return ({ checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button", range: "slider" } as Record<string, string>)[type] ?? "textbox";
    }
    return ({ button: "button", select: "combobox", textarea: "textbox", summary: "button" } as Record<string, string>)[tag] ?? null;
  };
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true });
  };
  const usable = (el: Element): boolean =>
    el !== document.body && !el.matches(":disabled") && !el.closest("[inert]") && visible(el);
  const html = (el: Element): string => el.outerHTML.slice(0, 1000);

  if (kind === "tabStops") {
    const TABBABLE = "a[href],area[href],button,input,select,textarea,iframe,summary,audio[controls],video[controls],[contenteditable]:not([contenteditable=false]),[tabindex]";
    const tabbable = Array.from(document.querySelectorAll(TABBABLE)).filter((el) => usable(el) && (el as HTMLElement).tabIndex >= 0);
    const positive = tabbable.filter((el) => (el as HTMLElement).tabIndex > 0).sort((a, b) => (a as HTMLElement).tabIndex - (b as HTMLElement).tabIndex);
    const order = [...positive, ...tabbable.filter((el) => (el as HTMLElement).tabIndex === 0)];

    // Elements with an explicit negative tabindex are skipped: that is the
    // roving-tabindex pattern (toolbars, tabs) reached with arrow keys.
    const INTERACTIVE = "a[href],button,input:not([type=hidden]),select,textarea,[tabindex],[role=button],[onclick]";
    const interactive = Array.from(document.querySelectorAll(INTERACTIVE))
      .filter((el) => usable(el) && !(el.hasAttribute("tabindex") && (el as HTMLElement).tabIndex < 0))
      .map((el) => {
        const related = tabbable.filter((t) => t !== el && (t.contains(el) || el.contains(t))).map(cssPath);
        const radio = el instanceof HTMLInputElement && el.type === "radio" && el.name;
        const container = el.closest("nav,[role=navigation]")
          ? "nav"
          : el.closest("form,[role=form],[role=search]")
            ? "form"
            : el.closest("[role=group],[role=toolbar],[role=radiogroup],[role=menubar],[role=tablist]")
              ? "group"
              : null;
        return { path: cssPath(el), tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), html: html(el), groupKey: radio ? `radio:${el.name}` : null, container, related };
      });
    return { tabbableOrder: order.map(cssPath), interactive };
  }

  if (kind === "active") {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect();
    const base = { path: cssPath(el), tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), html: html(el), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    if (el.tagName === "IFRAME") return { ...base, inFrame: true, focusVisible: null };

    // Compare the element (and its pseudo-elements, parent and first child,
    // where indicators often live) focused vs blurred.
    const read = (target: Element, pseudo: string | null): string => {
      const cs = getComputedStyle(target, pseudo);
      const outline = cs.outlineStyle === "none" || cs.outlineWidth === "0px" ? "none" : `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`;
      const sides = ["Top", "Right", "Bottom", "Left"].map((s) => ["Style", "Width", "Color"].map((p) => cs.getPropertyValue(`border-${s.toLowerCase()}-${p.toLowerCase()}`)).join(" "));
      return [outline, cs.boxShadow, ...sides, cs.backgroundColor, cs.backgroundImage, cs.color, cs.textDecorationLine, cs.textDecorationColor, cs.content].join("|");
    };
    const targets: [Element, string | null][] = [[el, null], [el, "::before"], [el, "::after"]];
    if (el.parentElement) targets.push([el.parentElement, null]);
    if (el.firstElementChild) targets.push([el.firstElementChild, null]);
    const snapshot = (): string => targets.map(([t, p]) => read(t, p)).join("§");

    const focused = snapshot();
    (el as HTMLElement).blur();
    const blurred = snapshot();
    (el as HTMLElement).focus({ preventScroll: true });
    return { ...base, inFrame: false, focusVisible: focused !== blurred };
  }

  return Array.from(document.querySelectorAll("img[alt]"))
    .filter((img) => text(img.getAttribute("alt")) !== "")
    .map((img) => ({
      selector: cssPath(img),
      src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src,
      alt: img.getAttribute("alt") ?? "",
      surroundingText: text(img.closest("figure,li,article,section,p,a,div")?.textContent).slice(0, 300),
      inLink: img.closest("a[href]") !== null,
    }));
}

// Node-side wrapper: only pageProbe itself is sent to the browser.
export function runProbe<T>(page: Page, kind: ProbeKind): Promise<T> {
  return page.evaluate(pageProbe as (kind: string) => unknown, kind) as Promise<T>;
}
