import type { InteractiveElement, RawFinding, TabStops, WalkStop } from "./types.js";

// Pure functions over a recorded Tab sequence, so every rule is unit-testable
// without a browser.

export const RULE_TRAP = "a11y-keyboard-trap";
export const RULE_UNREACHABLE = "a11y-unreachable";
export const RULE_FOCUS_VISIBLE = "a11y-focus-visible";
export const TRAP_WINDOW = 10;
export const TRAP_MAX_ELEMENTS = 3;

export interface Trap {
  cycle: string[];
  startPress: number;
}

export interface WalkAnalysis {
  trap: Trap | null;
  unreachable: InteractiveElement[];
  invisible: WalkStop[];
}

// Focus cycles among <= 3 elements for >= 10 presses before the page's last
// tabbable element is reached. A press that lands on the body (focus left the
// page) or inside an iframe breaks the window: neither is a trap.
export function detectTrap(sequence: (WalkStop | null)[], lastTabbable: string | undefined): Trap | null {
  if (!lastTabbable) return null;
  const seen = new Set<string>();
  for (let i = 0; i < sequence.length; i++) {
    const stop = sequence[i];
    if (stop) seen.add(stop.path);
    if (seen.has(lastTabbable)) return null;
    if (i + 1 < TRAP_WINDOW) continue;
    const window = sequence.slice(i + 1 - TRAP_WINDOW, i + 1);
    if (window.some((s) => !s || s.inFrame)) continue;
    const distinct = new Set(window.map((s) => s?.path ?? ""));
    if (distinct.size <= TRAP_MAX_ELEMENTS) return { cycle: [...distinct], startPress: i + 1 - TRAP_WINDOW };
  }
  return null;
}

export function analyzeWalk(sequence: (WalkStop | null)[], stops: TabStops, completedCycle: boolean): WalkAnalysis {
  const trap = detectTrap(sequence, stops.tabbableOrder.at(-1));
  const focused = new Set(sequence.flatMap((s) => (s ? [s.path] : [])));

  // Unreachable is only meaningful after a full lap of the page. Behind a
  // trap, everything after it looks unreachable; that is one problem, the
  // trap, so it is reported once rather than as dozens of findings.
  let unreachable: InteractiveElement[] = [];
  if (!trap && completedCycle) {
    const focusedGroups = new Set(stops.interactive.filter((e) => e.groupKey && focused.has(e.path)).map((e) => e.groupKey));
    unreachable = stops.interactive.filter(
      (e) =>
        !focused.has(e.path) &&
        !(e.groupKey && focusedGroups.has(e.groupKey)) &&
        !e.related.some((p) => focused.has(p)),
    );
  }

  const invisible = new Map<string, WalkStop>();
  for (const stop of sequence) {
    if (stop && !stop.inFrame && stop.focusVisible === false && !invisible.has(stop.path)) invisible.set(stop.path, stop);
  }

  return { trap, unreachable, invisible: [...invisible.values()] };
}

export function keyboardFindings(analysis: WalkAnalysis, sequence: (WalkStop | null)[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const byPath = new Map(sequence.flatMap((s) => (s ? [[s.path, s] as const] : [])));

  if (analysis.trap) {
    const names = analysis.trap.cycle.map((p) => byPath.get(p)?.name || p);
    const first = analysis.trap.cycle[0] ?? "";
    findings.push({
      source: "keyboard",
      ruleId: RULE_TRAP,
      impact: "critical",
      wcag: ["2.1.2"],
      selector: first,
      htmlSnippet: byPath.get(first)?.html ?? null,
      message: `Keyboard focus is trapped: Tab keeps cycling between ${names.length} element(s) (${names.join(", ")}) and never reaches the rest of the page.`,
      data: { cycle: analysis.trap.cycle, startPress: analysis.trap.startPress, pressesObserved: TRAP_WINDOW },
    });
  }

  for (const el of analysis.unreachable) {
    findings.push({
      source: "keyboard",
      ruleId: RULE_UNREACHABLE,
      impact: "serious",
      wcag: ["2.1.1"],
      selector: el.path,
      htmlSnippet: el.html,
      message: `This ${el.role ?? el.tag}${el.name ? ` ("${el.name}")` : ""} can be clicked but never receives keyboard focus.`,
      data: { tag: el.tag, role: el.role, name: el.name, container: el.container },
    });
  }

  for (const stop of analysis.invisible) {
    findings.push({
      source: "keyboard",
      ruleId: RULE_FOCUS_VISIBLE,
      impact: "serious",
      wcag: ["2.4.7"],
      selector: stop.path,
      htmlSnippet: stop.html,
      message: `No visible focus indicator: this ${stop.role ?? stop.tag} looks the same focused and unfocused.`,
      data: { tag: stop.tag, role: stop.role, name: stop.name },
    });
  }
  return findings;
}
