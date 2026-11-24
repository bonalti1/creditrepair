-- The chat signup's case reference, and calls with a person (docs/SIGNUP-CHAT.md).
--
--   signup_cases   One row per signup started in the chat with Alti
--                  (/registro). Its case reference ("CR-7KQ4M": "CR-" and
--                  five characters with no look-alikes, no 0/O, 1/I/L, U/V)
--                  is shown to the person from the first screen and carried
--                  by everything that follows, so staff can find the signup
--                  by it. The server creates the row for an anonymous
--                  visitor and keeps the step they reached, their state and
--                  language; nothing else about the person is stored here.
--                  The device resumes with a random token kept only as its
--                  SHA-256. The row is linked to the account (user_id) once
--                  the person signs in with their phone, and then the
--                  existing records (profile, agreement, documents) hold the
--                  rest.
--
-- Calls ("Talk to a person first" → "Schedule a call"). Built, and OFF by
-- default (NEXT_PUBLIC_CALLS_ENABLED). A call is for QUESTIONS ONLY: signing
-- up and any payment happen afterwards, in writing, in the app, never on the
-- call (Telemarketing Sales Rule, 16 C.F.R. 310.4(a)(2): credit repair sold
-- by telephone may not be paid for until results are shown on a report issued
-- more than six months later; the general-media exemption does not apply to
-- credit repair, 310.6(b)(5)). The attorney's question is in docs/SALES-FLOW.md.
--
--   call_windows   When the team takes calls: a start and an end, cut into
--                  slots of a fixed length, set in /equipo/llamadas by a member
--                  with "calls.manage". Removed, never deleted or edited.
--   call_bookings  One slot booked by one person, with their explicit consent
--                  to be called at the number they gave (TCPA: the words shown,
--                  their version and hash, the time, the IP and browser), the
--                  version of the "questions only" notice they saw, and how to
--                  confirm (WhatsApp or email; never SMS). One booking per slot.
--                  Created by the server only (POST /api/calls), never by a
--                  browser with the anon key, and nobody but staff reads others'.
--   call_messages  The confirmation and the reminder of each booking: one row
--                  per message under a unique dedupe key, so a repeated run
--                  never sends twice. Channel WhatsApp or email; there is no
--                  SMS value.
--
-- Who writes: only the server, with the service role. Nobody gets an insert,
-- update or delete policy. Reads: a client their own rows; staff by the
-- scopes of migration 0012 (staff_can_see_client) once a row belongs to a
-- client; a booking or signup with no account yet (a lead) by an
-- administrator or sales, like the leads they work.

-- ── The signup's case reference ─────────────────────────────────────────

