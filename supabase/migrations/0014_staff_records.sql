-- The staff console on the database: what the team records that had no
-- table yet, and a few facts about rounds and reports the console shows.
--
-- Until now the console ran only on invented clients (src/lib/staff/data.ts).
-- Its database version reads the tables of 0001-0013 through each member's own
-- connection, so the role-scoped "staff read" policies of migration 0012
-- decide what each person sees. This migration adds what those tables could
-- not hold:
--
--   staff_notes       a teammate's note on a client. Readable by every member
--                     who may see the client (staff_can_see_client): sales
--                     follows up too. Never shown to the client.
--   exception_marks   "marked as handled" on one of the console's notices
--                     (src/lib/staff/stage.ts: clientExceptions). Same scope.
--   report_samples    a report page kept as received, for a provider that has
--                     no reader yet. Part of the case (staff_can_see_case):
--                     not for sales, not for the client.
--   report_pulls      who brought a report in, with which reader, and what it
--                     changed (the console's "Reportes importados").
--   attack_rounds     who sent a round and how (mail service or printed in the
--                     office), when the bureaus' answers came back, and the
--                     items a later report no longer lists (round results).
--
-- Who writes: only the server, with the service role, after checking the
-- caller's role (src/app/api/staff/*). No member of staff and no client gets
-- an insert, update or delete policy on any table here. Notes, handled marks
-- and samples are records: they cannot be edited or deleted, except together
-- with the client's account.

-- ── Notes ──────────────────────────────────────────────────────────────

create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  -- The client the note is about: one with an account, or a person sales added by hand.
  user_id uuid references auth.users (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete cascade,
  author uuid references auth.users (id) on delete set null,
  -- The teammate's handle as the console shows it ("marta").
  author_name text not null check (char_length(author_name) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint staff_notes_one_subject check ((user_id is null) <> (prospect_id is null))
);

create index staff_notes_user_idx on public.staff_notes (user_id, created_at) where user_id is not null;
create index staff_notes_prospect_idx on public.staff_notes (prospect_id, created_at) where prospect_id is not null;

alter table public.staff_notes enable row level security;

-- A prospect's notes follow the prospect's own read policy (migration 0012).
create policy "staff read notes" on public.staff_notes
  for select using (
    (user_id is not null and public.staff_can_see_client(user_id))
    or (prospect_id is not null and exists (select 1 from public.prospects p where p.id = prospect_id))
  );

-- ── Handled marks ──────────────────────────────────────────────────────

create table public.exception_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The notice's key: its kind, and for some kinds what it is about
  -- ("documents_missing", "payment_past_due:<charge id>", "question:<id>").
  exception_key text not null check (char_length(exception_key) between 2 and 200 and exception_key ~ '^[a-z_]{2,40}(:|$)'),
  handled_at timestamptz not null default now(),
  handled_by uuid references auth.users (id) on delete set null,
  handled_by_name text not null default '' check (char_length(handled_by_name) <= 80)
);

create index exception_marks_user_idx on public.exception_marks (user_id, handled_at);

alter table public.exception_marks enable row level security;

create policy "staff read exception marks" on public.exception_marks
  for select using (public.staff_can_see_client(user_id));

-- ── Report samples ─────────────────────────────────────────────────────

create table public.report_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Reader key of the provider it came from (src/lib/reports/readers.ts).
  provider text not null check (provider ~ '^[a-z0-9_]{2,40}$'),
  file_name text check (file_name is null or char_length(file_name) <= 200),
  -- The text exactly as received. Nothing is read from it. Up to 5 MB.
  body text not null check (octet_length(body) between 1 and 5242880),
  saved_by uuid references auth.users (id) on delete set null,
  saved_by_name text not null default '' check (char_length(saved_by_name) <= 80),
  saved_at timestamptz not null default now()
);

create index report_samples_user_idx on public.report_samples (user_id, saved_at);

alter table public.report_samples enable row level security;

create policy "staff read report samples" on public.report_samples
  for select using (public.staff_can_see_case(user_id));

-- ── Records stay as written ────────────────────────────────────────────
-- A delete is allowed only when the client's account (or the prospect) itself
-- is being deleted (the cascade), never on its own.

create function public.staff_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '%: a record cannot be changed', tg_table_name;
  end if;
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  if tg_table_name = 'staff_notes' and exists (select 1 from public.prospects p where p.id = (to_jsonb(old) ->> 'prospect_id')::uuid) then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  return old;
end;
$$;

revoke all on function public.staff_records_append_only() from public;

create trigger staff_notes_append_only
  before update or delete on public.staff_notes
  for each row execute function public.staff_records_append_only();

create trigger exception_marks_append_only
  before update or delete on public.exception_marks
  for each row execute function public.staff_records_append_only();

create trigger report_samples_append_only
  before update or delete on public.report_samples
  for each row execute function public.staff_records_append_only();

-- ── Who imported a report ──────────────────────────────────────────────
-- Empty on a report the monitoring pull brought in by itself.

alter table public.report_pulls
  add column imported_by uuid references auth.users (id) on delete set null,
  add column imported_by_name text check (imported_by_name is null or char_length(imported_by_name) between 1 and 80),
  add column reader_key text check (reader_key is null or reader_key ~ '^[a-z0-9_]{2,40}$'),
  -- {"removed": n, "added": n, "changed": n, "closedRound": n | null}
  add column import_summary jsonb check (import_summary is null or jsonb_typeof(import_summary) = 'object');

-- ── Rounds: who sent them, and what came back ──────────────────────────

alter table public.attack_rounds
  add column sent_by uuid references auth.users (id) on delete set null,
  add column sent_by_name text check (sent_by_name is null or char_length(sent_by_name) between 1 and 80),
  -- "mail": through the mail service (Lob, or simulated without a key). "print": printed in the office.
  add column mail_via text check (mail_via is null or mail_via in ('mail', 'print')),
  -- When a report dated after the response window was imported: the bureaus' answers are in.
  add column responded_at timestamptz,
  -- [{"fingerprint": "...", "outcome": "removed", "reportDate": "..."}]: items of this
  -- round a later report no longer lists. Only what a report proves by itself.
  add column results jsonb not null default '[]' check (jsonb_typeof(results) = 'array'),
  add constraint attack_rounds_responded_after_mailing check (responded_at is null or (mailed_at is not null and responded_at >= mailed_at));
