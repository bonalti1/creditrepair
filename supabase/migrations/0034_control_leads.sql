-- Credalti Control, phase 1 (docs/CONTROL.md): the lead inbox, its pipeline,
-- the lead autopilot (off), staff phone alerts (off for everyone) and the
-- Overview's "escalate to the owner".
--
-- What it adds:
--   leads                     One row per prospect conversation, keyed by the
--                             phone. Created and kept up to date by the
--                             database itself (triggers below) from what
--                             already happens: a WhatsApp message from a
--                             number with no account, a prospect added by
--                             hand, from HighLevel or by a partner, a chat
--                             signup (/registro) that reached a phone. The
--                             facts on it (invited, signed, last message,
--                             first reply by a person) are written only by
--                             those triggers.
--   lead_stage_events         Every pipeline move. ONLY PEOPLE MOVE LEADS: a
--                             move needs a person (actor not null) and can
--                             only go to New, Contacted, Qualified, Not
--                             interested, Closed-lost or Archived. "Invited"
--                             and "Signed" are not moves at all: they are the
--                             facts invited_at (the invitation was sent) and
--                             signed_at (the agreement was signed).
--   lead_notes                The team's notes on a lead. Append-only.
--   lead_autopilot_settings   The lead autopilot's switch and numbers: OFF.
--   lead_autopilot_changes    Who turned it on or off, and the numbers. Append-only.
--   lead_auto_messages        One row for every automatic message to a lead,
--                             sent or handed to a person. WhatsApp only.
--   staff_alert_topics        Each member's phone alerts, per topic. Off.
--   staff_push_subscriptions  The browsers a member turned alerts on in.
--   staff_alerts              The alerts themselves (once per member and key).
--   control_escalations       "Escalate to the owner" from the Today list.
--   cron_heartbeats           When a scheduled job last ran.
--
-- Who writes: only the server (service role), after the caller's role is
-- checked (src/app/api/staff/leads, …/alerts, …/control, /api/cron/leads),
-- and the triggers. Nobody gets an insert, update or delete policy.
-- Who reads: leads and everything about them, an administrator, or sales for
-- the leads they work (theirs, or nobody's yet). A specialist, a client, a
-- partner and anon read none of it. A member reads only their own alerts.

-- ── The leads ───────────────────────────────────────────────────────────

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  locale text check (locale is null or locale in ('en', 'es')),
  -- Where the first touch came from. Never overwritten (first touch wins).
  source text not null check (source in ('whatsapp', 'highlevel', 'partner', 'signup_chat', 'manual', 'household')),
  -- Marketing tags only: campaign, UTM, the partner, the signup's case reference.
  first_touch jsonb not null default '{}' check (jsonb_typeof(first_touch) = 'object' and octet_length(first_touch::text) <= 4000),
  prospect_id uuid references public.prospects (id) on delete set null,
  partner_id uuid references public.partners (id) on delete set null,
  signup_case_ref text references public.signup_cases (case_ref) on delete set null,
  -- The salesperson who works the lead (staff_members.handle); null: nobody yet.
  salesperson text check (salesperson is null or salesperson ~ '^[a-z0-9-]{2,30}$'),
  assigned_at timestamptz,
  -- The stage a PERSON chose. Invited and Signed come from the facts below.
  stage text not null default 'new' check (stage in ('new', 'contacted', 'qualified', 'not_interested', 'closed_lost', 'archived')),
  stage_at timestamptz,
  stage_by uuid references auth.users (id) on delete set null,
  -- Facts, written by the triggers only.
  invited_at timestamptz,
  signed_at timestamptz,
  client_user_id uuid references auth.users (id) on delete set null,
  last_inbound_at timestamptz,
  -- The last answer after an inbound message: by a person, or by the AI (the lead autopilot, the coach).
  last_reply_at timestamptz,
  last_human_at timestamptz,
  first_human_reply_at timestamptz,
  last_message_at timestamptz,
  last_message_role text check (last_message_role is null or last_message_role in ('user', 'assistant')),
  last_message_source text check (last_message_source is null or last_message_source in ('journey', 'coach', 'human')),
  last_message_excerpt text check (last_message_excerpt is null or char_length(last_message_excerpt) <= 160),
  created_at timestamptz not null default now()
);