create table public.signup_cases (
  case_ref text primary key check (case_ref ~ '^CR-[2-9A-HJKMNP-TW-Z]{5}$'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users (id) on delete set null,
  -- The five steps (start, info, identity, report, signup) and done (signed).
  step text not null default 'start' check (step in ('start', 'info', 'identity', 'report', 'signup', 'done')),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  locale text not null default 'en' check (locale in ('es', 'en')),
  -- They tapped "Rather talk to someone?" at least once.
  wants_person boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_at timestamptz,
  completed_at timestamptz,
  constraint signup_cases_link_pair check ((user_id is null) or (linked_at is not null))
);

create index signup_cases_user_idx on public.signup_cases (user_id) where user_id is not null;

alter table public.signup_cases enable row level security;

create policy "own signup case" on public.signup_cases
  for select using (auth.uid() = user_id);

create policy "staff read signup cases" on public.signup_cases
  for select using (
    (user_id is not null and public.staff_can_see_client(user_id))
    or (user_id is null and public.staff_role() in ('admin', 'sales'))
  );

-- The reference, the token and the start never change; the account is linked
-- once (and only cleared when the account itself is deleted); a finished
-- signup stays finished. Never deleted.
create function public.signup_cases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'signup_cases: a signup is a record and cannot be deleted';
  end if;
  if new.case_ref <> old.case_ref or new.token_hash <> old.token_hash or new.started_at <> old.started_at then
    raise exception 'signup_cases: the reference, its token and its start never change';
  end if;
  if old.user_id is not null and new.user_id is not null and new.user_id <> old.user_id then
    raise exception 'signup_cases: the signup belongs to another account';
  end if;
  if old.user_id is null and new.user_id is not null then
    new.linked_at := now();
  elsif new.linked_at is distinct from old.linked_at and new.user_id is not distinct from old.user_id then
    new.linked_at := old.linked_at;
  end if;
  if old.step = 'done' then
    new.step := 'done';
  end if;
  if old.completed_at is not null then
    new.completed_at := old.completed_at;
  elsif new.step = 'done' and new.completed_at is null then
    new.completed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.signup_cases_guard() from public;

create trigger signup_cases_guard
  before update or delete on public.signup_cases
  for each row execute function public.signup_cases_guard();

-- ── When the team takes calls ───────────────────────────────────────────

create table public.call_windows (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  slot_minutes smallint not null default 20 check (slot_minutes in (15, 20, 30, 45, 60)),
  -- The clock the team set it on (Texas: Central time).
  time_zone text not null default 'America/Chicago' check (time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$'),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null check (char_length(created_by_name) between 1 and 80),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_by_name text check (removed_by_name is null or char_length(removed_by_name) between 1 and 80),
  constraint call_windows_order check (ends_at > starts_at),
  constraint call_windows_length check (ends_at - starts_at <= interval '12 hours'),
  constraint call_windows_whole_slots check (extract(epoch from (ends_at - starts_at))::integer % (slot_minutes * 60) = 0),
  constraint call_windows_removed_pair check ((removed_at is null) = (removed_by_name is null))
);

create index call_windows_open_idx on public.call_windows (starts_at) where removed_at is null;

alter table public.call_windows enable row level security;

create policy "staff read call windows" on public.call_windows
  for select using (public.is_staff());

-- A window is removed once and otherwise never changes or disappears: a
-- booking points at it.
create function public.call_windows_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'call_windows: a window is removed (removed_at), never deleted';
  end if;
  if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.slot_minutes <> old.slot_minutes
     or new.time_zone <> old.time_zone or new.created_at <> old.created_at or new.created_by_name <> old.created_by_name then
    raise exception 'call_windows: a window cannot be edited; remove it and add another';
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'call_windows: the window was already removed';
  end if;
  if old.removed_at is null and new.removed_at is not null then
    new.removed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.call_windows_guard() from public;

create trigger call_windows_guard
  before update or delete on public.call_windows
  for each row execute function public.call_windows_guard();

-- ── Bookings ────────────────────────────────────────────────────────────

create table public.call_bookings (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.call_windows (id) on delete restrict,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  -- The chat signup it came from, when there is one.
  case_ref text references public.signup_cases (case_ref) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  -- The number to call (US).
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  -- How the confirmation and the reminder go. Never 'sms'.
  confirm_channel text not null check (confirm_channel in ('whatsapp', 'email')),
  locale text not null default 'en' check (locale in ('es', 'en')),
  -- The clock the times were shown on (the person's; Texas by default).
  time_zone text not null default 'America/Chicago' check (time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$'),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  question text check (question is null or char_length(question) <= 500),
  -- TCPA: the person agreed, in their own action, to be called at this number.
  call_consent boolean not null check (call_consent),
  consent_version text not null check (char_length(consent_version) between 3 and 40),
  consent_text_hash text not null check (consent_text_hash ~ '^[0-9a-f]{64}$'),
  consent_at timestamptz not null default now(),
  consent_ip text check (consent_ip is null or char_length(consent_ip) <= 64),
  consent_user_agent text check (consent_user_agent is null or char_length(consent_user_agent) <= 300),
  -- The "questions only" notice they saw before booking.
  notice_version text not null check (char_length(notice_version) between 3 and 40),
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed', 'no_answer')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  closed_by_name text check (closed_by_name is null or char_length(closed_by_name) between 1 and 80),
  staff_note text check (staff_note is null or char_length(staff_note) <= 500),
  constraint call_bookings_order check (slot_end > slot_start),
  constraint call_bookings_email_needs_address check (confirm_channel <> 'email' or email is not null),
  constraint call_bookings_closed_pair check ((status = 'booked') = (closed_at is null))
);

-- One person per slot.
create unique index call_bookings_one_per_slot on public.call_bookings (slot_start) where status = 'booked';
create index call_bookings_user_idx on public.call_bookings (user_id) where user_id is not null;

alter table public.call_bookings enable row level security;

create policy "own call bookings" on public.call_bookings
  for select using (auth.uid() = user_id);

create policy "staff read call bookings" on public.call_bookings
  for select using (
    (user_id is not null and public.staff_can_see_client(user_id))
    or (user_id is null and public.staff_role() in ('admin', 'sales'))
  );

-- A new booking is a real slot of an open window, in the future, consented,
-- and starts booked. Afterwards only its outcome (once), who closed it and a
-- note may change; the account link is cleared only by the account's deletion.
create function public.call_bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  w record;
begin
  if tg_op = 'DELETE' then
    raise exception 'call_bookings: a booking is a record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    select * into w from public.call_windows where id = new.window_id;
    if not found or w.removed_at is not null then
      raise exception 'call_bookings: that window is not open';
    end if;
    if new.slot_start < w.starts_at or new.slot_end > w.ends_at
       or extract(epoch from (new.slot_start - w.starts_at))::integer % (w.slot_minutes * 60) <> 0
       or new.slot_end <> new.slot_start + make_interval(mins => w.slot_minutes) then
      raise exception 'call_bookings: not one of the window''s slots';
    end if;
    if new.slot_start <= now() then
      raise exception 'call_bookings: the slot has already started';
    end if;
    if new.status <> 'booked' or new.closed_at is not null then
      raise exception 'call_bookings: a booking starts booked';
    end if;
    new.created_at := now();
    new.consent_at := now();
    return new;
  end if;
  if new.window_id <> old.window_id or new.slot_start <> old.slot_start or new.slot_end <> old.slot_end
     or new.case_ref is distinct from old.case_ref or new.first_name <> old.first_name
     or new.phone_e164 <> old.phone_e164 or new.email is distinct from old.email
     or new.confirm_channel <> old.confirm_channel or new.locale <> old.locale or new.time_zone <> old.time_zone
     or new.state is distinct from old.state or new.question is distinct from old.question
     or new.call_consent <> old.call_consent or new.consent_version <> old.consent_version
     or new.consent_text_hash <> old.consent_text_hash or new.consent_at <> old.consent_at
     or new.consent_ip is distinct from old.consent_ip or new.consent_user_agent is distinct from old.consent_user_agent
     or new.notice_version <> old.notice_version or new.created_at <> old.created_at then
    raise exception 'call_bookings: a booking cannot be rewritten';
  end if;
  if new.user_id is distinct from old.user_id and not (old.user_id is not null and new.user_id is null) then
    raise exception 'call_bookings: the account on a booking does not change';
  end if;
  if old.status <> 'booked' and (new.status <> old.status or new.closed_at is distinct from old.closed_at) then
    raise exception 'call_bookings: the booking was already closed';
  end if;
  if old.status = 'booked' and new.status <> 'booked' then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.call_bookings_guard() from public;

create trigger call_bookings_guard
  before insert or update or delete on public.call_bookings
  for each row execute function public.call_bookings_guard();

-- ── Confirmations and reminders ─────────────────────────────────────────

create table public.call_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.call_bookings (id) on delete restrict,
  -- "call:<booking>:confirmation" or "call:<booking>:reminder".
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 240),
  kind text not null check (kind in ('confirmation', 'reminder')),
  -- Never 'sms' (docs/AUTOPILOT.md).
  channel text not null check (channel in ('whatsapp', 'email')),
  template text check (template is null or template ~ '^[a-z0-9_]{2,120}$'),
  locale text not null default 'en' check (locale in ('es', 'en')),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  note text check (note is null or char_length(note) <= 300)
);

create index call_messages_booking_idx on public.call_messages (booking_id);

alter table public.call_messages enable row level security;

-- Through the booking: whoever may read the booking reads its messages.
create policy "read call messages through the booking" on public.call_messages
  for select using (exists (select 1 from public.call_bookings b where b.id = booking_id));

-- The words never change; the result is filled in once (sending → sent | failed).
create function public.call_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'call_messages: a message record cannot be deleted';
  end if;
  if new.booking_id <> old.booking_id or new.dedupe_key <> old.dedupe_key or new.kind <> old.kind
     or new.channel <> old.channel or new.body <> old.body or new.locale <> old.locale
     or new.template is distinct from old.template or new.created_at <> old.created_at then
    raise exception 'call_messages: a message cannot be rewritten';
  end if;
  if not (old.status = 'sending' and new.status in ('sent', 'failed')) then
    raise exception 'call_messages: % cannot become %', old.status, new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.call_messages_guard() from public;

create trigger call_messages_guard
  before update or delete on public.call_messages
  for each row execute function public.call_messages_guard();
