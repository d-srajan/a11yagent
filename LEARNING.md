# Learning log

## Phase 0: Scaffold and skeleton

### In my own words

<!-- 
- Message queue for accessibility scan jobs
- Row Level Security in DB
 -->

### Concepts used

- **A database table as a job queue.** The web app only writes `queued` rows. A worker claims them with `FOR UPDATE SKIP LOCKED`, so slow work never runs inside an HTTP request and two workers can never take the same scan.
- **Lease and retry.** `claimed_at` and `attempts` act as a lease: if a worker dies, the claim goes stale after 10 minutes and another worker retries it, at most twice.
- **RLS with no policies.** Deny-by-default for the public anon key. Only the service role (worker and server code) can touch data. Functions need their own `REVOKE EXECUTE`, because RLS does not cover them.
- **Secret scanning in layers.** A local gitleaks hook stops the commit. GitHub push protection stops the push. Rotation is the only real fix once a key leaks.
- **Validating env at startup.** zod checks the environment once and fails loudly instead of letting an undefined value surface later.

### Trade-offs made

- Polling every 2 s instead of Postgres `LISTEN/NOTIFY`: simpler, works through PostgREST, and up to 2 s of latency doesn't matter for a minutes-long scan.
- A hand-written logger instead of pino: no new dependency, same interface if we swap later.
- `setTimeout` chaining instead of `setInterval`: polls can't overlap, so concurrency stays at 1 without a lock.

### Interview questions

1. **Why does `SKIP LOCKED` matter for a queue table?**
   Without it, a second worker running the same `SELECT ... FOR UPDATE` waits for the first worker's lock and then gets the same row or blocks the queue. `SKIP LOCKED` makes it move on to the next free row, so workers claim different jobs in parallel without contention.
2. **A worker crashes mid-scan. What happens?**
   The row stays in a non-terminal status with an old `claimed_at`. After 10 minutes `claim_next_scan()` treats the claim as expired and hands the scan out again with `attempts` incremented. A scan that has already used 2 attempts is marked `failed`, so nothing gets stuck forever.
3. **The anon key is public. Why is that safe here?**
   Every table has RLS enabled and no policies, so the anon role can read and write zero rows, and EXECUTE on the claim function is revoked from anon. All real access goes through server code holding the service role key, which applies rate limits and validation.

## Phase 1: Scanner engine CLI

### In my own words

<!-- 
- Most findings are in-fact deterministic.
- SSRF: For security, check any URL before actually fetching.
 -->

### Concepts used

- **Deterministic-first design.** Crawling, axe, the keyboard walk, alt-text candidate rules, grouping and scoring are all plain functions: same input, same output, unit-tested and free to run. With no model involved, the scanner already catches 26 of the 27 planted issues: 23 as findings, 3 as alt-text candidates. The 27th lands in axe's "needs review". The LLM's later job is narrow: language and judgment.
- **SSRF.** A service that fetches URLs for strangers can be aimed at its own network: cloud metadata at 169.254.169.254, `localhost` admin panels, 10.x services. The guard resolves DNS and blocks every internal range. An "allow" is never cached, because DNS answers can change (rebinding).
- **Defense in depth, and testing your assumptions.** The spec's route interception looked sufficient, but a 20-line experiment showed it misses redirect hops. The fix was a forward proxy that checks every connection and connects to the exact IP it approved, with a unit test proving redirects are re-checked.
- **Heuristics need guardrails against false positives.** Each keyboard rule only fires when the evidence is unambiguous: a full lap was completed, no trap hides the rest of the page, it isn't a radio group or roving tabindex, and transitions are off. A clean control page with zero findings is the test that keeps them honest.
- **One schema as the contract.** `ScanReport` (zod) is what the CLI writes, the worker will store and the eval runner will grade. Parsing our own output catches drift early.

### Trade-offs made

- Proxy plus route interception instead of route interception alone: about 120 more lines, but redirects and DNS rebinding are closed.
- Only `empty-heading` added beyond the WCAG tags, not all best-practice rules: one planted rule detected, without the noise.
- Unreachable elements are suppressed behind a trap: one critical issue instead of dozens of misleading serious ones, at the cost of not listing them.
- CLI default of 10 pages vs. the service's 5: complete local scans, while public cost limits stay in Phase 4.
- At 10x traffic: everything here is CPU-bound on one Chromium (about 2 s per page). The proxy and DNS checks are negligible. Scale by adding workers.

