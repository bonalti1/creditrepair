-- Webinars, the campaign scorecard, and a person in Alti's signup chat
-- (docs/WEBINARS.md, docs/SIGNUP-CHAT.md «A person joins the chat»).
--
--   campaigns                A campaign ("Webinar test #1"): its dates, budget, and
--                            what it groups (Meta campaign ids from the Ads
--                            Manager's cache, webinars, keywords, organic sources).
--   campaign_costs           Costs that are not Meta's (content, tools, people…),
--                            recorded by an administrator. Never deleted: voided.
--   webinars                 The live classes: titles EN/ES, host, start (Texas
--                            time on the screens), platforms' links, keyword,
--                            campaign tag, replay link. Draft → published →
--                            (cancelled). Never deleted.
--   webinar_registrations    Who registered on /webinar/<slug>: name, WhatsApp,
--                            optional email, state (Texas served; other states
--                            out_of_state; Georgia refused by the server and here),
--                            language, goal, timeline, question, the reminders
--                            consent with its version and hash, the ad's
--                            marketing tags, and attendance. One per phone per
--                            webinar. Never deleted.
--   webinar_messages         Each reminder, claimed under its dedupe key before it
--                            is sent (webinar:<registration>:<kind>): WhatsApp or
--                            email, NEVER SMS (the check below refuses it).
--   webinar_audit            Who created, changed, published, imported attendance.
--                            Append-only.
--   client_purchases         What a signed client bought later, marked by hand
--                            (an upgrade, a household add-on, a partner offer, a
--                            loan officer connection, a home purchase), with the
--                            money it brought when it brought any. Voided, never deleted.
--   signup_chat_threads      A person in the chat signup (/registro) asked for a
--                            human: requested → joined (a teammate is in the
--                            chat, Alti paused) → handed_back (Alti again).
--   signup_chat_messages     The thread's lines: the person's, the teammate's
--                            (with their first name), Alti's (library answers
--                            only), and system lines. Append-only.
--
-- Who reads: webinars, every active member of staff (is_staff(): webinars.view
-- is every role's). Registrations (names and phones) and the chat threads, an
-- administrator or sales (they work the leads), or whoever may see the client
-- once the signup is linked to an account. Reminders' log, campaigns, costs,
-- purchases and the audit: administrators only (spend and money). Anonymous
-- visitors, clients and partners read nothing: the public page reads a
-- published webinar through the server, and the person's chat through
-- /api/signup/chat with their case's token. Who writes: only the server with
-- the service role, after requireCapability ('webinars.manage',
-- 'campaigns.view', 'leads.work') or the case's token. Nobody gets an insert,
-- update or delete policy.

-- ── Campaigns ───────────────────────────────────────────────────────────

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  start_day date not null,
  end_day date not null,
  budget_cents integer check (budget_cents is null or budget_cents between 0 and 100000000),
  meta_campaign_ids text[] not null default '{}' check (array_length(meta_campaign_ids, 1) is null or array_length(meta_campaign_ids, 1) <= 50),
  keywords text[] not null default '{}' check (array_length(keywords, 1) is null or array_length(keywords, 1) <= 20),
  organic_sources text[] not null default '{}' check (array_length(organic_sources, 1) is null or array_length(organic_sources, 1) <= 20),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_dates check (end_day >= start_day and end_day - start_day <= 400)
);

alter table public.campaigns enable row level security;
create policy "admins read campaigns" on public.campaigns for select using (public.staff_role() = 'admin');

create table public.campaign_costs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  label text not null check (char_length(btrim(label)) between 2 and 120),
  kind text not null check (kind in ('ads_other', 'content', 'tools', 'people', 'other')),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  day date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by_name text check (voided_by_name is null or char_length(voided_by_name) <= 80)
);

create index campaign_costs_campaign_idx on public.campaign_costs (campaign_id);
alter table public.campaign_costs enable row level security;
create policy "admins read campaign costs" on public.campaign_costs for select using (public.staff_role() = 'admin');

