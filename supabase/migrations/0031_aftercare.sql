-- After-care: building credit, the home-ready path, ITIN clients, partner
-- offers and graduation (docs/AFTERCARE.md).
--
--   profiles.id_type          "Do you have a Social Security number or an ITIN?"
--                             The kind of number only. The number itself is
--                             never stored, here or anywhere (same rule as SSN).
--   aftercare_marks           "Mark as done" on the build-your-credit plan and
--                             the home-ready track. Append-only; the newest row
--                             per item is the state. Written by the server.
--   program_completions       Graduation: the client finished the program. One
--                             row per client. Inserting it records the end of the
--                             service on the agreement (service_end_requested_at),
--                             so no letter leaves and no charge can be created
--                             afterwards (the charges trigger of 0011/0026 refuses).
--   offer_marketplace_changes The "Partner offers" switch, OFF until an
--                             administrator turns it on. Append-only.
--   partner_offers            Credit-building products the owner adds. There is
--                             no commission column: offers can only be ranked by
--                             what they cost the client, then by name.
--   partners.accepting_clients A partner loan officer an administrator marks as
--                             accepting new clients ("Connect me with a loan officer").
--   loan_officer_requests     The client asked to be introduced to a loan officer,
--                             with the consent text's version and hash.
--   partner_share_consents    + home_ready: the client also lets that partner see
--                             their home-ready milestones (an extension of the
--                             0023 consent, not a second consent system).
--
-- What a partner can read here: through partner_home_ready(), the milestone
-- names and dates of a client whose newest consent record has home_ready on;
-- through partner_intro_requests(), the name, phone and goal of a client who
-- asked to be introduced to that partner. Never scores, report items, accounts,
-- amounts or anything else. No partner has a read policy on any table below.

-- ── The kind of taxpayer number (never the number) ──────────────────────

alter table public.profiles
  add column id_type text check (id_type is null or id_type in ('ssn', 'itin'));

-- ── Mark as done ────────────────────────────────────────────────────────

create table public.aftercare_marks (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The same list as AFTERCARE_MARK_KEYS in src/lib/aftercare/plan.ts (a test checks).
  item_key text not null check (item_key in (
    'on_time', 'utilization', 'oldest_open', 'add_positive', 'inquiries', 'check_reports',
    'home_positive_accounts', 'home_savings', 'home_loan_officer'
  )),
  done boolean not null,
  created_at timestamptz not null default now()
);

create index aftercare_marks_user_idx on public.aftercare_marks (user_id, item_key, seq desc);

alter table public.aftercare_marks enable row level security;

create trigger aftercare_marks_append_only
  before update or delete on public.aftercare_marks
  for each row execute function public.partner_records_append_only();

create policy "own aftercare marks read" on public.aftercare_marks
  for select using (auth.uid() = user_id);

create policy "staff read aftercare marks" on public.aftercare_marks
  for select using (public.staff_can_see_case(user_id));

-- ── Graduation ──────────────────────────────────────────────────────────

create table public.program_completions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  completed_at timestamptz not null default now(),
  -- disputes_done: nothing the client marked is still waiting; client_chose: they chose to finish.
  reason text not null check (reason in ('disputes_done', 'client_chose')),
  -- Free after-care tips by message after the program (the client's choice).
  keep_tips boolean not null default true,
  locale text not null default 'en' check (locale in ('es', 'en'))
);

alter table public.program_completions enable row level security;

create policy "own completion read" on public.program_completions
  for select using (auth.uid() = user_id);

create policy "staff read completions" on public.program_completions
  for select using (public.staff_can_see_client(user_id));