create index leads_salesperson_idx on public.leads (salesperson);
create index leads_created_idx on public.leads (created_at desc);
create index leads_prospect_idx on public.leads (prospect_id) where prospect_id is not null;
create index leads_client_idx on public.leads (client_user_id) where client_user_id is not null;

alter table public.leads enable row level security;

-- Who may see a lead: an administrator; sales for their own leads and for the ones nobody has yet.
create function public.staff_can_see_lead(p_salesperson text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.staff_role() = 'admin', false)
      or coalesce(public.staff_role() = 'sales' and (p_salesperson is null or p_salesperson = public.staff_handle()), false);
$$;

create function public.staff_can_see_lead_id(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.id = p_lead and public.staff_can_see_lead(l.salesperson));
$$;

create function public.staff_can_see_lead_phone(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.phone_e164 = p_phone and public.staff_can_see_lead(l.salesperson));
$$;

revoke all on function public.staff_can_see_lead(text) from public;
revoke all on function public.staff_can_see_lead_id(uuid) from public;
revoke all on function public.staff_can_see_lead_phone(text) from public;
grant execute on function public.staff_can_see_lead(text) to authenticated;
grant execute on function public.staff_can_see_lead_id(uuid) to authenticated;
grant execute on function public.staff_can_see_lead_phone(text) to authenticated;

create policy "staff read leads" on public.leads
  for select using (public.staff_can_see_lead(salesperson));

-- A lead's WhatsApp conversation (chat_messages with no account) was for an
-- administrator only (0012). Sales reads the conversations of the leads they work.
create policy "staff read lead chat" on public.chat_messages
  for select using (user_id is null and channel = 'whatsapp' and phone_e164 is not null and public.staff_can_see_lead_phone(phone_e164));

-- And whether that number said STOP.
create policy "staff read lead opt-outs" on public.message_opt_outs
  for select using (user_id is null and phone_e164 is not null and public.staff_can_see_lead_phone(phone_e164));

-- Only people move leads. A stage changes only through a lead_stage_events
-- row (which needs a person); the facts change only through the triggers.
create function public.leads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'leads: a lead is a record and is never deleted (archive it)';
  end if;
  if new.stage is distinct from old.stage or new.stage_at is distinct from old.stage_at or new.stage_by is distinct from old.stage_by then
    if coalesce(current_setting('credalti.lead_stage_move', true), '') <> 'on' then
      raise exception 'leads: only a person moves a lead, through lead_stage_events';
    end if;
  end if;
  if new.phone_e164 <> old.phone_e164 or new.source <> old.source or new.created_at <> old.created_at then
    raise exception 'leads: the phone, the first source and the first touch never change';
  end if;
  -- Facts only move forward: once invited or signed, always.
  if old.invited_at is not null then new.invited_at := old.invited_at; end if;
  if old.signed_at is not null then new.signed_at := old.signed_at; end if;
  if old.first_human_reply_at is not null then new.first_human_reply_at := old.first_human_reply_at; end if;
  if old.first_touch <> '{}'::jsonb then new.first_touch := old.first_touch; end if;
  return new;
end;
$$;

create trigger leads_guard
  before update or delete on public.leads
  for each row execute function public.leads_guard();

-- ── Pipeline moves (people only) ────────────────────────────────────────

create table public.lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_stage text,
  to_stage text not null check (to_stage in ('new', 'contacted', 'qualified', 'not_interested', 'closed_lost', 'archived')),
  -- Only people move leads: never null, never the system.
  actor uuid not null references auth.users (id) on delete restrict,
  actor_handle text check (actor_handle is null or actor_handle ~ '^[a-z0-9-]{2,30}$'),
  at timestamptz not null default now()
);

create index lead_stage_events_lead_idx on public.lead_stage_events (lead_id, at);

alter table public.lead_stage_events enable row level security;

create policy "staff read lead stage events" on public.lead_stage_events
  for select using (public.staff_can_see_lead_id(lead_id));

