# Decisions

Non-obvious choices, newest last. Format: context, decision, alternatives, consequences.

## D1. Postgres table as the job queue (Phase 0)

- **Context:** Scans take minutes and need Chromium; Vercel functions time out and handle Chromium poorly.
- **Decision:** The web app inserts `scans` rows with status `queued`; one worker polls every 2 s and claims a row through `claim_next_scan()` using `FOR UPDATE SKIP LOCKED`.
- **Alternatives:** Redis + BullMQ (another service to host and pay for), Supabase Queues/pgmq (an extension and API to learn, and the scan row still needs its own status), calling the worker over HTTP (brings back timeouts and needs a public worker endpoint).
- **Consequences:** One service (Supabase) holds both the queue and the results. Polling costs about 43,000 cheap queries a day for each worker, whatever the traffic, so 10x traffic changes nothing for the queue. The bottleneck at 10x is the single worker running one Chromium at a time: add workers (`SKIP LOCKED` already makes that safe) or a bigger VM.

## D2. `claim_next_scan()` also fails exhausted scans, returns `setof scans`, and is service-role only (Phase 0)

- **Context:** The spec says a scan that reaches 2 attempts is marked `failed`, but not who marks it. PostgREST exposes every public function, and Supabase grants EXECUTE on them to `anon` by default. RLS does not protect functions.
- **Decision:** In the same call, before choosing the next scan, stale non-terminal scans with `attempts >= 2` are set to `failed`. The function returns `setof scans` (`[]` when the queue is empty). EXECUTE is revoked from `public`, `anon` and `authenticated` and granted only to `service_role`.
- **Alternatives:** A separate cron sweep (another moving part). Returning a single `scans` row (PostgREST then returns an all-null object when the queue is empty). Leaving EXECUTE as is (anon could call it; RLS would hide rows from an invoker-rights function today, but a later `security definer` change would quietly open it up).
- **Consequences:** A scan is tried at most twice and never sits in limbo. Tested against a local Postgres 17: anon is denied, concurrent claims get different rows, stale reclaim works, and exhausted scans are failed.

## D3. Committed `.githooks/pre-commit` plus a custom gitleaks rule (Phase 0)

- **Context:** The spec requires a gitleaks pre-commit hook. Testing showed the default `generic-api-key` rule catches the spec's example fake key (`sk-test-` plus 16 characters) only when a keyword such as `key` or `token` is nearby. It misses `const x = "sk-test-..."`.
- **Decision:** Hook script in `.githooks/`, enabled with `pnpm hooks:install` (`git config core.hooksPath .githooks`). `.gitleaks.toml` extends the default rules and adds rules for the `sk-`, `gsk_` and `sb_secret_` prefixes.
- **Alternatives:** husky or lefthook (an extra npm dependency), the pre-commit framework (needs Python).
- **Consequences:** No dependencies. Every fresh clone must run `pnpm hooks:install` once and have the gitleaks binary installed; the hook fails closed if gitleaks is missing. GitHub push protection is the server-side backstop.

## D4. Hand-written JSON logger in `packages/core` (Phase 0)

- **Context:** CLAUDE.md bans `console.log` and asks for a shared logger; adding dependencies needs approval.
- **Decision:** About 50 lines: JSON lines written directly to stdout/stderr, levels, child loggers, error serialization.
- **Alternatives:** pino (faster, with redaction and transports, but a dependency).
- **Consequences:** Good enough at this volume. If log volume or redaction needs grow (Phase 7), swap the implementation behind the same `Logger` interface.

## D5. Toolchain pins: TypeScript 5.9, ESLint 9, Next 15 (Phase 0)

- **Context:** TypeScript 7 (the Go port) and ESLint 10 are current, but typescript-eslint supports `typescript <6.1`, and the Next 15 ESLint config targets ESLint ≤9. CLAUDE.md pins Next 15.
- **Decision:** typescript 5.9.3, eslint 9.39.5, `@next/eslint-plugin-next` 15.5.28 used directly in the flat config, `eslint.config.ts` loaded through jiti.
- **Consequences:** Upgrading later is one coordinated bump of TS, ESLint and Next.

## D6. `@a11yagent/core` exports types from `src`, runtime from `dist` (Phase 0)

