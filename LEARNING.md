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

## Phase 3: LLM layer and first agents

### In my own words

<!-- 
 - Simply put, agents are LLMs + Tools running in a loop
 - Be care with checks during the loop, like 
   - no of LLM calls, 
   - budgeting
   - tracing for debugging, monitoring
   - no of tool calls, and appending tool output to the LLM message, 
   - use specific agents for each tasks, 
   - provide the context LLM needs and nothing else, 
   - don't trust inputs from untrusted sources(duh!)
 -->

### Concepts used

- **Tool calling.** The model never runs anything. It returns a tool name and JSON arguments; our code checks the tool exists, validates the arguments with zod, runs a fixed function, and sends the result (or the error) back as a `tool` message with the same `tool_call_id`.
- **Structured output.** JSON mode plus a zod schema plus one repair turn. The model is shown the schema (generated from zod, so it can't drift), and anything that fails validation never reaches the report.
- **The agent loop and stop conditions.** Call model → run tools → append results → repeat, stopping only on a valid `finish`, `maxSteps`, or an exhausted budget. Specified by 13 tests with a scripted mock model. The hand-write step was only partly by hand: I drafted `runAgent`, and after two review rounds Claude Code finished it at my request (one `handleCall` with early returns, so every tool call gets exactly one trace row and one reply). Retype it from memory before interviews.
- **Provider fallback.** One OpenAI-compatible client, three providers in env order. Rate limits and bad keys bench a provider for the rest of the scan, and SDK retries are off so every attempt is counted.
- **Budgets and tracing.** Every attempt reserves a call against the per-scan limits and the daily cap before it is sent, and every attempt and tool call becomes an `agent_steps`-shaped row. That trace is how you prove a fallback happened or why a part is "unavailable".
- **Untrusted input.** Page text and HTML go inside `<untrusted_page_content>` tags that the page can't close, and every system prompt says the tags hold data, not instructions.

### Trade-offs made

- Single structured calls for the explainer and reviewer instead of agent loops: cheaper and predictable. The loop is saved for the fixer, where tools are needed.
- JSON mode instead of strict `json_schema`: works on all three free providers, at the cost of an occasional repair call.
- Images rendered in the guarded browser instead of an image library: no new dependency, the same SSRF path as page scans, and SVG support. It costs one extra browser launch.
- Steps live in the report until Phase 4 writes scans to the DB, so the trace is complete but not yet queryable.
- Failed attempts count against the budget, so a flaky provider can leave a scan with fewer explanations, but free-tier usage can never exceed the cap.

### Interview questions

1. **Your agent's tool throws an exception. What happens?**
   The loop catches it and returns `Error: <message>` as that tool call's result. The model sees it and can retry with different arguments or give up through `finish`. Throwing would kill the run over something the model could have recovered from. A timeout gets the same treatment.
2. **How do you stop an agent from running forever or overspending?**
   Three hard stops, enforced in code: `maxSteps` on model calls, a per-scan budget (calls and output tokens) checked *before* every call, and a global daily cap counted from the trace table. `finish` arguments are validated, so a junk "I'm done" doesn't count as finishing. Budget exhaustion is a normal result status, and the report marks those parts "unavailable" instead of failing the scan.
3. **Your primary LLM provider starts returning 429s mid-scan. Walk through what happens.**
   The 429 attempt is traced with its error and counts against the budget. The client moves to the next provider for that call and benches the rate-limited one for the rest of the scan, so later calls go straight to the fallback. If output fails validation, the same model gets one repair turn, then the next provider. If all fail, that part is marked unavailable. The trace shows exactly which provider answered each call.

## Phase 4: Web app end to end

### In my own words

<!-- Three sentences, before ticking the checklist. -->

### Concepts used

- **Async jobs and progress UX.** The API inserts a `queued` row and returns its id in under a second. The worker writes `status` and `progress` as it moves through crawling, scanning and analyzing, and the page polls every 2 s with `setTimeout` chaining, so requests never stack. The user sees "3 of 5 pages checked" and their place in the queue instead of a spinner.
- **Abuse control in layers.** Turnstile (is it a person?), the SSRF guard (is the target public?), a per-IP daily limit on a salted hash (how much can one person use?), a global LLM cap (how much can everyone use?) and a kill switch (stop everything without a deploy). Each one is checked in code; the tests pin down the order.
- **Caching as a cost control.** The same `normalized_url` within 24 hours returns the existing scan id. A repeat costs one indexed query instead of a browser session and about 4 LLM calls, and it doesn't touch the user's quota.
- **Leases and graceful shutdown.** `attempts` plus `claimed_at` form a lease. On SIGTERM the worker gives its scan back instead of waiting to be SIGKILLed, and a retry starts by deleting the previous attempt's partial rows.
- **Showing the agent's work.** The timeline renders every `agent_steps` row (tool or model call, provider/model, latency, tokens, a one-line input and output, errors). Users can check that AI ran only where we say, and a fallback or failure is visible rather than hidden.

### Trade-offs made

- Polling instead of Supabase Realtime or Server-Sent Events: one GET every 2 s per open tab is trivial at this scale and needs no anon key in the browser (RLS has no policies). At 10x, a CDN-cacheable "done" response or Realtime would cut the load.
- Agent steps are written once at the end of the scan, not live. That's simpler, with no FK ordering problems, but the timeline appears only with the finished report.
- Rate limiting by counting rows: no Redis, but slightly racy under concurrent requests (D30).
- The worker creates the screenshots bucket itself instead of a migration (D33).

### Interview questions

1. **Why doesn't the web API just run the scan and return the report?**
   A scan takes 30 s to 3 min and needs Chromium. Serverless functions time out and run Chromium poorly, and a dropped connection would lose the work. A queue table decouples the two: the API answers in milliseconds, the worker can retry, and progress is just a row the browser polls.
2. **How do you stop one person from burning your free LLM quota?**
   Turnstile blocks scripts, a salted-IP-hash counter caps scans per IP per day, the cache makes repeats free, each scan has a per-scan LLM budget, and a global daily cap counted from `agent_steps` bounds the total. If all of that fails, `SCANS_ENABLED=false` stops new scans without a deploy.
3. **A deploy restarts the worker mid-scan. What does the user see?**
   The SIGTERM handler sets the scan back to `queued` (or `failed` if it was the second attempt). The new worker claims it within 2 s, deletes the partial rows and re-runs it. The user's page keeps polling and shows the stages again, then the report. Only a hard crash waits for the 10-minute stale lease.