create function public.lead_stage_events_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'lead_stage_events: the pipeline history is append-only';
  end if;
  if not exists (select 1 from public.staff_members s where s.user_id = new.actor and s.active) then
    raise exception 'lead_stage_events: only an active member of the team moves a lead';
  end if;
  select l.stage into new.from_stage from public.leads l where l.id = new.lead_id;
  new.at := now();
  perform set_config('credalti.lead_stage_move', 'on', true);
  update public.leads set stage = new.to_stage, stage_at = new.at, stage_by = new.actor where id = new.lead_id;
  perform set_config('credalti.lead_stage_move', '', true);
  return new;
end;
$$;

revoke all on function public.lead_stage_events_apply() from public;

create trigger lead_stage_events_apply
  before insert or update or delete on public.lead_stage_events
  for each row execute function public.lead_stage_events_apply();

-- ── Notes ───────────────────────────────────────────────────────────────

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  author uuid not null references auth.users (id) on delete restrict,
  author_handle text check (author_handle is null or author_handle ~ '^[a-z0-9-]{2,30}$'),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now()
);

create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at);

alter table public.lead_notes enable row level security;

create policy "staff read lead notes" on public.lead_notes
  for select using (public.staff_can_see_lead_id(lead_id));

create function public.control_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: this record is append-only', tg_table_name;
end;
$$;

create trigger lead_notes_append_only
  before update or delete on public.lead_notes
  for each row execute function public.control_append_only();

-- ── The lead autopilot: OFF ─────────────────────────────────────────────

create table public.lead_autopilot_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- Wait this long after the lead's message, so a person can answer first.
  reply_delay_seconds integer not null default 120 check (reply_delay_seconds between 30 and 3600),
  per_lead_daily_cap integer not null default 3 check (per_lead_daily_cap between 1 and 10),
  daily_cap integer not null default 40 check (daily_cap between 1 and 500),
  quiet_start_hour integer not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour integer not null default 8 check (quiet_end_hour between 0 and 23),
  send_signup_link boolean not null default true,
  -- When it was last turned on: it never answers a message older than this.
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80)
);

insert into public.lead_autopilot_settings (id) values (true);

alter table public.lead_autopilot_settings enable row level security;

create policy "staff read lead autopilot" on public.lead_autopilot_settings
  for select using (public.is_staff());

create table public.lead_autopilot_changes (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid not null references auth.users (id) on delete restrict,
  actor_name text not null check (char_length(actor_name) between 1 and 80),
  enabled boolean not null,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);

alter table public.lead_autopilot_changes enable row level security;

create policy "admin read lead autopilot changes" on public.lead_autopilot_changes
  for select using (public.staff_role() = 'admin');

create trigger lead_autopilot_changes_append_only
  before update or delete on public.lead_autopilot_changes
  for each row execute function public.control_append_only();

create table public.lead_auto_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- WhatsApp only. Never SMS, for anything automatic.
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  kind text not null check (kind in ('greeting', 'faq', 'signup_link', 'handoff')),
  -- claimed → sent | failed; a hand-off is recorded as handed_off and never sends anything.
  status text not null check (status in ('claimed', 'sent', 'failed', 'handed_off')),
  -- Why a person was called in, or why the send failed.
  reason text check (reason is null or char_length(reason) <= 200),
  -- The exact words (with the AI label), or null for a hand-off.
  body text check (body is null or char_length(body) between 1 and 1500),
  -- The lead's message it answers, so the same message is never answered twice.
  inbound_at timestamptz not null,
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200),
  created_at timestamptz not null default now(),
  constraint lead_auto_messages_body check ((kind = 'handoff') = (body is null)),
  constraint lead_auto_messages_handoff check ((kind = 'handoff') = (status = 'handed_off'))
);

create index lead_auto_messages_lead_idx on public.lead_auto_messages (lead_id, created_at);
create index lead_auto_messages_day_idx on public.lead_auto_messages (created_at);

alter table public.lead_auto_messages enable row level security;

create policy "staff read lead auto messages" on public.lead_auto_messages
  for select using (public.staff_can_see_lead_id(lead_id));