- **Context:** Workspace packages must typecheck without a prior build, but Node in the worker container runs compiled JavaScript.
- **Decision:** `exports["."] = { types: "./src/index.ts", default: "./dist/index.js" }`. `pnpm build` builds core before the worker.
- **Alternatives:** TS project references (more config), or a bundler for the worker (another tool).
- **Consequences:** `pnpm typecheck` works on a fresh clone. Running the worker requires core to be built first, which the `dev` script and Dockerfile do.

## D7. Phase 0 worker image is `node:22-slim`; poll lines log at `debug` (Phase 0)

- **Decision:** No Chromium is needed until Phase 1, so the image stays small for now. Each poll is logged at `debug`; `docker-compose.yml` sets `LOG_LEVEL=debug` locally, and production keeps `info` so idle polls don't flood the logs.
- **Consequences:** Phase 1 switches the base image to Playwright's.

## D8. Migration applied through the Supabase SQL editor (Phase 0)

- **Decision:** The migration lives in `supabase/migrations/` under the Supabase CLI's naming convention, but for Phase 0 you paste it into the SQL editor, so the CLI isn't required.
- **Consequences:** No migration history table in Supabase yet. Adopt `supabase db push` once there's a second migration.

## D9. Scanner and SSRF guard live in `@a11yagent/core` behind subpath exports (Phase 1)

- **Context:** The spec puts the scanner and SSRF guard in `packages/core` so the CLI, worker and eval runner share one pipeline. But the web app also imports core, and its client bundle must never pull in Playwright, `node:dns` or `node:net`.
- **Decision:** The root export stays pure (schemas, logger, env, scoring, grouping). Node-only code is imported as `@a11yagent/core/net` and `@a11yagent/core/scanner`. Core and worker add the `DOM` lib to their tsconfig because `pageProbe.ts` runs inside the scanned page.
- **Alternatives:** Separate `packages/scanner` and `packages/net` packages (more package plumbing for no gain yet). Scanner inside the worker (the eval runner would then depend on the worker app).
- **Consequences:** Importing the scanner from a client component fails loudly at build time. DOM types are visible in core's Node code, so be careful not to use `document` outside the probe.

## D10. A guard proxy in front of Chromium, in addition to route interception (Phase 1)

- **Context:** The spec applies the SSRF guard through Playwright route interception. A test in this session showed that `page.route()` is **not called for redirect hops**: a page whose image 302s to `http://localhost/secret` fetched it anyway, and so did a navigation redirect. Chromium also resolves DNS itself, so a host that passed the check could rebind before the connection is made.
- **Decision:** Chromium is launched with `--proxy-server` pointing at a small in-process forward proxy (`net/guardProxy.ts`, with no new dependency). The proxy runs `checkUrl()` on every plain HTTP request and every CONNECT tunnel (HTTPS, WebSockets). It connects with a DNS lookup hook that re-checks the exact address it connects to. Redirects are passed back to the browser, so each hop becomes a new proxy request. `<-loopback>` stops Chromium bypassing the proxy for localhost. Route interception stays as the spec's first layer, giving an early clean abort and a log of what was blocked. QUIC is disabled and WebRTC is limited to proxied UDP.
- **Alternatives:** `route.fetch({ maxRedirects: 0 })` plus manual fulfill (re-implements the browser's network stack, loses streaming and caching semantics, and still uses Playwright's own DNS). `--host-resolver-rules` pinning (only works for hosts known in advance).
- **Consequences:** Verified end to end: route interception blocked the direct metadata request, and the proxy blocked all three redirect hops, which never reached the server. The proxy adds an extra hop on localhost (negligible). At 10x traffic it is still one proxy per browser, so no change. The VM egress rule for 169.254.169.254 (Phase 7) remains the backstop.

## D11. Node-side fetches check DNS at connect time (Phase 1)

- **Context:** `robots.txt` and sitemap fetches run in Node. Checking a URL and then calling `fetch()` leaves a DNS-rebinding gap: the second lookup can return a different address.
- **Decision:** `guardedFetch` uses `http`/`https` with a custom `lookup` hook (`createGuardedLookup`) that rejects any internal address the socket is about to use. Redirects are followed manually with a fresh `checkUrl()` per hop, at most 5 hops, with a 1 MB body cap and a 10 s timeout.
- **Alternatives:** global `fetch` (undici needs a custom dispatcher to hook DNS, which means adding the `undici` dependency).
- **Consequences:** The same lookup hook protects the proxy. IP literals skip `lookup`, which is why `checkUrl()` always runs first.

