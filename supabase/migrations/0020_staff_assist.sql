-- The one-person console: saved answers, the morning summary, and each
-- member's own preferences (docs/STAFF.md).
--
--   saved_answers          the library of approved answers to questions
--                          clients keep asking. Written only by the server
--                          (POST /api/staff/answers), after the role check:
--                          an administrator's goes in approved; a specialist's
--                          goes in proposed until an administrator approves it.
--                          AltiBot (/api/coach) may send an APPROVED answer to
--                          a client by itself, and checks the claim rules again
--                          first. Read by admins and specialists; a proposal
--                          only by admins and the person who proposed it.
--   saved_answer_events    every save, edit, approval and deletion, with the
--                          words as they were. Append-only: what AltiBot could
--                          say on a given day can always be traced.
--   staff_preferences      one row per member: the morning summary (on/off,
--                          channel, time, time zone) and the first-day
--                          checklist. Read by the member; written by the server.
--   staff_digests          one row per member per local day: the morning
--                          summary claimed before it is sent (the unique key
--                          is what makes it go once). Never SMS.
--
-- Staff have no write policy on any of these: every write is a server route
-- that checked the member's role first.

-- ── Saved answers ───────────────────────────────────────────────────────

create table public.saved_answers (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(btrim(question)) between 8 and 500),
  answer text not null check (char_length(btrim(answer)) between 20 and 4000),
  status text not null default 'proposed' check (status in ('proposed', 'approved')),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null check (char_length(created_by_name) between 1 and 80),
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_name text check (approved_by_name is null or char_length(approved_by_name) between 1 and 80),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Approved means an administrator's name and the moment are on record; proposed means neither.
  constraint saved_answers_approval check ((status = 'approved') = (approved_at is not null and approved_by_name is not null))
);

create index saved_answers_status_idx on public.saved_answers (status, updated_at desc);

alter table public.saved_answers enable row level security;

create policy "staff read approved answers" on public.saved_answers
  for select using (status = 'approved' and public.staff_role() in ('admin', 'specialist'));

create policy "staff read proposed answers" on public.saved_answers
  for select using (status = 'proposed' and (public.staff_role() = 'admin' or created_by = auth.uid()));

create function public.saved_answers_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  return new;
end;
$$;

create trigger saved_answers_touch
  before update on public.saved_answers
  for each row execute function public.saved_answers_touch();

create table public.saved_answer_events (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null,
  kind text not null check (kind in ('saved', 'edited', 'approved', 'deleted')),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null,
  question text not null,
  answer text not null,
  status text not null check (status in ('proposed', 'approved')),
  created_at timestamptz not null default now()
);

create index saved_answer_events_answer_idx on public.saved_answer_events (answer_id, created_at);

alter table public.saved_answer_events enable row level security;

create policy "admins read answer history" on public.saved_answer_events
  for select using (public.staff_role() = 'admin');

create function public.saved_answer_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'saved_answer_events: a record cannot be changed or deleted';
end;
$$;

create trigger saved_answer_events_append_only
  before update or delete on public.saved_answer_events
  for each row execute function public.saved_answer_events_append_only();

-- ── Each member's preferences ───────────────────────────────────────────

create table public.staff_preferences (
  user_id uuid primary key references public.staff_members (user_id) on delete cascade,
  digest_enabled boolean not null default false,
  digest_channel text not null default 'whatsapp' check (digest_channel in ('whatsapp', 'email')),
  digest_time text not null default '08:30' check (digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text not null default 'America/Chicago' check (time_zone ~ '^[A-Za-z_]+/[A-Za-z_]+$'),
  checklist_dismissed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.staff_preferences enable row level security;

create policy "own staff preferences read" on public.staff_preferences
  for select using (auth.uid() = user_id);

-- ── The morning summary, once per member per day ────────────────────────

create table public.staff_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  local_day date not null,
  -- Never 'sms': text messages are only for login codes.
  channel text check (channel in ('whatsapp', 'email')),
  status text not null check (status in ('sending', 'sent', 'failed')),
  body text not null,
  note text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, local_day)
);

alter table public.staff_digests enable row level security;

create policy "own staff digests read" on public.staff_digests
  for select using (auth.uid() = user_id or public.staff_role() = 'admin');

-- The words are what was sent: only the status moves forward, from sending.
create function public.staff_digests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.staff_members m where m.user_id = old.user_id) then
      raise exception 'staff_digests: a record cannot be deleted';
    end if;
    return old;
  end if;
  if new.body is distinct from old.body or new.user_id <> old.user_id or new.local_day <> old.local_day or new.created_at <> old.created_at then
    raise exception 'staff_digests: what was sent cannot be changed';
  end if;
  if old.status <> 'sending' then
    raise exception 'staff_digests: a finished record cannot be changed';
  end if;
  return new;
end;
$$;

create trigger staff_digests_guard
  before update or delete on public.staff_digests
  for each row execute function public.staff_digests_guard();

revoke all on function public.saved_answers_touch() from public;
revoke all on function public.saved_answer_events_append_only() from public;
revoke all on function public.staff_digests_guard() from public;
