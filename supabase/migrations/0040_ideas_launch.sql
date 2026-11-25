-- Ideas & experiments, and Launch readiness (docs/IDEAS.md, docs/LAUNCH.md).
--
--   ideas             The team's ideas board: New → Approved → Testing →
--                     Kept / Dropped (with what was learned), or Not now.
--                     A finished test is a learning (the learnings library).
--   idea_events       Who moved an idea, from what to what, when. Append-only.
--   idea_alti_runs    Each time Alti (the AI assistant) was asked for ideas,
--                     by a person or by the weekly job: when, the aggregate
--                     numbers it read (never a client's name or data), and
--                     how many proposals passed the checks.
--   idea_proposals    What Alti proposed: open until an administrator adds
--                     one to the board or dismisses it. Never acted on by
--                     itself.
--   launch_ticks      The owner's ticks on the launch checklist for what the
--                     software cannot detect (the attorney's review session,
--                     the test pass…). Append-only: each tick or untick is a
--                     row; the newest per item is its state, with who and when.
--   launch_probes     The last result of each "Check now" on the system
--                     health view, per service: ok or not, a short code,
--                     when, by whom. Never a key, a key's length or prefix,
--                     or a provider's answer.
--
-- Who reads: ideas and idea_events, every active member of staff (is_staff());
-- proposals and runs (they carry business numbers), ticks and probes, only
-- active administrators. Clients, partners and anonymous visitors read
-- nothing. Who writes: only the server with the service role, after
-- requireCapability ('ideas.add', 'ideas.approve', 'launch'); there is no
-- insert, update or delete policy for anyone. The status order of an idea is
-- checked again here by a trigger, for every writer.

-- ── Ideas ───────────────────────────────────────────────────────────────

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  why text not null check (char_length(btrim(why)) between 10 and 1000),
  -- The same keys as src/lib/ideas/types.ts (a test keeps them equal).
  department text not null check (department in ('content', 'leads', 'clients', 'support', 'money', 'letters', 'partners', 'tech')),
  metric text not null check (metric ~ '^[a-z0-9_]{2,40}$'),
  expected_effect text not null check (char_length(btrim(expected_effect)) between 3 and 200),
  effort text not null check (effort in ('S', 'M', 'L')),
  status text not null default 'new' check (status in ('new', 'approved', 'testing', 'kept', 'dropped', 'declined')),
  source text not null default 'team' check (source in ('team', 'alti')),
  proposal_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by_name text check (approved_by_name is null or char_length(approved_by_name) <= 80),
  approved_at timestamptz,
  test_days integer check (test_days is null or test_days between 7 and 90),
  test_started_at timestamptz,
  test_ends_at timestamptz,
  decided_by_name text check (decided_by_name is null or char_length(decided_by_name) <= 80),
  decided_at timestamptz,
  -- What was learned (kept, dropped), or why not now (declined).
  result_note text check (result_note is null or char_length(btrim(result_note)) between 3 and 2000),
  constraint ideas_testing_has_length check (status not in ('testing', 'kept', 'dropped') or (test_days is not null and test_started_at is not null and test_ends_at is not null)),
  constraint ideas_result_has_learning check (status not in ('kept', 'dropped') or (result_note is not null and char_length(btrim(result_note)) >= 10 and decided_at is not null)),
  constraint ideas_approved_has_who check (status not in ('approved', 'testing', 'kept', 'dropped') or approved_at is not null)
);

create index ideas_status_idx on public.ideas (status, updated_at desc);

-- The order: new → approved | declined; approved → testing | declined;
-- testing → kept | dropped. Kept, dropped and declined are final. While an
-- idea is new, its words may be edited; after that only the server's fields
-- for the next step change. Nothing is ever deleted.
create function public.ideas_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ideas: an idea is a record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'new' then
      raise exception 'ideas: a new idea starts as new';
    end if;
    return new;
  end if;
  if old.status in ('kept', 'dropped', 'declined') then
    raise exception 'ideas: % is final', old.status;
  end if;
  if new.status <> old.status and not (
    (old.status = 'new' and new.status in ('approved', 'declined'))
    or (old.status = 'approved' and new.status in ('testing', 'declined'))
    or (old.status = 'testing' and new.status in ('kept', 'dropped'))
  ) then
    raise exception 'ideas: cannot go from % to %', old.status, new.status;
  end if;
  if old.status <> 'new' and (new.title is distinct from old.title or new.why is distinct from old.why or new.department is distinct from old.department
      or new.metric is distinct from old.metric or new.expected_effect is distinct from old.expected_effect or new.effort is distinct from old.effort) then
    raise exception 'ideas: the words are kept as they were approved';
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.source is distinct from old.source
      or new.proposal_id is distinct from old.proposal_id then
    raise exception 'ideas: who and when it was added cannot change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.ideas_guard() from public;

create trigger ideas_guard
  before insert or update or delete on public.ideas
  for each row execute function public.ideas_guard();

alter table public.ideas enable row level security;

create policy "staff read ideas" on public.ideas
  for select using (public.is_staff());

-- ── What happened to each idea ──────────────────────────────────────────