## D12. `allowLocal` opens exactly 127.0.0.1, on any port (Phase 1)

- **Context:** The spec says `ALLOW_LOCAL_TARGETS` relaxes the guard "for 127.0.0.1 only". The fixtures run on port 4173, so the port rule has to relax too.
- **Decision:** With `allowLocal`, an address equal to `127.0.0.1` passes. A non-standard port is allowed only if *every* resolved address is `127.0.0.1`. `localhost` (which also resolves to `::1`), `127.0.0.2`, private ranges and metadata stay blocked. The CLI and worker refuse the flag when `NODE_ENV=production`.
- **Consequences:** Local scans must use `http://127.0.0.1:<port>`, not `localhost`. The refusal message says so.

## D13. axe: the spec's WCAG tags plus `empty-heading`; `duplicate-id-aria` stays "needs review" (Phase 1)

- **Context:** The fixture table expects `empty-heading` and `duplicate-id-aria`. In axe 4.14, `empty-heading` is tagged `best-practice` only, so the spec's tags never run it. `duplicate-id-aria` returns *incomplete* (axe marks it review-on-fail since WCAG 2.2 dropped 4.1.1), never a violation.
- **Decision:** Run `runOnly` with the five WCAG tags and explicitly enable the one rule `empty-heading`. Leave `duplicate-id-aria` where axe puts it: in `incompleteByRule`, counted under "needs human review", as the spec requires for incomplete results.
- **Alternatives:** Turn on all `best-practice` rules (adds region, landmark and heading-order noise and risks false positives on real sites). Promote selected incomplete rules to findings (overrides axe's judgment and the spec's rule).
- **Consequences:** Phase 2's matcher should either match `duplicate-id-aria` against `incompleteByRule` or mark it as not automatable. Otherwise 26 of the 27 planted issues are detectable (96%, above the 90% target).

## D14. Keyboard-walk heuristics chosen to keep false positives at zero (Phase 1)

- **Decision:** Press Tab `min(150, max(20, 2 × tabbable))` times. The floor of 20 lets a trap near the top of a short page still show its 10 presses. Stop at the first press where focus leaves the page, which counts as one full lap.
  - **Trap:** a 10-press window with ≤ 3 distinct elements before the last tabbable element is reached. A press on the body (focus escaped) or inside an iframe breaks the window.
  - **Unreachable:** reported only after a full lap, and suppressed on a page with a trap, because everything after a trap looks unreachable and is one problem. Not reported for elements with a negative tabindex (roving tabindex), radios whose group got focus, or wrappers whose inner link got focus.
  - **Focus visible:** compare the element focused vs. blurred, along with its `::before`/`::after`, parent and first child. The comparison covers outline, box-shadow, border, background, color and text-decoration (the spec lists outline, box-shadow and border; the rest avoids flagging sites that indicate focus with a background change). CSS transitions are disabled for the walk, so a snapshot can't catch a style mid-transition.
- **Consequences:** Zero false positives on `accessible.html` and on grantvox.com. A trap inside an iframe, or one using shadow DOM, is missed. The CSS-path identity can drift if the DOM changes during the walk.

## D15. Crawl details (Phase 1)

- **CLI default is 10 pages.** By shortest path, `accessible.html` is the 7th fixture page, so with the default of 5 the Verify item "accessible.html produces zero findings" could not pass. The CLI is a local tool; the public service keeps `MAX_PAGES_PER_SCAN=5` (Phase 4). `--max-pages` overrides.
- **Discovery starts from where the start page landed.** `grantvox.com` redirects to `www.grantvox.com`, and every link then looked cross-origin, so only one page was scanned. robots.txt, the sitemap and same-origin filtering now use the final URL's origin.
- **robots.txt follows RFC 9309** (most specific group wins, longest match wins) and fails open on errors. `/` and `/index.html` dedupe as one page.
- **User agent** is `A11yAgentBot/0.1 (+https://github.com/d-srajan/a11yagent)` until the `/bot` page exists (Phase 7).
- **Screenshots** are saved by a caller-supplied `saveScreenshot` callback. The CLI writes them next to the report; the worker will upload them to Storage in Phase 4.

## D16. Worker image stays `node:22-slim` until Phase 4 (amends D7)

