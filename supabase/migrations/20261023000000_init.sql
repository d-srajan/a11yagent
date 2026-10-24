-- Phase 0: all tables, RLS, and the job-queue claim function.
-- Tables, indexes and RLS statements match SPEC.md "Data model" exactly.

create table scans (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  normalized_url text not null,            -- origin + path, lowercased host, no hash
  status text not null default 'queued'
    check (status in ('queued','crawling','scanning','analyzing','fixing','done','failed')),
  progress jsonb not null default '{}',     -- {pagesFound, pagesScanned, issuesFound, fixesVerified}
  options jsonb not null default '{}',      -- {maxPages, includeFixes}
  requester_ip_hash text,
  claimed_at timestamptz,
  attempts int not null default 0,
  error text,
  llm_calls int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on scans (status, created_at);
create index on scans (normalized_url, created_at desc);
create index on scans (requester_ip_hash, created_at desc);

create table pages (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  url text not null,
  title text,
  http_status int,
  screenshot_path text,                     -- Supabase Storage path
  axe_raw jsonb,                            -- full axe results, for debugging
  keyboard_result jsonb,                    -- focus sequence from the keyboard walk
  created_at timestamptz not null default now()
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  page_id uuid not null references pages(id) on delete cascade,
  source text not null check (source in ('axe','keyboard','alt_review')),
  rule_id text not null,                    -- axe rule id or a11y-* id
  impact text not null check (impact in ('critical','serious','moderate','minor')),
  wcag text[] not null default '{}',
  selector text not null,
  html_snippet text,
  message text,
  data jsonb not null default '{}'
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  rule_id text not null,
  group_key text not null,                  -- rule_id + normalized selector pattern
  impact text not null,
  severity_score numeric not null,
  rank int not null,
  occurrence_count int not null,
  page_count int not null,
  finding_ids uuid[] not null,
  title text,                               -- filled by explainer agent
  explanation text,
  who_is_affected text,
  how_to_fix text,
  fix_status text not null default 'not_attempted'
    check (fix_status in ('not_attempted','verified','unverified','not_fixable'))
);

create table fixes (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  finding_id uuid not null references findings(id) on delete cascade,
  attempt int not null,
  patch jsonb not null,                     -- structured DomPatch, never code
  before_html text,
  after_html text,
  css text,
  verified boolean not null default false,
  verification jsonb,                       -- verify() output that justified the badge
  created_at timestamptz not null default now()
);

create table agent_steps (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans(id) on delete cascade,
  issue_id uuid references issues(id) on delete cascade,
  agent text not null,                      -- explainer | alt_reviewer | fixer
  step int not null,
  kind text not null check (kind in ('llm','tool')),
  name text not null,                       -- tool name or model call label
  input jsonb,
  output jsonb,
  provider text,
  model text,
  prompt_version text,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);

-- RLS on, zero policies: anon and authenticated roles see and change nothing.
-- Only the service role (worker + Next.js server code) bypasses RLS.
alter table scans enable row level security;
alter table pages enable row level security;
alter table findings enable row level security;
alter table issues enable row level security;
alter table fixes enable row level security;
alter table agent_steps enable row level security;

-- Atomically hands one scan to one worker.
-- Eligible: the oldest 'queued' scan, or a scan stuck in a non-terminal status
-- whose claim is older than 10 minutes (its worker probably died) and that has
-- had fewer than 2 attempts. Stuck scans that already used both attempts are
-- marked 'failed' first, so they never sit in limbo.
-- FOR UPDATE SKIP LOCKED: concurrent callers skip rows another transaction is
-- claiming instead of waiting or double-claiming.
create or replace function claim_next_scan()
returns setof scans
language plpgsql
set search_path = public
as $$
declare
  claimed scans;
begin
  update scans
     set status = 'failed',
         error = coalesce(error, 'Abandoned after 2 attempts'),
         finished_at = now()
   where id in (
     select id from scans
      where status in ('crawling','scanning','analyzing','fixing')
        and claimed_at < now() - interval '10 minutes'
        and attempts >= 2
      for update skip locked
   );

  select * into claimed
    from scans
   where status = 'queued'
      or (status in ('crawling','scanning','analyzing','fixing')
          and claimed_at < now() - interval '10 minutes'
          and attempts < 2)
   order by created_at
   limit 1
   for update skip locked;

  if not found then
    return;
  end if;

  update scans
     set claimed_at = now(),
         attempts = attempts + 1,
         status = 'crawling'
   where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

-- RLS does not protect functions, and Supabase grants EXECUTE on new public
-- functions to anon and authenticated by default. Only the worker may claim.
revoke execute on function claim_next_scan() from public, anon, authenticated;
grant execute on function claim_next_scan() to service_role;