### Interview questions

1. **Your SSRF guard checks the URL before the browser loads it. Why isn't that enough?**
   Two gaps: redirects (a public URL can 302 to 169.254.169.254, and Playwright's route handler isn't called for redirect hops) and DNS rebinding (the browser resolves the name again and can get a private IP). Routing all traffic through a proxy that checks every request and connects to the exact IP it validated closes both.
2. **How do you detect a keyboard trap automatically?**
   Press Tab repeatedly and record the focused element each time. If 10 consecutive presses land on 3 or fewer elements, focus never escaped to the browser, and the page's last tabbable element was never reached, focus is trapped. Presses inside iframes don't count, because the frame's inner focus is invisible from outside.
3. **Why score severity with a formula instead of asking an LLM to rank issues?**
   Ranking is the product's promise ("fix these five first"), so it must be stable between runs, explainable, unit-testable and free. `impact × (1 + ln(occurrences)) × startPage × blocker` gives all four. The log term means 50 copies of a header bug outrank one copy without drowning out a single critical trap.

## Phase 2: Eval harness

### In my own words

<!--
- Evals are a way to evaluate system performance based on change of Model, prompt, etc. 
- Set a ground truth, and compare how change in model/prompt changes the output.
-->

### Concepts used

- **Evals before the LLM.** A fixed ground-truth set (27 planted issues and one clean control page) turns "the scanner seems good" into a number that every later change has to keep. Building it now, while the pipeline is deterministic, gives a clean baseline. When Phase 3 adds a model, any drop in the number is the model's doing.
- **Recall and false positives, together.** Recall alone rewards reporting everything; false positives alone reward reporting nothing. The control page pins the second number at zero, and the same evidence kinds count on both sides, so loosening a check can't buy recall for free.
- **Ablation proves the eval has teeth.** Turning off one component (the keyboard walk) and watching recall fall by exactly the 5 issues only it catches shows the metric is wired to real behavior. An eval that stays at 100% whatever you break measures nothing.
- **Match on meaning, not strings.** The matcher asks the browser which element each selector selects. Ground truth stays readable (`button.cart`), and renaming a selector in the scanner is not a regression.
- **The eval checks itself.** A ground-truth selector that selects nothing fails the run, so a typo in the answer key can't pass as a scanner miss.

### Trade-offs made

- Counting alt candidates and axe "needs review" toward recall (D18): the target is reachable in this phase, and finding-only recall (85.2%) is printed next to it so the gap isn't hidden. This has to be tightened in Phase 3.
- DOM resolution instead of string matching: one extra page load per page and a Playwright dependency in the eval, in exchange for matches that don't break on harmless selector changes.
- Greedy one-to-one matching instead of optimal assignment: simpler, and correct here because planted issues with the same page and rule sit on different elements.
- Committed results files: easy history and diffs now. At 10x the runs, move them to CI artifacts. A run costs nothing (about 20 s of local Chromium, no LLM).

### Interview questions

1. **Why build an eval before adding the LLM?**
   So every later change is measured against a fixed baseline instead of eyeballed. With a deterministic scanner, the baseline is stable (27/27, 0 FP). When the LLM arrives, any change in the numbers can be pinned on it, and prompt or model swaps become experiments with a score instead of opinions.
2. **Your recall is 100%. How do you know the eval isn't broken?**
   Ablation: disable a component and the metric must drop by what that component alone catches. Turning off the keyboard walk took recall to 22/27, missing exactly the five focus, unreachable and trap issues. The unit tests also check the matcher's edge cases: wrong rule, wrong page, ancestor-only matches, double counting, and broken ground-truth selectors.
3. **Why track false positives on a clean page instead of precision across the whole site?**
   Precision needs a complete list of every real issue on every page, and real pages contain issues nobody planted, so "unmatched" doesn't mean "wrong". A page built to be clean has a known answer of zero, so any finding there is a guaranteed false positive. We still print unmatched findings on planted pages as an info signal.