- **Context:** D7 planned the switch to the Playwright base image in Phase 1. In Phase 1, though, Chromium only runs through the CLI on your machine. The worker container doesn't run the pipeline until Phase 4.
- **Decision:** Defer the base-image switch to Phase 4, when the worker actually launches Chromium.
- **Consequences:** The current image installs the `playwright` package but no browser binaries. That's fine, because nothing in the container calls it yet.

## D17. The matcher compares DOM elements, not selector strings (Phase 2)

- **Context:** The spec matches a finding to a planted issue by "page, rule and selector". Ground truth is written by a person (`button.cart`, `img.hero`), but axe and the keyboard walk pick their own selectors (`button`, `.hero`, `a.button.order-now`). The keyboard trap is reported on `#help-question`, the input where focus gets stuck, which sits inside the planted `.help-dialog`.
- **Decision:** The eval loads each fixture page once in the guarded scan browser and records which elements every selector selects (by document-order index, plus ancestors). A match means same page, same rule, and the reported element is the planted element or a descendant of it. Matching is one-to-one, prefers real findings over weaker evidence, and a ground-truth selector that selects nothing fails the run.
- **Alternatives:** Exact string equality (all but a handful would miss). Copying the scanner's selectors into ground truth (the ground truth would then just restate the scanner's output, and any selector change would read as a regression). Fuzzy string matching (guesswork). Allowing ancestor matches too (a finding on `<html>` would match everything on the page).
- **Consequences:** Ground truth stays readable and independent of the scanner. The matcher itself is a pure function with unit tests against a fake DOM. Selectors that cross iframes or shadow roots (`>>>`) don't resolve, so they can't match. The fixture has none, but a future fixture that uses them would need a resolver that understands them. Cost: one extra page load per fixture page (about 1 s per run).

## D18. Recall counts alt candidates and axe "needs review" as detections, and reports finding-only recall alongside (Phase 2)