-- The words, the lead and the key never change; the status only moves from claimed to sent or failed.
create function public.lead_auto_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'lead_auto_messages: the record of automatic messages is never deleted';
  end if;
  if new.lead_id <> old.lead_id or new.kind <> old.kind or new.body is distinct from old.body
     or new.dedupe_key <> old.dedupe_key or new.inbound_at <> old.inbound_at or new.created_at <> old.created_at then
    raise exception 'lead_auto_messages: what was sent and to whom never changes';
  end if;
  if new.status <> old.status and not (old.status = 'claimed' and new.status in ('sent', 'failed')) then
    raise exception 'lead_auto_messages: the status only moves from claimed to sent or failed';
  end if;
  return new;
end;
$$;

create trigger lead_auto_messages_guard
  before update or delete on public.lead_auto_messages
  for each row execute function public.lead_auto_messages_guard();

-- ── Staff phone alerts: off until each person turns them on ─────────────

create table public.staff_alert_topics (
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  topic text not null check (topic in ('new_lead', 'lead_waiting', 'complaint', 'partner_note', 'escalation')),
  enabled boolean not null default false,
  waiting_minutes integer not null default 15 check (waiting_minutes between 5 and 240),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic)
);

alter table public.staff_alert_topics enable row level security;

create policy "own alert topics" on public.staff_alert_topics
  for select using (auth.uid() = user_id);

create table public.staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text check (p256dh is null or char_length(p256dh) <= 200),
  auth text check (auth is null or char_length(auth) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index staff_push_subscriptions_user_idx on public.staff_push_subscriptions (user_id) where revoked_at is null;

alter table public.staff_push_subscriptions enable row level security;

create policy "own push subscriptions" on public.staff_push_subscriptions
  for select using (auth.uid() = user_id);

create table public.staff_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  -- 'test': the member's own "Send me a test" on the alerts screen.
  topic text not null check (topic in ('new_lead', 'lead_waiting', 'complaint', 'partner_note', 'escalation', 'test')),
  -- One alert per member per thing: "lead_waiting:<lead>:<message time>".
  dedupe_key text not null check (char_length(dedupe_key) between 4 and 200),
  title text not null check (char_length(title) between 1 and 140),
  body text check (body is null or char_length(body) <= 300),
  url text not null check (url ~ '^/equipo'),
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  seen_at timestamptz,
  unique (user_id, dedupe_key)
);

create index staff_alerts_user_idx on public.staff_alerts (user_id, created_at desc);

alter table public.staff_alerts enable row level security;

create policy "own alerts" on public.staff_alerts
  for select using (auth.uid() = user_id);

-- ── Escalate to the owner ───────────────────────────────────────────────

create table public.control_escalations (
  id uuid primary key default gen_random_uuid(),
  item_key text not null check (char_length(item_key) between 3 and 200),
  title text not null check (char_length(title) between 1 and 160),
  note text check (note is null or char_length(note) <= 500),
  by_user uuid not null references auth.users (id) on delete restrict,
  by_handle text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create index control_escalations_open_idx on public.control_escalations (created_at desc) where resolved_at is null;

alter table public.control_escalations enable row level security;

create policy "admin read escalations" on public.control_escalations
  for select using (public.staff_role() = 'admin');

create policy "own escalations" on public.control_escalations
  for select using (auth.uid() = by_user);

-- Only the resolution is ever written after the fact, once.
create function public.control_escalations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'control_escalations: never deleted';
  end if;
  if new.item_key <> old.item_key or new.title <> old.title or new.note is distinct from old.note
     or new.by_user <> old.by_user or new.created_at <> old.created_at then
    raise exception 'control_escalations: what was escalated never changes';
  end if;
  if old.resolved_at is not null and (new.resolved_at is distinct from old.resolved_at or new.resolved_by is distinct from old.resolved_by) then
    raise exception 'control_escalations: resolved once';
  end if;
  return new;
end;
$$;

create trigger control_escalations_guard
  before update or delete on public.control_escalations
  for each row execute function public.control_escalations_guard();

-- ── When a scheduled job last ran ───────────────────────────────────────

create table public.cron_heartbeats (
  job text primary key check (job ~ '^[a-z0-9-]{2,40}$'),
  last_run_at timestamptz not null,
  last_ok_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2000)
);

alter table public.cron_heartbeats enable row level security;

create policy "admin read heartbeats" on public.cron_heartbeats
  for select using (public.staff_role() = 'admin');

