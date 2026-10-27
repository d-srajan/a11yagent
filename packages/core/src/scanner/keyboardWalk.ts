import type { Page } from "playwright";
import type { KeyboardResult } from "../report-schema.js";
import { analyzeWalk, keyboardFindings } from "./keyboardAnalysis.js";
import { runProbe } from "./pageProbe.js";
import type { RawFinding, TabStops, WalkStop } from "./types.js";

export const MAX_PRESSES = 150;
// The spec's 2x formula, floored so a trap near the top of a short page still
// gets the 10 presses it needs to show up.
const MIN_PRESSES = 20;

// Transitions would make the "focused" snapshot catch a style mid-animation
// and look identical to the blurred one.
const NO_TRANSITIONS = "*,*::before,*::after{transition:none!important;animation:none!important}";

export interface KeyboardOutcome {
  result: KeyboardResult;
  findings: RawFinding[];
}

export async function runKeyboardWalk(page: Page): Promise<KeyboardOutcome> {
  await page.addStyleTag({ content: NO_TRANSITIONS });
  const stops = await runProbe<TabStops>(page, "tabStops");
  const limit = Math.min(MAX_PRESSES, Math.max(MIN_PRESSES, 2 * stops.tabbableOrder.length));

  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });

  const sequence: (WalkStop | null)[] = [];
  let completedCycle = false;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const stop = await runProbe<WalkStop | null>(page, "active");
    sequence.push(stop);
    // Focus fell off the end of the page into the browser UI: one full lap done.
    if (stop === null && sequence.some((s) => s !== null)) {
      completedCycle = true;
      break;
    }
    if (stop === null && i >= 1) {
      // Two presses and still nothing focusable: the page has no tab stops.
      completedCycle = true;
      break;
    }
  }

  const analysis = analyzeWalk(sequence, stops, completedCycle);
  return {
    result: {
      tabbableCount: stops.tabbableOrder.length,
      presses: sequence.length,
      completedCycle,
      trapDetected: analysis.trap !== null,
      sequence: sequence.map((s) => (s ? { path: s.path, tag: s.tag, role: s.role, name: s.name, rect: s.rect, inFrame: s.inFrame, focusVisible: s.focusVisible } : null)),
    },
    findings: keyboardFindings(analysis, sequence),
  };
}
