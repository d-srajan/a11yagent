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