-- ── Keeping the leads up to date, from what already happens ─────────────

-- A prospect (by hand, HighLevel, a partner, a household member) is a lead.
create function public.leads_from_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touch jsonb := coalesce(new.source_detail -> 'firstTouch', '{}'::jsonb);
begin
  if tg_op = 'INSERT' then
    if new.partner_id is not null then
      touch := touch || jsonb_build_object('partnerId', new.partner_id);
    end if;
    insert into public.leads (phone_e164, display_name, locale, source, first_touch, prospect_id, partner_id, salesperson, assigned_at, invited_at, client_user_id, created_at)
    values (new.phone_e164, left(btrim(new.first_name || ' ' || new.last_name), 80), new.locale, new.source, touch, new.id, new.partner_id,
            new.salesperson, case when new.salesperson is not null then new.created_at end, new.invited_at, new.converted_user_id, new.created_at)
    on conflict (phone_e164) do update set
      prospect_id = case when excluded.prospect_id is not null and new.lost_at is null then excluded.prospect_id else public.leads.prospect_id end,
      display_name = coalesce(public.leads.display_name, excluded.display_name),
      locale = coalesce(public.leads.locale, excluded.locale),
      partner_id = coalesce(public.leads.partner_id, excluded.partner_id),
      salesperson = coalesce(public.leads.salesperson, excluded.salesperson),
      assigned_at = coalesce(public.leads.assigned_at, excluded.assigned_at),
      invited_at = coalesce(public.leads.invited_at, excluded.invited_at);
  else
    update public.leads set
      invited_at = coalesce(invited_at, new.invited_at),
      client_user_id = coalesce(client_user_id, new.converted_user_id),
      display_name = coalesce(display_name, left(btrim(new.first_name || ' ' || new.last_name), 80))
    where prospect_id = new.id or (phone_e164 = new.phone_e164 and new.lost_at is null);
  end if;
  return null;
end;
$$;

revoke all on function public.leads_from_prospect() from public;

create trigger leads_from_prospect
  after insert or update of invited_at, converted_user_id on public.prospects
  for each row execute function public.leads_from_prospect();

-- A WhatsApp message: a number with no account that writes is a lead; every
-- message keeps the lead's last message, and a teammate's answer counts as
-- the first reply by a person.
create function public.leads_from_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  excerpt text := left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 160);
begin
  if new.channel <> 'whatsapp' or new.phone_e164 is null then
    return null;
  end if;
  if new.role = 'user' then
    if new.user_id is null then
      insert into public.leads (phone_e164, source, first_touch, created_at)
      values (new.phone_e164, 'whatsapp', jsonb_build_object('channel', 'whatsapp', 'at', new.created_at), new.created_at)
      on conflict (phone_e164) do nothing;
    end if;
    update public.leads set
      last_inbound_at = greatest(coalesce(last_inbound_at, new.created_at), new.created_at),
      last_message_at = new.created_at, last_message_role = 'user', last_message_source = new.source, last_message_excerpt = excerpt
    where phone_e164 = new.phone_e164;
  else
    update public.leads set
      last_reply_at = case when new.source in ('coach', 'human') then greatest(coalesce(last_reply_at, new.created_at), new.created_at) else last_reply_at end,
      last_human_at = case when new.source = 'human' then greatest(coalesce(last_human_at, new.created_at), new.created_at) else last_human_at end,
      first_human_reply_at = case when new.source = 'human' then coalesce(first_human_reply_at, new.created_at) else first_human_reply_at end,
      last_message_at = new.created_at, last_message_role = 'assistant', last_message_source = new.source, last_message_excerpt = excerpt
    where phone_e164 = new.phone_e164;
  end if;
  return null;
end;
$$;

revoke all on function public.leads_from_whatsapp() from public;

create trigger leads_from_whatsapp
  after insert on public.chat_messages
  for each row execute function public.leads_from_whatsapp();

