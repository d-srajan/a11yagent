import type { AltCandidate, AltReason } from "../report-schema.js";
import type { ImageRecord } from "./types.js";

// axe already catches MISSING alt text. These rules catch alt text that
// exists but tells a screen-reader user nothing. They only nominate
// candidates; the vision reviewer (Phase 3) makes the final call.

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|ico)$/i;
const GENERIC_WORDS = new Set(["image", "photo", "picture", "img", "icon", "logo", "graphic"]);
const REDUNDANT_PREFIX = /^(?:image|picture) of\b/i;
export const REPEAT_THRESHOLD = 3;

function looksLikeFileName(alt: string): boolean {
  if (IMAGE_EXTENSION.test(alt)) return true;
  const compact = alt.replace(/\s+/g, "");
  if (!compact) return false;
  // "IMG_2041", "DSC-0042", "20240611": mostly digits, underscores and dashes.
  const noise = compact.replace(/[^0-9_-]/g, "").length;
  return noise / compact.length >= 0.5;
}

export function altReasons(rawAlt: string): AltReason[] {
  const alt = rawAlt.trim();
  const reasons: AltReason[] = [];
  if (looksLikeFileName(alt)) reasons.push("file_name");
  if (GENERIC_WORDS.has(alt.toLowerCase().replace(/[.!:]+$/, ""))) reasons.push("generic_word");
  if (alt.length > 0 && alt.length < 4) reasons.push("too_short");
  if (REDUNDANT_PREFIX.test(alt)) reasons.push("redundant_prefix");
  return reasons;
}

export interface PageImages {
  pageId: string;
  pageUrl: string;
  images: ImageRecord[];
}

// Pages in scan order (start page first), so candidate order is deterministic.
export function findAltCandidates(pages: PageImages[]): AltCandidate[] {
  // "Identical across 3 or more DIFFERENT images": the same logo repeated on
  // every page is one image, not a repeat.
  const srcsByAlt = new Map<string, Set<string>>();
  for (const { images } of pages) {
    for (const img of images) {
      const key = img.alt.trim().toLowerCase();
      if (!srcsByAlt.has(key)) srcsByAlt.set(key, new Set());
      srcsByAlt.get(key)?.add(img.src);
    }
  }

  const candidates = new Map<string, AltCandidate>();
  for (const { pageId, pageUrl, images } of pages) {
    for (const img of images) {
      const reasons = altReasons(img.alt);
      if ((srcsByAlt.get(img.alt.trim().toLowerCase())?.size ?? 0) >= REPEAT_THRESHOLD) reasons.push("repeated");
      if (reasons.length === 0) continue;
      const key = `${img.src}\u0000${img.alt}`;
      const existing = candidates.get(key);
      if (existing) {
        existing.occurrences += 1;
        continue;
      }
      candidates.set(key, { pageId, pageUrl, selector: img.selector, src: img.src, alt: img.alt, reasons, surroundingText: img.surroundingText, inLink: img.inLink, occurrences: 1 });
    }
  }
  return [...candidates.values()];
}
