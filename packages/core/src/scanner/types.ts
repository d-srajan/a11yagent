import type { Finding } from "../report-schema.js";

// A finding before it is attached to a page and given an id.
export type RawFinding = Omit<Finding, "id" | "pageId" | "pageUrl">;

// What the browser probe reports about an interactive element.
export interface InteractiveElement {
  path: string;
  tag: string;
  role: string | null;
  name: string;
  html: string;
  // Radios share one tab stop per group; any focused member counts for all.
  groupKey: string | null;
  container: "nav" | "form" | "group" | null;
  // Tabbable ancestors or descendants: a clickable card wrapping a real link
  // is reachable through that link.
  related: string[];
}

// One Tab press as seen by the probe; html is used for the finding snippet.
export interface WalkStop {
  path: string;
  tag: string;
  role: string | null;
  name: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  inFrame: boolean;
  focusVisible: boolean | null;
}

export interface TabStops {
  // Tabbable elements in expected Tab order (positive tabindex first).
  tabbableOrder: string[];
  interactive: InteractiveElement[];
}

export interface ImageRecord {
  selector: string;
  src: string;
  alt: string;
  surroundingText: string;
  inLink: boolean;
}