-- A cost is a money record: only its void may be set, once.
create function public.campaign_costs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'campaign_costs: a cost is never deleted (void it)';
  end if;
  if old.voided_at is not null then
    raise exception 'campaign_costs: a voided cost does not change';
  end if;
  if new.campaign_id <> old.campaign_id or new.label <> old.label or new.kind <> old.kind or new.amount_cents <> old.amount_cents
      or new.day <> old.day or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'campaign_costs: only the void can be recorded';
  end if;
  return new;
end;
$$;

create trigger campaign_costs_guard before update or delete on public.campaign_costs
  for each row execute function public.campaign_costs_guard();

-- ── Webinars ────────────────────────────────────────────────────────────

create table public.webinars (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title_en text not null check (char_length(btrim(title_en)) between 3 and 120),
  title_es text not null check (char_length(btrim(title_es)) between 3 and 120),
  host_name text not null check (char_length(btrim(host_name)) between 2 and 80),
  starts_at timestamptz not null,
  duration_minutes integer not null default 45 check (duration_minutes between 15 and 180),
  language text not null default 'es' check (language in ('en', 'es', 'both')),
  topic text not null default '' check (char_length(topic) <= 300),
  campaign_tag text check (campaign_tag is null or campaign_tag ~ '^[a-z0-9_-]{2,40}$'),
  keyword text not null default 'CREDIT' check (keyword ~ '^[A-Z0-9]{2,20}$'),
  zoom_url text check (zoom_url is null or (zoom_url ~ '^https://[^\s]{4,}$' and char_length(zoom_url) <= 500)),
  facebook_url text check (facebook_url is null or (facebook_url ~ '^https://[^\s]{4,}$' and char_length(facebook_url) <= 500)),
  youtube_url text check (youtube_url is null or (youtube_url ~ '^https://[^\s]{4,}$' and char_length(youtube_url) <= 500)),
  instagram_url text check (instagram_url is null or (instagram_url ~ '^https://[^\s]{4,}$' and char_length(instagram_url) <= 500)),
  tiktok_url text check (tiktok_url is null or (tiktok_url ~ '^https://[^\s]{4,}$' and char_length(tiktok_url) <= 500)),
  replay_url text check (replay_url is null or (replay_url ~ '^https://[^\s]{4,}$' and char_length(replay_url) <= 500)),
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  campaign_id uuid references public.campaigns (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webinars_starts_idx on public.webinars (starts_at desc);
alter table public.webinars enable row level security;
create policy "staff read webinars" on public.webinars for select using (public.is_staff());

-- A webinar is never deleted; a cancelled one stays cancelled; a published one does not go back to draft.
create function public.webinars_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'webinars: a webinar is a record and is never deleted (cancel it)';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'webinars: a cancelled webinar stays cancelled';
  end if;
  if old.status = 'published' and new.status = 'draft' then
    raise exception 'webinars: a published webinar does not go back to draft';
  end if;
  if new.slug <> old.slug and old.status <> 'draft' then
    raise exception 'webinars: the link of a published webinar does not change';
  end if;
  if new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'webinars: who and when it was created cannot change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger webinars_guard before update or delete on public.webinars
  for each row execute function public.webinars_guard();

create table public.webinar_registrations (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars (id) on delete restrict,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name text check (last_name is null or char_length(btrim(last_name)) between 1 and 80),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or email ~ '^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$'),
  state text not null check (state ~ '^[A-Z]{2}$' and state <> 'GA'),
  served text not null check (served in ('texas', 'out_of_state')),
  locale text not null check (locale in ('en', 'es')),
  goal text not null check (goal in ('home', 'car', 'understand', 'learning')),
  timeline text not null check (timeline in ('now', 'months_3', 'months_6', 'months_12', 'learning')),
  question text check (question is null or char_length(question) <= 500),
  reminders_consent boolean not null,
  consent_version text check (consent_version is null or char_length(consent_version) <= 40),
  consent_text_hash text check (consent_text_hash is null or consent_text_hash ~ '^[0-9a-f]{64}$'),
  consent_ip text check (consent_ip is null or char_length(consent_ip) <= 64),
  consent_user_agent text check (consent_user_agent is null or char_length(consent_user_agent) <= 300),
  attribution jsonb not null default '{}' check (jsonb_typeof(attribution) = 'object' and octet_length(attribution::text) <= 2000),
  reminders_opted_out_at timestamptz,
  attended boolean not null default false,
  attended_minutes integer check (attended_minutes is null or attended_minutes between 0 and 1440),
  attendance_source text check (attendance_source is null or attendance_source in ('zoom_csv', 'manual')),
  attendance_marked_by_name text check (attendance_marked_by_name is null or char_length(attendance_marked_by_name) <= 80),
  attendance_marked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint webinar_registrations_one_per_phone unique (webinar_id, phone_e164),
  constraint webinar_registrations_consent_recorded check (not reminders_consent or (consent_version is not null and consent_text_hash is not null)),
  constraint webinar_registrations_texas check ((served = 'texas') = (state = 'TX'))
);

create index webinar_registrations_webinar_idx on public.webinar_registrations (webinar_id, created_at);
create index webinar_registrations_phone_idx on public.webinar_registrations (phone_e164);
alter table public.webinar_registrations enable row level security;
create policy "admins and sales read registrations" on public.webinar_registrations
  for select using (public.staff_role() in ('admin', 'sales'));

-- What a registration is never changes; only its attendance and the opt-out are recorded on it.
create function public.webinar_registrations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'webinar_registrations: a registration is a record and is never deleted';
  end if;
  if new.webinar_id <> old.webinar_id or new.first_name <> old.first_name or new.last_name is distinct from old.last_name
      or new.phone_e164 <> old.phone_e164 or new.email is distinct from old.email or new.state <> old.state or new.served <> old.served
      or new.reminders_consent <> old.reminders_consent or new.consent_version is distinct from old.consent_version
      or new.consent_text_hash is distinct from old.consent_text_hash or new.attribution <> old.attribution or new.created_at <> old.created_at then
    raise exception 'webinar_registrations: what the person gave never changes';
  end if;
  if old.reminders_opted_out_at is not null and new.reminders_opted_out_at is distinct from old.reminders_opted_out_at then
    raise exception 'webinar_registrations: an opt-out stays';
  end if;
  return new;
end;
$$;

create trigger webinar_registrations_guard before update or delete on public.webinar_registrations
  for each row execute function public.webinar_registrations_guard();

create table public.webinar_messages (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.webinar_registrations (id) on delete restrict,
  webinar_id uuid not null references public.webinars (id) on delete restrict,
  kind text not null check (kind in ('week', 'day', 'hour', 'live', 'replay', 'followup_2', 'followup_5')),
  -- WhatsApp or email. Never SMS: there is no such channel.
  channel text not null check (channel in ('whatsapp', 'email')),
  template text check (template is null or (template ~ '^[a-z0-9_]+$' and char_length(template) <= 512)),
  locale text not null check (locale in ('en', 'es')),
  body text not null check (char_length(body) between 1 and 2000),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index webinar_messages_registration_idx on public.webinar_messages (registration_id);
alter table public.webinar_messages enable row level security;
create policy "admins read webinar messages" on public.webinar_messages for select using (public.staff_role() = 'admin');

-- A claimed message is settled once (sent or failed); its words never change.
create function public.webinar_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'webinar_messages: a message is a record and is never deleted';
  end if;
  if old.status <> 'sending' then
    raise exception 'webinar_messages: a settled message does not change';
  end if;
  if new.body <> old.body or new.dedupe_key <> old.dedupe_key or new.channel <> old.channel or new.kind <> old.kind or new.registration_id <> old.registration_id then
    raise exception 'webinar_messages: only the result is recorded';
  end if;
  return new;
end;
$$;

create trigger webinar_messages_guard before update or delete on public.webinar_messages
  for each row execute function public.webinar_messages_guard();

create table public.webinar_audit (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid references public.webinars (id) on delete restrict,
  campaign_id uuid references public.campaigns (id) on delete restrict,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null check (char_length(actor_name) between 1 and 80),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4000),
  at timestamptz not null default now()
);

alter table public.webinar_audit enable row level security;
create policy "admins read webinar audit" on public.webinar_audit for select using (public.staff_role() = 'admin');
create trigger webinar_audit_append_only before update or delete on public.webinar_audit
  for each row execute function public.control_append_only();

-- ── Later purchases (the client's value) ────────────────────────────────

create table public.client_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('upgrade', 'household_addon', 'partner_offer', 'loan_officer', 'home_purchase', 'other')),
  amount_cents integer check (amount_cents is null or amount_cents between 0 and 100000000),
  day date not null,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);