- **Context:** Of the 27 planted issues, three (`a11y-alt-quality`) only become findings once the Phase 3 vision reviewer confirms them, and one (`duplicate-id-aria`) is reported by axe as *incomplete*, never as a violation (D13). Counting findings only gives 23/27 = 85.2%, below the 90% target, and no Phase 2 change could raise it.
- **Decision:** Evidence comes in three kinds: `finding`, `alt_candidate` and `needs_review` (axe incomplete nodes, with their targets taken from `axeRaw`). Headline recall counts all three. The table also prints recall by kind, including finding-only recall. Every kind that counts toward recall also counts as a false positive on the control page, so loosening one check can't buy recall for free.
- **Alternatives:** Findings only (fails the target until Phase 3, for reasons Phase 2 can't fix). Excluding the four from the denominator (hides them, and the number would jump when Phase 3 adds them back).
- **Consequences:** Current run: 27/27 overall, 23 as findings. **Phase 3 must revisit this:** once the alt reviewer exists, an `a11y-alt-quality` issue should count only through a real `poor`/`should_be_decorative` finding. Otherwise a reviewer that rejects every candidate would still score 100% recall. The separate "alt verdict accuracy" metric is the other check on that.

## D19. `scanSite({ keyboardWalk: false })` and `pnpm eval --no-keyboard` (Phase 2)

- **Context:** Verify asks us to disable the keyboard walk temporarily and show that recall drops.
- **Decision:** A `keyboardWalk` option on `scanSite`/`scanPage`, default `true`, exposed only through `pnpm eval --no-keyboard`. The CLI and worker don't expose it.
- **Alternatives:** Editing the code by hand to comment out the walk, then reverting (easy to forget to revert, and you can't repeat it cheaply).
- **Consequences:** The ablation can be rerun anytime, and its results file records `options.keyboardWalk: false`. Measured: recall goes from 27/27 to 22/27, losing exactly the 5 keyboard-only planted issues.

## D20. Eval run history is committed; each record carries git sha and a dirty flag (Phase 2)

- **Decision:** `packages/evals/results/<ISO timestamp>.json` holds metrics, per-issue outcomes, false positives and unmatched evidence, but not the full scan report (`axeRaw` alone is hundreds of KB). `dirty: true` marks runs from uncommitted code, which can't be reproduced from the sha.
- **Consequences:** About 10 KB per run, so it's fine to commit. At 10x the runs (for example on every CI push), stop committing results and upload them as CI artifacts instead. The eval itself costs nothing to run: no LLM yet, about 20 s of local Chromium.

## D21. Every provider error falls back; rate limits and bad keys bench the provider for the scan (Phase 3)

- **Context:** The spec falls back on 429, 5xx, a 20 s timeout or invalid output. The Verify list also needs "invalid Gemini key → fallback provider", and Gemini answers a bad key with `400 API_KEY_INVALID`, not 401.
- **Decision:** Any `ProviderError` moves on to the next provider. 401, 403, 404 (wrong model id), 429 and a 400 that mentions the API key also *disable* that provider for the rest of the scan. Timeouts and 5xx don't. The `openai` SDK runs with `maxRetries: 0`, so every attempt is ours, counted against the budget and traced. Failed attempts count as calls.
- **Alternatives:** Fall back only on the spec's list (a bad key would fail the scan). Retry the same provider with backoff (burns free-tier quota and the time budget).
- **Consequences:** A dead Gemini key costs 1 wasted call per scan instead of up to 9. A 400 caused by our own request also tries the other providers, at most 3 attempts.

## D22. The explainer and alt reviewer are single structured calls, not runAgent runs (Phase 3)

- **Context:** The spec says the explainer makes "one batched structured call (no tools)" and the alt reviewer "one vision call per image". runAgent is for tool-using loops (the Phase 5 fixer).
- **Decision:** `structuredCall()` asks for `response_format: json_object`, describes the shape in the prompt, then parses and validates with zod. Invalid output gets one repair turn *on the same provider* with the zod errors. If the repair also fails, that counts as a provider failure and we fall back. JSON Schemas for prompts and tools are generated from zod (`z.toJSONSchema`).
- **Alternatives:** `json_schema` strict mode (support varies across Gemini compat, Groq and OpenRouter free models). Forcing a `finish` tool call (works, but tool support on free models is patchier than JSON mode).
- **Consequences:** Works on every provider in the chain. Each structured call costs 1 to 2 LLM calls per provider tried.

## D23. Images reach the vision model by rendering them in the guarded browser (Phase 3)

- **Context:** The spec fetches each image through the SSRF guard and resizes it to ≤ 512 px. `guardedFetch` returns text, there's no image library, and the fixture images are SVGs, which vision APIs reject.
- **Decision:** `captureImage()` opens a page in the scan browser, adds an `<img>` (the URL is passed as an argument, never spliced into HTML), scales it to fit 512 px, and takes a JPEG screenshot of the element.
- **Alternatives:** `sharp` (a native dependency and a second fetch path that would need its own SSRF handling). A binary `guardedFetch` (still needs a decoder and resizer).
- **Consequences:** Every image request goes through route interception and the guard proxy, redirects included. Tested: the fixture SVG renders, a 404 and `169.254.169.254` both return null. Costs one browser launch per scan with candidates.

## D24. Agent steps: in-memory trace, the report carries them, DB insert is ready for Phase 4 (Phase 3)

- **Context:** "Every LLM call and tool call writes an agent_steps row", but `agent_steps.scan_id` is a foreign key, and the CLI creates no `scans` row (the worker starts writing reports in Phase 4).
- **Decision:** A `TraceSink` collects `AgentStep` objects (agent_steps columns, camelCased, with big strings and base64 images clipped). The CLI and eval write them into `report.llm.steps`. `apps/worker/src/agentSteps.ts` has the row mapping, `insertAgentSteps()` and `countLlmCallsToday()`. With Supabase env set, the CLI counts today's LLM steps (per UTC day) for `DAILY_LLM_CALL_CAP`, and falls back to 0 with a warning if the count fails.
- **Alternatives:** Have the CLI insert a fake `scans` row so it can write steps (it would pollute the queue table).
- **Consequences:** Fallbacks and budget stops are visible today in the report and the CLI summary. **Phase 4** must insert steps after the scan's issues exist, and the worker should *fail closed* (skip LLM) if the daily count fails.

## D25. Alt review runs before the explainer, and its findings re-rank issues (Phase 3)

- **Decision:** Only `poor` and `should_be_decorative` verdicts become `a11y-alt-quality` findings (moderate, WCAG 1.1.1, the suggestion stored in `data`). Then `groupFindings` runs again, and one explainer call covers the final top 15.
- **Consequences:** Explanations always match the final ranking. A scan with N candidates makes at most N + 1 successful calls (up to 9 by default), well under 25 even with repairs and one fallback.

## D26. Model choices for the free tiers (Phase 3)

- **Decision:** Gemini `gemini-3.8-flash` for text and vision. Groq `openai/gpt-oss-120b` for text only (Groq retired Llama 3.3 70B and Llama 4 Scout in 2026, and its vision options are preview-only). OpenRouter `google/gemma-4-31b-it:free` for both (accepts images and `response_format`). All set in env, nothing hardcoded.
- **Consequences:** Without Gemini, vision falls back to OpenRouter only. Free OpenRouter models churn: re-check the list when a 404 shows up in the trace.

## D27. `pnpm eval --llm`; with it, alt candidates no longer count toward recall (Phase 3, revisits D18)

- **Decision:** `--llm` runs the same `enrichReport()` as `pnpm scan --llm`. In that mode `alt_candidate` evidence is dropped, so an `a11y-alt-quality` issue counts only through a reviewer finding. `ground_truth.json` gains six `alt_cases`, each with the verdicts that count as correct: three bad alts and three good ones. The good alts are never candidates, so the eval sends them to the reviewer directly. Those extra calls are reported apart from the per-scan cost.
- **Alternatives:** Measure accuracy only on candidates (three cases, and it couldn't catch a reviewer that flags everything).
- **Consequences:** `pnpm eval` without `--llm` stays free and deterministic. With it, the run fails if accuracy < 5/6 or calls > 25. Each run costs about 9 to 12 LLM calls.

## D28. Two extra optional env vars and report fields (Phase 3)

- `MAX_LLM_OUTPUT_TOKENS_PER_SCAN` (default 20,000, the spec's number) and `LLM_TIMEOUT_MS` (default 20,000), so limits stay in env.
- `ScanReport` gains optional `issues[].explanation`, `altCandidates[].review`, `pages[].images` and `llm`. No DB schema change: these map to the existing `issues.title/explanation/who_is_affected/how_to_fix` columns in Phase 4.
- **At 10x traffic:** about 10 calls per scan means the default `DAILY_LLM_CALL_CAP=1000` covers about 100 scans a day. Free-tier daily limits (per provider, per key) hit first. The remedy is a paid Gemini Flash tier, roughly a few cents per scan at these token counts, not more free providers.

## D29. Turn reasoning off for a slow free model instead of raising the timeout (Phase 3)

- **Context:** With OpenRouter as the only provider, the free Gemma models answered 429 on every attempt. `nvidia/nemotron-3.5-super-vl:free` works and reads images, but the explainer's single 15-issue call took 29 to 45+ s, past the spec's 20 s timeout. Raising `LLM_TIMEOUT_MS` to 45 s was tried and still timed out. Measured on an explainer-sized request: with reasoning on, 41 s and 5,050 output tokens (3,548 of them hidden reasoning); with it off, 11 s and 1,500 tokens, all 15 items valid.
- **Decision:** Optional per-provider `<PROVIDER>_DISABLE_REASONING`. When true, the client adds OpenRouter's `reasoning: { enabled: false }` to that provider's requests. Set to true for OpenRouter in the local `.env`; `LLM_TIMEOUT_MS` stays at the spec's 20 s.
- **Alternatives:** A 90 s timeout (slow, unpredictable, about 3x the output tokens per scan); splitting the explainer into smaller calls (more calls against the 25-call budget); a different free model (the JSON-and-vision ones were rate-limited or less accurate).
- **Consequences:** Answers lose whatever the hidden reasoning added; the first explanations read fine, but this is what the "no invented facts" check should watch. The field is OpenRouter's format; another provider that rejected unknown fields would need its own variant, which is why it is off by default. At 10x traffic it saves roughly two-thirds of output tokens per scan on this model.

## D30. API check order: cache before the rate limit (Phase 4)

- **Context:** The spec lists "validation, SSRF pre-check, rate limit, cache, kill switch" for `POST /api/scans` without fixing the order. Verify item 4 wants a repeat URL to return the cached report "instantly".
- **Decision:** Kill switch → body + Turnstile → URL + SSRF guard → 24-hour cache → per-IP limit → insert. A cache hit inserts nothing, so it doesn't use up the IP's quota and still works for someone who hit the limit. The cache matches any non-failed scan of the same `normalized_url`, including one still running, so two people submitting the same site share one scan.
- **Alternatives:** Rate limit first (a cache hit would cost quota for zero work); SSRF before Turnstile (bots would get free DNS lookups).
- **Consequences:** The limit counts rows, so two simultaneous requests from one IP can both pass at count 4. That's acceptable on a 5/day limit; a unique-per-day constraint or an RPC with a lock would close it. The window is a rolling 24 hours, not a calendar day. **At 10x traffic:** both checks are single indexed count queries (`(requester_ip_hash, created_at)` and `(normalized_url, created_at)`), well within the Supabase free tier.

## D31. A graceful shutdown hands the in-flight scan back to the queue (Phase 4)

- **Context:** `docker stop` sends SIGTERM and kills after 10 s. The Phase 0 shutdown waited for the in-flight scan (minutes), so a restart always ended in SIGKILL and the scan sat until the 10-minute stale timeout in `claim_next_scan()`.
- **Decision:** On SIGTERM/SIGINT the worker releases the current scan: back to `queued` (keeping `attempts`) if it has an attempt left, otherwise `failed` with a "please submit it again" message. The update only touches rows still in an active status, so it can't undo a `done`. A retried attempt first deletes the previous attempt's pages, issues and steps, and screenshots are uploaded with `upsert`.
- **Alternatives:** Waiting for the scan (SIGKILLed anyway); an AbortSignal through the scanner (cleaner, but touches every scanner function for little gain); relying only on the stale timeout (correct, but 10 minutes of "scanning" on screen).
- **Consequences:** A planned restart costs one attempt, the same as a crash, matching the spec's "resumes, or fails cleanly after 2 attempts". A hard crash (`kill -9`, VM loss) still falls back to the 10-minute stale timeout. LLM calls from an interrupted attempt aren't in `agent_steps` (steps are written at the end), so the daily cap undercounts them slightly.

## D32. Report data comes from the tables, not a stored JSON blob (Phase 4)

- **Context:** The report needs things the six tables don't hold directly: per-page "needs human review" counts, axe help text and an example snippet per issue. The schema must not change without asking.
- **Decision:** `pages.axe_raw` gets an `incompleteByRule` key next to the raw axe output, and the API selects only `axe_raw->incompleteByRule`. Help text, help URL and example HTML come from the issue's first finding (`findings.data.help/helpUrl`, `html_snippet`). Pages are stored with `created_at` 1 ms apart so they come back in crawl order.
- **Alternatives:** A `report jsonb` column on `scans` (schema change, and duplicates every row); counting `axe_raw->incomplete` nodes (ships MBs of axe output per page view).
- **Consequences:** The web app maps rows to a view model in one pure function (`buildReport`, unit-tested), and `GET /api/scans/:id` stays a few KB. PostgREST returns at most 1,000 findings per query by default; a site that big would show page finding counts that are too low (issues are unaffected).

## D33. Screenshots: bucket created by the worker, signed URLs for 1 hour (Phase 4)

- **Decision:** The worker creates the private `screenshots` bucket at startup if it's missing, uploads `<scanId>/<nn>-<slug>.jpg`, and the API signs each path for 1 hour. A failed upload logs a warning and the page simply has no thumbnail.
- **Alternatives:** A migration inserting into `storage.buckets` (another manual SQL-editor step, D8); a public bucket (anyone could enumerate screenshots of other people's scans).
- **Consequences:** No manual setup on a new project. A report left open for over an hour shows broken thumbnails until it's refreshed. **At 10x traffic:** about 5 JPEGs of 100 to 500 KB per scan; 1,000 scans a day with 30-day retention is roughly 15 to 75 GB, past the 1 GB free Storage tier. Thumbnails would need downscaling or a shorter retention before then.

## D34. Bad Bakery is published with GitHub Pages; the worker image is Playwright's (Phase 4)

- **Decision:** `.github/workflows/bad-bakery-pages.yml` publishes `packages/fixtures/site` on pushes to `main` that touch it (push trigger only, `contents: read` + `pages: write`, no secrets). The fixture already uses relative links, so it works under `/a11yagent/`. The worker runtime image is `mcr.microsoft.com/playwright:v1.64.1-noble` (same version as the `playwright` package, as D16 planned), running as `pwuser`, with `init: true` and `shm_size: 1gb` in compose rather than `ipc: host`.
- **Alternatives:** Vercel/Netlify/Cloudflare Pages for the fixture (another account or project to manage); serving it from the Next.js app (production would then scan itself).
- **Consequences:** The image is about 1.5 GB, versus about 250 MB before. A GCP e2-micro (1 GB RAM) is tight for Chromium plus Node; add swap, or expect to need a 2 GB VM.
