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