create index client_purchases_client_idx on public.client_purchases (client_id);
alter table public.client_purchases enable row level security;
create policy "admins read client purchases" on public.client_purchases for select using (public.staff_role() = 'admin');

create function public.client_purchases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'client_purchases: never deleted (void it)';
  end if;
  if old.voided_at is not null or new.client_id <> old.client_id or new.kind <> old.kind or new.amount_cents is distinct from old.amount_cents
      or new.day <> old.day or new.created_at <> old.created_at then
    raise exception 'client_purchases: only the void can be recorded';
  end if;
  return new;
end;
$$;

create trigger client_purchases_guard before update or delete on public.client_purchases
  for each row execute function public.client_purchases_guard();

-- ── A person in Alti's signup chat ──────────────────────────────────────

create table public.signup_chat_threads (
  case_ref text primary key references public.signup_cases (case_ref) on delete restrict,
  status text not null default 'requested' check (status in ('requested', 'joined', 'handed_back')),
  requested_at timestamptz not null default now(),
  joined_at timestamptz,
  joined_by uuid references auth.users (id) on delete set null,
  joined_by_name text check (joined_by_name is null or char_length(btrim(joined_by_name)) between 1 and 40),
  handed_back_at timestamptz,
  last_person_at timestamptz,
  last_staff_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint signup_chat_threads_joined_has_who check (status <> 'joined' or (joined_at is not null and joined_by_name is not null))
);

