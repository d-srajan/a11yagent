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
