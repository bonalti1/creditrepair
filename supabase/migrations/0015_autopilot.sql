-- Piloto automático: what the system does by itself, and its record.
--
-- The console used to ask a person to remind clients (sign the agreement,
-- upload documents, finish the review, check the monitoring, add a payment
-- method) and to mail every prepared round by hand. With these tables the
-- system writes the reminders on a short schedule, tells the client what
-- happened (letters mailed, delivered, a new report, a receipt) and mails a
-- round that passed every gate after a review window, unless a person holds
-- it (src/lib/autopilot, docs/AUTOPILOT.md).
--
--   autopilot_settings      the team's switches. One row. Everything new
--                           starts OFF: automatic sending of rounds and
--                           automatic reminders run only once an
--                           administrator turns them on.
--   outbound_messages       every automatic message: one row per message,
--                           with a unique dedupe key, so a run that repeats
--                           (a retry, two runs at once) never writes or sends
--                           the same message twice. Append-only: the words
--                           never change; only the delivery result is filled
--                           in, once (queued → sending → sent | failed, or
--                           queued → cancelled).
--   message_opt_outs        "BAJA" / "STOP" / an unsubscribe link, and "ALTA"
--                           / "START" to come back. Append-only; the newest
--                           record of a client decides.
--   autopilot_holds         a teammate stops the automatic sending and the
--                           reminders for one client, with a reason. Released
--                           once, never deleted.
--   autopilot_ready_rounds  when the system first saw a round ready to send,
--                           with those letters (plan_key). The review window
--                           counts from here; different letters, a new window.
--
-- Who writes: only the server, with the service role (the autopilot run
-- /api/cron/autopilot, the inbound WhatsApp webhook, the unsubscribe link and
-- the staff routes after checking the caller's role). Nobody gets an insert,
-- update or delete policy. Staff read by role (the scopes of migration 0012);
-- a client reads their own messages and opt-outs.

-- ── Settings ───────────────────────────────────────────────────────────

create table public.autopilot_settings (
  id boolean primary key default true check (id),
  rounds_enabled boolean not null default false,
  review_window_hours integer not null default 24 check (review_window_hours between 1 and 168),
  followups_enabled boolean not null default false,
  -- {"agreement_unsigned": true, ...}: each situation on or off. A missing key is on.
  followups jsonb not null default '{}' check (jsonb_typeof(followups) = 'object'),
  status_enabled boolean not null default true,
  quiet_start_hour smallint not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour smallint not null default 8 check (quiet_end_hour between 0 and 23),
  daily_cap smallint not null default 2 check (daily_cap between 1 and 5),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80)
);

insert into public.autopilot_settings (id) values (true);

alter table public.autopilot_settings enable row level security;

create policy "staff read autopilot settings" on public.autopilot_settings
  for select using (public.is_staff());

-- A change to the switches is recorded in the team's audit (admin-only read).
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added', 'autopilot_changed'
));

-- ── Outbound messages ──────────────────────────────────────────────────

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "followup:<client>:<situation>:<step>" or "status:<client>:<what>:<which>".
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 240),
  kind text not null check (kind in ('followup', 'status')),
  topic text not null check (topic ~ '^[a-z_]{2,40}$'),
  step smallint check (step is null or step between 1 and 10),
  -- Never 'sms': text messages are only for login codes (docs/AUTOPILOT.md).
  channel text check (channel is null or channel in ('whatsapp', 'email')),
  template text check (template is null or template ~ '^[a-z0-9_]{2,120}$'),
  params jsonb not null default '[]' check (jsonb_typeof(params) = 'array'),
  locale text not null default 'es' check (locale in ('es', 'en')),
  body text not null check (char_length(body) between 1 and 4000),
  link text check (link is null or char_length(link) <= 500),
  status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  note text check (note is null or char_length(note) <= 300),
  constraint outbound_step_matches_kind check ((kind = 'followup') = (step is not null)),
  constraint outbound_channel_once_claimed check (status in ('queued', 'cancelled') or channel is not null)
);

create index outbound_messages_user_idx on public.outbound_messages (user_id, queued_at);
create index outbound_messages_queued_idx on public.outbound_messages (status, queued_at) where status = 'queued';

alter table public.outbound_messages enable row level security;

create policy "staff read outbound messages" on public.outbound_messages
  for select using (public.staff_can_see_case(user_id));

create policy "own outbound messages" on public.outbound_messages
  for select using (auth.uid() = user_id);