create table public.idea_events (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete restrict,
  action text not null check (action in ('added', 'edited', 'approved', 'declined', 'started', 'kept', 'dropped')),
  from_status text check (from_status is null or from_status in ('new', 'approved', 'testing')),
  to_status text not null check (to_status in ('new', 'approved', 'testing', 'kept', 'dropped', 'declined')),
  by_user uuid references auth.users (id) on delete set null,
  by_name text not null default '' check (char_length(by_name) <= 80),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index idea_events_idea_idx on public.idea_events (idea_id, created_at);

create function public.ideas_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: this record is kept as it was; it cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.ideas_append_only() from public;

create trigger idea_events_append_only
  before update or delete on public.idea_events
  for each row execute function public.ideas_append_only();

alter table public.idea_events enable row level security;

create policy "staff read idea events" on public.idea_events
  for select using (public.is_staff());

-- ── Alti's proposals ────────────────────────────────────────────────────

create table public.idea_alti_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trigger text not null check (trigger in ('person', 'cron')),
  by_user uuid references auth.users (id) on delete set null,
  by_name text not null default '' check (char_length(by_name) <= 80),
  status text not null check (status in ('ok', 'failed')),
  model text check (model is null or char_length(model) <= 60),
  -- The aggregate numbers Alti read (src/lib/ideas/signals.ts): keys, values and the window. No names, no client data.
  signals jsonb not null default '[]' check (jsonb_typeof(signals) = 'array' and octet_length(signals::text) <= 20000),
  proposed integer not null default 0 check (proposed between 0 and 10),
  -- Proposals that failed the checks (claim rules, a number typed by the model, a repeat) and were not kept.
  dropped integer not null default 0 check (dropped between 0 and 20),
  problem text check (problem is null or char_length(problem) <= 120)
);

create index idea_alti_runs_created_idx on public.idea_alti_runs (created_at desc);

create trigger idea_alti_runs_append_only
  before update or delete on public.idea_alti_runs
  for each row execute function public.ideas_append_only();

alter table public.idea_alti_runs enable row level security;

create policy "admin read alti runs" on public.idea_alti_runs
  for select using (public.staff_role() = 'admin');

create table public.idea_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.idea_alti_runs (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  why text not null check (char_length(btrim(why)) between 10 and 1000),
  department text not null check (department in ('content', 'leads', 'clients', 'support', 'money', 'letters', 'partners', 'tech')),
  metric text not null check (metric ~ '^[a-z0-9_]{2,40}$'),
  expected_effect text not null check (char_length(btrim(expected_effect)) between 3 and 200),
  effort text not null check (effort in ('S', 'M', 'L')),
  test_days integer not null check (test_days between 7 and 90),
  -- The numbers it is based on, as the server read them (never typed by the model): [{key, value, display}].
  based_on jsonb not null check (jsonb_typeof(based_on) = 'array' and jsonb_array_length(based_on) between 1 and 6 and octet_length(based_on::text) <= 4000),
  status text not null default 'open' check (status in ('open', 'added', 'dismissed')),
  idea_id uuid references public.ideas (id) on delete restrict,
  decided_by_name text check (decided_by_name is null or char_length(decided_by_name) <= 80),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint idea_proposals_added_has_idea check ((status = 'added') = (idea_id is not null)),
  constraint idea_proposals_decided check ((status = 'open') = (decided_at is null))
);

create index idea_proposals_status_idx on public.idea_proposals (status, created_at desc);

-- A proposal is decided once: open → added | dismissed. Its words never change.
create function public.idea_proposals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'idea_proposals: a proposal is a record and cannot be deleted';
  end if;
  if old.status <> 'open' then
    raise exception 'idea_proposals: decided once';
  end if;
  if new.title is distinct from old.title or new.why is distinct from old.why or new.based_on is distinct from old.based_on
      or new.metric is distinct from old.metric or new.test_days is distinct from old.test_days or new.run_id is distinct from old.run_id
      or new.department is distinct from old.department or new.expected_effect is distinct from old.expected_effect or new.effort is distinct from old.effort then
    raise exception 'idea_proposals: what Alti proposed is kept as it was';
  end if;
  return new;
end;
$$;

revoke all on function public.idea_proposals_guard() from public;

create trigger idea_proposals_guard
  before update or delete on public.idea_proposals
  for each row execute function public.idea_proposals_guard();

alter table public.idea_proposals enable row level security;

create policy "admin read alti proposals" on public.idea_proposals
  for select using (public.staff_role() = 'admin');

alter table public.ideas
  add constraint ideas_proposal_fk foreign key (proposal_id) references public.idea_proposals (id) on delete restrict;

-- ── Launch readiness ────────────────────────────────────────────────────

create table public.launch_ticks (
  id uuid primary key default gen_random_uuid(),
  -- An item of src/lib/launch/checklist.ts that is ticked by hand.
  item text not null check (item ~ '^[a-z0-9_]{2,60}$'),
  done boolean not null,
  by_user uuid references auth.users (id) on delete set null,
  by_name text not null default '' check (char_length(by_name) <= 80),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index launch_ticks_item_idx on public.launch_ticks (item, created_at desc);

create trigger launch_ticks_append_only
  before update or delete on public.launch_ticks
  for each row execute function public.ideas_append_only();

alter table public.launch_ticks enable row level security;

create policy "admin read launch ticks" on public.launch_ticks
  for select using (public.staff_role() = 'admin');

create table public.launch_probes (
  -- A service of src/lib/launch/probes.ts.
  service text primary key check (service ~ '^[a-z0-9_]{2,40}$'),
  checked_at timestamptz not null,
  ok boolean not null,
  -- A short code ("ok", "refused", "unreachable", "off", …), never a provider's words.
  code text not null check (code ~ '^[a-z_]{2,30}$'),
  -- The HTTP status of the provider's answer, when there was one.
  http_status integer check (http_status is null or http_status between 100 and 599),
  by_name text not null default '' check (char_length(by_name) <= 80)
);

alter table public.launch_probes enable row level security;

create policy "admin read launch probes" on public.launch_probes
  for select using (public.staff_role() = 'admin');