create function public.program_completions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a record;
begin
  if tg_op = 'DELETE' then
    raise exception 'program_completions: a completion is a record and cannot be deleted';
  end if;
  if tg_op = 'UPDATE' then
    -- The one change: the client turns the free tips on or off.
    if new.user_id is distinct from old.user_id or new.completed_at is distinct from old.completed_at
      or new.reason is distinct from old.reason or new.locale is distinct from old.locale then
      raise exception 'program_completions: only the tips choice can change';
    end if;
    return new;
  end if;
  new.completed_at := now();
  select * into a from public.service_agreements where user_id = new.user_id order by created_at desc limit 1;
  if not found or a.signed_at is null then
    raise exception 'program_completions: the client has no signed agreement';
  end if;
  if a.cancelled_at is not null then
    raise exception 'program_completions: the agreement was cancelled';
  end if;
  if a.cancellation_deadline >= now() then
    raise exception 'program_completions: inside the cancellation window the client cancels instead';
  end if;
  return new;
end;
$$;

revoke all on function public.program_completions_guard() from public;

create trigger program_completions_guard
  before insert or update or delete on public.program_completions
  for each row execute function public.program_completions_guard();

-- Graduating ends the service on the agreement, in the same transaction: the
-- letter gate (src/lib/agreement/gate.ts) holds every letter, and the charges
-- trigger refuses every new charge ("the client asked to end the service").
-- Work already performed and not billed goes to a person, as in docs/BILLING.md.
create function public.program_completions_end_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.service_agreements
    set service_end_requested_at = coalesce(service_end_requested_at, now()),
        service_end_reason = coalesce(service_end_reason, 'Program completed (graduation)')
  where id = (select s.id from public.service_agreements s where s.user_id = new.user_id order by s.created_at desc limit 1);
  return new;
end;
$$;

revoke all on function public.program_completions_end_service() from public;

create trigger program_completions_end_service
  after insert on public.program_completions
  for each row execute function public.program_completions_end_service();

-- ── Partner offers ──────────────────────────────────────────────────────

create table public.offer_marketplace_changes (
  seq bigint generated always as identity primary key,
  enabled boolean not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_name text not null default '' check (char_length(changed_by_name) <= 80),
  changed_at timestamptz not null default now()
);

alter table public.offer_marketplace_changes enable row level security;

create trigger offer_marketplace_changes_append_only
  before update or delete on public.offer_marketplace_changes
  for each row execute function public.partner_records_append_only();

create policy "admin read offer switch" on public.offer_marketplace_changes
  for select using (public.staff_role() = 'admin');

-- Off unless the newest record turned it on.
create function public.offers_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.enabled from public.offer_marketplace_changes c order by c.seq desc limit 1), false);
$$;

revoke all on function public.offers_enabled() from public;
grant execute on function public.offers_enabled() to authenticated;

create table public.partner_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('secured_card', 'credit_builder_loan', 'rent_reporting', 'utility_reporting', 'other')),
  provider text not null check (char_length(btrim(provider)) between 2 and 80),
  -- What the client pays in the first year, in cents (fees, interest the provider states,
  -- subscription). A refundable deposit is not a cost; it goes in cost_note.
  yearly_cost_cents integer not null check (yearly_cost_cents between 0 and 1000000),
  cost_note text not null check (char_length(btrim(cost_note)) between 2 and 200),
  url text not null check (char_length(url) <= 500 and url ~ '^https://[^[:space:]<>"]{4,}$'),
  itin_friendly boolean not null default false,
  -- Credalti may be paid if the client signs up. The amount is never stored here.
  affiliate boolean not null default false,
  affiliate_disclosure text check (affiliate_disclosure is null or char_length(btrim(affiliate_disclosure)) between 20 and 400),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_offers_affiliate_disclosed check (not affiliate or affiliate_disclosure is not null)
);

alter table public.partner_offers enable row level security;

create policy "admin read offers" on public.partner_offers
  for select using (public.staff_role() = 'admin');