-- A chat signup (/registro) that reached a verified phone is a lead, with its case reference.
create function public.leads_from_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone text;
begin
  if new.user_id is null or (tg_op = 'UPDATE' and old.user_id is not null) then
    return null;
  end if;
  select p.phone_e164 into phone from public.profiles p where p.id = new.user_id;
  if phone is null then
    select '+' || ltrim(u.phone, '+') into phone from auth.users u where u.id = new.user_id and u.phone is not null and u.phone <> '';
  end if;
  if phone is null or phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  insert into public.leads (phone_e164, locale, source, first_touch, signup_case_ref, client_user_id, created_at)
  values (phone, new.locale, 'signup_chat', jsonb_build_object('caseRef', new.case_ref), new.case_ref, new.user_id, new.started_at)
  on conflict (phone_e164) do update set
    signup_case_ref = coalesce(public.leads.signup_case_ref, excluded.signup_case_ref),
    client_user_id = coalesce(public.leads.client_user_id, excluded.client_user_id),
    locale = coalesce(public.leads.locale, excluded.locale);
  return null;
end;
$$;

revoke all on function public.leads_from_signup() from public;

create trigger leads_from_signup
  after insert or update of user_id on public.signup_cases
  for each row execute function public.leads_from_signup();

-- "Signed" is set automatically, and only here: when the agreement is signed.
create function public.leads_from_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone text;
begin
  if new.signed_at is null or (tg_op = 'UPDATE' and old.signed_at is not null) then
    return null;
  end if;
  select p.phone_e164 into phone from public.profiles p where p.id = new.user_id;
  update public.leads set
    signed_at = coalesce(signed_at, new.signed_at),
    client_user_id = coalesce(client_user_id, new.user_id)
  where client_user_id = new.user_id
     or (phone is not null and phone_e164 = phone)
     or prospect_id in (select pr.id from public.prospects pr where pr.converted_user_id = new.user_id);
  return null;
end;
$$;

revoke all on function public.leads_from_agreement() from public;

create trigger leads_from_agreement
  after insert or update of signed_at on public.service_agreements
  for each row execute function public.leads_from_agreement();

-- ── What is already on record becomes the first leads ───────────────────

insert into public.leads (phone_e164, display_name, locale, source, first_touch, prospect_id, partner_id, salesperson, assigned_at, invited_at, client_user_id, created_at)
select distinct on (p.phone_e164)
  p.phone_e164, left(btrim(p.first_name || ' ' || p.last_name), 80), p.locale, p.source,
  coalesce(p.source_detail -> 'firstTouch', '{}'::jsonb) || case when p.partner_id is not null then jsonb_build_object('partnerId', p.partner_id) else '{}'::jsonb end,
  p.id, p.partner_id, p.salesperson, case when p.salesperson is not null then p.created_at end, p.invited_at, p.converted_user_id, p.created_at
from public.prospects p
order by p.phone_e164, (p.lost_at is null) desc, p.created_at desc
on conflict (phone_e164) do nothing;

insert into public.leads (phone_e164, source, first_touch, created_at)
select m.phone_e164, 'whatsapp', jsonb_build_object('channel', 'whatsapp', 'at', min(m.created_at)), min(m.created_at)
from public.chat_messages m
where m.channel = 'whatsapp' and m.user_id is null and m.role = 'user' and m.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
group by m.phone_e164
on conflict (phone_e164) do nothing;

update public.leads l set
  last_inbound_at = x.last_in, last_reply_at = x.last_reply, last_human_at = x.last_human, first_human_reply_at = x.first_human
from (
  select m.phone_e164,
    max(m.created_at) filter (where m.role = 'user') as last_in,
    max(m.created_at) filter (where m.role = 'assistant' and m.source in ('coach', 'human')) as last_reply,
    max(m.created_at) filter (where m.role = 'assistant' and m.source = 'human') as last_human,
    min(m.created_at) filter (where m.role = 'assistant' and m.source = 'human') as first_human
  from public.chat_messages m
  where m.channel = 'whatsapp' and m.phone_e164 is not null
  group by m.phone_e164
) x
where x.phone_e164 = l.phone_e164;

update public.leads l set
  signed_at = a.signed_at, client_user_id = coalesce(l.client_user_id, a.user_id)
from public.service_agreements a
left join public.profiles p on p.id = a.user_id
where a.signed_at is not null and l.signed_at is null
  and (l.client_user_id = a.user_id or p.phone_e164 = l.phone_e164);