-- The words, the client, the key and the kind never change. The delivery
-- result moves forward once: queued → sending | cancelled, sending → sent | failed.
create function public.outbound_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'outbound_messages: a message record cannot be deleted';
    end if;
    return old;
  end if;
  if new.user_id <> old.user_id or new.dedupe_key <> old.dedupe_key or new.kind <> old.kind or new.topic <> old.topic
     or new.step is distinct from old.step or new.body <> old.body or new.locale <> old.locale
     or new.link is distinct from old.link or new.params <> old.params or new.queued_at <> old.queued_at then
    raise exception 'outbound_messages: a message cannot be rewritten';
  end if;
  if not (
       (old.status = 'queued' and new.status in ('sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'failed'))
  ) then
    raise exception 'outbound_messages: % cannot become %', old.status, new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.outbound_messages_guard() from public;

create trigger outbound_messages_guard
  before update or delete on public.outbound_messages
  for each row execute function public.outbound_messages_guard();

-- ── Opt-outs ───────────────────────────────────────────────────────────

create table public.message_opt_outs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  -- For a number with no account yet.
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('opt_out', 'opt_in')),
  -- How it arrived: a WhatsApp keyword, the email unsubscribe link, or a teammate who heard it from the client.
  channel text not null check (channel in ('whatsapp', 'email', 'staff')),
  keyword text check (keyword is null or char_length(keyword) between 1 and 40),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text check (recorded_by_name is null or char_length(recorded_by_name) between 1 and 80),
  at timestamptz not null default now(),
  constraint message_opt_outs_subject check (user_id is not null or phone_e164 is not null)
);

create index message_opt_outs_user_idx on public.message_opt_outs (user_id, at) where user_id is not null;

alter table public.message_opt_outs enable row level security;

-- Sales follows people before the work starts: they see an opt-out too.
create policy "staff read opt-outs" on public.message_opt_outs
  for select using (user_id is not null and public.staff_can_see_client(user_id));

create policy "own opt-outs" on public.message_opt_outs
  for select using (auth.uid() = user_id);

-- ── Holds ──────────────────────────────────────────────────────────────

create table public.autopilot_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  held_at timestamptz not null default now(),
  held_by uuid references auth.users (id) on delete set null,
  held_by_name text not null check (char_length(held_by_name) between 1 and 80),
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  released_by_name text check (released_by_name is null or char_length(released_by_name) between 1 and 80),
  constraint autopilot_holds_release_pair check ((released_at is null) = (released_by_name is null)),
  constraint autopilot_holds_release_after check (released_at is null or released_at >= held_at)
);

-- One open hold per client.
create unique index autopilot_holds_open on public.autopilot_holds (user_id) where released_at is null;

alter table public.autopilot_holds enable row level security;

create policy "staff read holds" on public.autopilot_holds
  for select using (public.staff_can_see_case(user_id));

-- A hold is released once and is otherwise never edited or deleted.
create function public.autopilot_holds_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'autopilot_holds: a hold cannot be deleted';
    end if;
    return old;
  end if;
  if old.released_at is not null then
    raise exception 'autopilot_holds: a released hold cannot be changed';
  end if;
  if new.user_id <> old.user_id or new.reason <> old.reason or new.held_at <> old.held_at
     or new.held_by is distinct from old.held_by or new.held_by_name <> old.held_by_name then
    raise exception 'autopilot_holds: only the release can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.autopilot_holds_guard() from public;

create trigger autopilot_holds_guard
  before update or delete on public.autopilot_holds
  for each row execute function public.autopilot_holds_guard();

-- ── Rounds seen ready ──────────────────────────────────────────────────

create table public.autopilot_ready_rounds (
  user_id uuid not null references auth.users (id) on delete cascade,
  round_number integer not null check (round_number between 1 and 100),
  -- A short key of the round's letters (src/lib/autopilot/sending.ts: roundPlanKey).
  plan_key text not null check (plan_key ~ '^p[0-9a-f]{8}[0-9]{1,3}$'),
  first_ready_at timestamptz not null default now(),
  primary key (user_id, round_number, plan_key)
);

alter table public.autopilot_ready_rounds enable row level security;

create policy "staff read ready rounds" on public.autopilot_ready_rounds
  for select using (public.staff_can_see_case(user_id));

-- Opt-outs and rounds seen ready are records: never edited, deleted only with the account.
create function public.autopilot_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '%: a record cannot be changed', tg_table_name;
  end if;
  if old.user_id is not null and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  if old.user_id is null and tg_table_name = 'message_opt_outs' then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  return old;
end;
$$;

revoke all on function public.autopilot_append_only() from public;

create trigger message_opt_outs_append_only
  before update or delete on public.message_opt_outs
  for each row execute function public.autopilot_append_only();

create trigger autopilot_ready_rounds_append_only
  before update or delete on public.autopilot_ready_rounds
  for each row execute function public.autopilot_append_only();