create index signup_chat_threads_status_idx on public.signup_chat_threads (status, requested_at);
alter table public.signup_chat_threads enable row level security;
create policy "staff read signup chats" on public.signup_chat_threads
  for select using (
    public.staff_role() in ('admin', 'sales')
    or exists (select 1 from public.signup_cases c where c.case_ref = signup_chat_threads.case_ref and c.user_id is not null and public.staff_can_see_client(c.user_id))
  );

create table public.signup_chat_messages (
  id uuid primary key default gen_random_uuid(),
  case_ref text not null references public.signup_cases (case_ref) on delete restrict,
  author text not null check (author in ('person', 'staff', 'alti', 'system')),
  staff_user uuid references auth.users (id) on delete set null,
  staff_name text check (staff_name is null or char_length(btrim(staff_name)) between 1 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint signup_chat_messages_staff_named check (author <> 'staff' or staff_name is not null)
);

create index signup_chat_messages_case_idx on public.signup_chat_messages (case_ref, created_at);
alter table public.signup_chat_messages enable row level security;
create policy "staff read signup chat messages" on public.signup_chat_messages
  for select using (
    public.staff_role() in ('admin', 'sales')
    or exists (select 1 from public.signup_cases c where c.case_ref = signup_chat_messages.case_ref and c.user_id is not null and public.staff_can_see_client(c.user_id))
  );
create trigger signup_chat_messages_append_only before update or delete on public.signup_chat_messages
  for each row execute function public.control_append_only();

-- Alti never writes while a person is in the chat.
create function public.signup_chat_messages_alti_paused()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author = 'alti' and exists (select 1 from public.signup_chat_threads t where t.case_ref = new.case_ref and t.status = 'joined') then
    raise exception 'signup_chat_messages: Alti is paused while a person is in the chat';
  end if;
  if new.author = 'staff' and not exists (select 1 from public.signup_chat_threads t where t.case_ref = new.case_ref and t.status = 'joined') then
    raise exception 'signup_chat_messages: a teammate joins the chat before writing in it';
  end if;
  return new;
end;
$$;

create trigger signup_chat_messages_alti_paused before insert on public.signup_chat_messages
  for each row execute function public.signup_chat_messages_alti_paused();
