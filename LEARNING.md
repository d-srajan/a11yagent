# Learning log

## Phase 0: Scaffold and skeleton

### In my own words

<!-- Write three sentences here explaining what you built, before ticking the Phase 0 checklist. -->

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