-- What a client sees: active offers, only while the switch is on, cheapest
-- first and then by name. Never ranked by what Credalti may be paid.
create function public.client_offers()
returns table (
  id uuid, name text, kind text, provider text, yearly_cost_cents integer, cost_note text,
  url text, itin_friendly boolean, affiliate boolean, affiliate_disclosure text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.kind, o.provider, o.yearly_cost_cents, o.cost_note, o.url, o.itin_friendly, o.affiliate, o.affiliate_disclosure
  from public.partner_offers o
  where o.active and public.offers_enabled() and auth.uid() is not null
  order by o.yearly_cost_cents asc, lower(o.name) asc, o.id;
$$;

revoke all on function public.client_offers() from public, anon;
grant execute on function public.client_offers() to authenticated;

-- ── Loan officers accepting new clients ─────────────────────────────────

alter table public.partners
  add column accepting_clients boolean not null default false,
  add constraint partners_accepting_is_loan_officer check (not accepting_clients or kind = 'loan_officer');

-- Public faces of approved loan officers who accept new clients, by name.
create function public.accepting_loan_officers()
returns table (partner_id uuid, name text, company text, kind text, logo_data text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.company, p.kind, case when p.logo_status = 'approved' then p.logo_data else null end
  from public.partners p
  where p.status = 'approved' and p.accepting_clients and p.kind = 'loan_officer' and auth.uid() is not null
  order by lower(p.name), p.id;
$$;

revoke all on function public.accepting_loan_officers() from public, anon;
grant execute on function public.accepting_loan_officers() to authenticated;

-- ── Home-ready sharing: an extension of the 0023 consent ────────────────

alter table public.partner_share_consents
  add column home_ready boolean not null default false,
  add constraint partner_share_consents_home_ready_needs_level check (not home_ready or level <> 'none');

-- As in 0023, plus: a record must change the level or the home-ready choice,
-- and home-ready milestones go only to a real estate agent or a loan officer.
create or replace function public.partner_share_consents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prior text;
  prior_home boolean;
  partner_status text;
  partner_kind text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'partner_share_consents: a consent record cannot be changed or deleted';
  end if;
  select c.level, c.home_ready into prior, prior_home from public.partner_share_consents c
    where c.user_id = new.user_id and c.partner_id = new.partner_id
    order by c.seq desc limit 1;
  new.previous_level := coalesce(prior, 'none');
  if new.level = new.previous_level and new.home_ready = coalesce(prior_home, false) then
    raise exception 'partner_share_consents: the level is already %', new.level;
  end if;
  new.action := case
    when new.previous_level = 'none' then 'grant'
    when new.level = 'none' then 'revoke'
    else 'change'
  end;
  new.created_at := now();
  if new.level <> 'none' then
    select p.status, p.kind into partner_status, partner_kind from public.partners p where p.id = new.partner_id;
    if partner_status is distinct from 'approved' then
      raise exception 'partner_share_consents: sharing can be granted only to an approved partner';
    end if;
    if new.home_ready and partner_kind not in ('loan_officer', 'realtor') then
      raise exception 'partner_share_consents: home-ready milestones go only to a real estate agent or a loan officer';
    end if;
  end if;
  if new.how = 'referred' and not exists (
    select 1 from public.profiles pr where pr.id = new.user_id and pr.referred_partner_id = new.partner_id
  ) then
    raise exception 'partner_share_consents: this partner did not refer this client';
  end if;
  return new;
end;
$$;

-- The home-ready milestones of one client, for the signed-in partner: only
-- while the client's newest consent record for this partner shares them,
-- only for an approved partner with the current terms. Milestone names and
-- dates, nothing else. The partner's page calls partner_client_view() first,
-- which logs the view.
create function public.partner_home_ready(p_client uuid)
returns table (milestone text, done_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  pid uuid := public.partner_id();
  shares boolean;
  r record;
begin
  if pid is null or p_client is null or not public.partner_terms_ok() then
    return;
  end if;
  select (c.level <> 'none' and c.home_ready) into shares from public.partner_share_consents c
    where c.user_id = p_client and c.partner_id = pid order by c.seq desc limit 1;
  if not coalesce(shares, false) then
    return;
  end if;
  select * into r from public.partner_progress_rows(pid, p_client) limit 1;
  if not found then
    return;
  end if;
  milestone := 'documents'; done_at := r.documents_complete_at; return next;
  milestone := 'report_reviewed'; done_at := r.review_finished_at; return next;
  milestone := 'disputes_in_progress';
  done_at := (select min((x ->> 'mailed_at')::timestamptz) from jsonb_array_elements(r.rounds) x);
  return next;
  for milestone, done_at in
    select k.milestone, (
      select case when m.done then m.created_at else null end from public.aftercare_marks m
      where m.user_id = p_client and m.item_key = k.item_key order by m.seq desc limit 1
    )
    from (values ('positive_accounts', 'home_positive_accounts'), ('savings', 'home_savings'), ('loan_officer', 'home_loan_officer')) as k (milestone, item_key)
  loop
    return next;
  end loop;
  milestone := 'graduated';
  done_at := (select pc.completed_at from public.program_completions pc where pc.user_id = p_client);
  return next;
end;
$$;

revoke all on function public.partner_home_ready(uuid) from public, anon;
grant execute on function public.partner_home_ready(uuid) to authenticated;

-- ── "Connect me with a loan officer" ────────────────────────────────────

create table public.loan_officer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- referred: the partner who referred the client; accepting: a loan officer an administrator marked as accepting new clients.
  how text not null check (how in ('referred', 'accepting')),
  text_version text not null check (char_length(text_version) between 4 and 40),
  locale text not null check (locale in ('es', 'en')),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  partner_name_shown text not null check (char_length(partner_name_shown) between 2 and 210),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

-- One open request at a time.
create unique index loan_officer_requests_one_open on public.loan_officer_requests (user_id) where withdrawn_at is null;
create index loan_officer_requests_partner_idx on public.loan_officer_requests (partner_id, created_at desc);

alter table public.loan_officer_requests enable row level security;

create function public.loan_officer_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p record;
begin
  if tg_op = 'DELETE' then
    raise exception 'loan_officer_requests: a request is a record and cannot be deleted';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.partner_id is distinct from old.partner_id
      or new.how is distinct from old.how or new.text_version is distinct from old.text_version or new.locale is distinct from old.locale
      or new.text_hash is distinct from old.text_hash or new.partner_name_shown is distinct from old.partner_name_shown
      or new.created_at is distinct from old.created_at or old.withdrawn_at is not null or new.withdrawn_at is null then
      raise exception 'loan_officer_requests: only withdrawing an open request is allowed';
    end if;
    return new;
  end if;
  new.created_at := now();
  new.withdrawn_at := null;
  select * into p from public.partners where id = new.partner_id;
  if not found or p.status <> 'approved' then
    raise exception 'loan_officer_requests: the partner is not approved';
  end if;
  if new.how = 'referred' then
    if p.kind not in ('loan_officer', 'realtor') or not exists (
      select 1 from public.profiles pr where pr.id = new.user_id and pr.referred_partner_id = new.partner_id
    ) then
      raise exception 'loan_officer_requests: this partner did not refer this client, or does not help with home loans';
    end if;
  elsif not (p.kind = 'loan_officer' and p.accepting_clients) then
    raise exception 'loan_officer_requests: this loan officer is not accepting new clients';
  end if;
  return new;
end;
$$;

revoke all on function public.loan_officer_requests_guard() from public;

create trigger loan_officer_requests_guard
  before insert or update or delete on public.loan_officer_requests
  for each row execute function public.loan_officer_requests_guard();

create policy "own loan officer requests read" on public.loan_officer_requests
  for select using (auth.uid() = user_id);

create policy "staff read loan officer requests" on public.loan_officer_requests
  for select using (public.staff_can_see_client(user_id));

-- The open introductions asked of the signed-in partner: what the client
-- agreed to send (name, phone, goal) and when. Nothing else.
create function public.partner_intro_requests()
returns table (request_id uuid, display_name text, phone_e164 text, goal text, requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, btrim(pr.full_name), pr.phone_e164,
    case when pr.goal in ('mortgage', 'auto', 'card', 'general') then pr.goal else null end,
    q.created_at
  from public.loan_officer_requests q
  join public.profiles pr on pr.id = q.user_id
  where q.partner_id = public.partner_id() and q.withdrawn_at is null and public.partner_terms_ok()
  order by q.created_at desc;
$$;

revoke all on function public.partner_intro_requests() from public, anon;
grant execute on function public.partner_intro_requests() to authenticated;
