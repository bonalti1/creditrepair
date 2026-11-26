-- Two service options, chosen per client (docs/SERVICE-OPTIONS.md).
--
--   "Done for you" (full_service): what Credalti has always sold. The client
--   reviews their report with Alti and says what is inaccurate; the team
--   prepares and mails the letters; every charge waits for the work it pays
--   for (migrations 0011 and 0026). NOTHING about how a full-service client is
--   charged changes here: every full-service rule of the charge trigger is
--   kept as it was, and the database tests prove it again
--   (src/lib/__tests__/db/serviceOptions.test.ts).
--
--   "Do it yourself, guided" (diy): the client uses the software with Alti.
--   Alti prepares the letters from the same approved templates; the client
--   prints and mails them, or asks Credalti to mail one for them for a fee per
--   letter shown before they confirm. The owner reports (2026-11-25) that the
--   attorney approved this option priced as a monthly subscription charged
--   from the start, because the client performs the disputes with the
--   software. "From the start" begins after the 3-business-day cancellation
--   window, which stays.
--
-- What this migration adds and changes:
--
--   client_service_options   the option each client chose (signup, an
--                            invitation, the Plans or More screen). Server
--                            writes only; the client reads their own.
--   service_option_changes   append-only history of every choice and switch.
--   billing_plans            plan type 'diy_subscription', and the column
--                            service_option (derived from the plan type) so a
--                            plan says which option it is for; one default
--                            plan per option. A DIY plan: a monthly amount,
--                            due "after the cancellation window", an optional
--                            mailing fee per letter, no first work fee.
--   service_agreements       an agreement now says which option it is for
--                            (terms.serviceOption; absent = full service). A
--                            client switching option signs a new agreement;
--                            signing it marks the old one superseded (never
--                            edited otherwise). The signed plan must be for
--                            the same option as the agreement.
--   attack_rounds            mail_via 'client': the client mailed the round
--                            themselves. Never counts as work we performed.
--   letters                  mail_provider 'client', same meaning.
--   mail_requests            "Mail them for me": the letters a DIY client
--                            asked Credalti to mail, the fee per letter from
--                            their signed plan, and the total they accepted.
--   billing_plans.terms      periodTiming (owner's decision, 2026-11-25):
--                            a full-service monthly subscription may charge a
--                            30-day period right after the round mailed in it
--                            ("on_mailing", the default for new plans), or
--                            when the period ends ("period_end", as 0026 and
--                            every plan without the field). Either way: only
--                            a period with a round we mailed, once, after the
--                            window, capped, 30 days apart.
--   charges                  two new units, allowed ONLY under a signed DIY
--                            plan: 'diy_period' (the monthly subscription, at
--                            the start of each 30-day period after the
--                            cancellation window) and 'mailing' (a mail
--                            request, after Credalti mailed it). Every other
--                            unit keeps its full-service rules, and a
--                            full-service charge never counts a round the
--                            client mailed themselves.
--
-- Who writes: only the server, with the service role. Clients read their own
-- option, history and mail requests; staff read them by scope
-- (staff_can_see_client). No insert, update or delete policy for anyone.

-- ── The option each client chose ────────────────────────────────────────

create table public.client_service_options (
  user_id uuid primary key references auth.users (id) on delete cascade,
  service_option text not null default 'full_service' check (service_option in ('full_service', 'diy')),
  -- Where the choice was made.
  chosen_via text not null check (chosen_via in ('signup_chat', 'invitation', 'onboarding', 'app', 'switch', 'staff_invite')),
  chosen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_service_options enable row level security;
create policy "own service option read" on public.client_service_options
  for select using (auth.uid() = user_id);
create policy "staff read service options" on public.client_service_options
  for select using (public.staff_can_see_client(user_id));

create table public.service_option_changes (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  from_option text check (from_option is null or from_option in ('full_service', 'diy')),
  to_option text not null check (to_option in ('full_service', 'diy')),
  chosen_via text not null check (chosen_via in ('signup_chat', 'invitation', 'onboarding', 'app', 'switch', 'staff_invite')),
  -- A switch after signing names the agreement it leaves; the new one is signed separately.
  from_agreement_id uuid references public.service_agreements (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index service_option_changes_user_idx on public.service_option_changes (user_id, seq);

alter table public.service_option_changes enable row level security;
create policy "own service option changes read" on public.service_option_changes
  for select using (auth.uid() = user_id);
create policy "staff read service option changes" on public.service_option_changes
  for select using (public.staff_can_see_client(user_id));

create trigger service_option_changes_append_only
  before update or delete on public.service_option_changes
  for each row execute function public.partner_records_append_only();

-- ── Plans: an option per plan ───────────────────────────────────────────

alter table public.billing_plans drop constraint billing_plans_plan_type_check;
alter table public.billing_plans
  add constraint billing_plans_plan_type_check check (plan_type in ('subscription', 'per_round', 'flat_fee', 'pay_per_delete', 'diy_subscription')),
  add column service_option text generated always as (case when plan_type = 'diy_subscription' then 'diy' else 'full_service' end) stored;

-- One default plan per option (the one offered to a client of that option who was not offered another).
drop index public.billing_plans_one_default;
create unique index billing_plans_one_default on public.billing_plans (service_option) where is_default;

-- The most a client on these terms can be charged (list price), or null when unbounded.
-- Adds the DIY subscription: N months × the monthly amount. A mailing fee is
-- not in it: each mailing is a separate purchase the client accepts first.
create or replace function public.billing_plan_max_cents(t jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  fw integer := coalesce((t ->> 'firstWorkFeeCents')::integer, 0);
  rec integer := coalesce((t ->> 'recurringCents')::integer, 0);
  cap integer := (t ->> 'maxTotalCents')::integer;
  implied integer;
begin
  if t ->> 'type' = 'flat_fee' then
    implied := fw + (t -> 'flat' ->> 'totalCents')::integer;
  elsif t ->> 'type' in ('subscription', 'diy_subscription') and t -> 'duration' ->> 'kind' = 'months' then
    implied := fw + (t -> 'duration' ->> 'count')::integer * rec;
  elsif t ->> 'type' = 'per_round' and t -> 'duration' ->> 'kind' = 'rounds' then
    implied := fw + (t -> 'duration' ->> 'count')::integer * rec;
  end if;
  if implied is null then return cap; end if;
  if cap is null then return implied; end if;
  return least(implied, cap);
end;
$$;

-- What src/lib/billing/plans.ts (validatePlanTerms) checks, again, for every
-- write. As in 0026, with the DIY plan type: its due date is "after the
-- cancellation window" (and only a DIY plan may say so), it has no first work
-- fee and no flat total, and its optional mailing fee is 0 to $25 per letter.
create or replace function public.billing_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  t jsonb;
  kind text;
  diy boolean;
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then return old; end if;
    raise exception 'billing_plans: an offered plan version is a record and cannot be deleted';
  end if;

  t := new.terms;
  diy := new.plan_type = 'diy_subscription';
  if coalesce((t ->> 'firstWorkFeeCents')::integer, -1) < 0 or coalesce((t ->> 'recurringCents')::integer, -1) < 0 then
    raise exception 'billing_plans: amounts must be whole cents, zero or more';
  end if;
  kind := t -> 'dueRule' ->> 'kind';
  if kind in ('days_after_plan_saved', 'when_letters_saved') then
    raise exception 'billing_plans: that due date can charge before any work is performed (15 U.S.C. §1679b(b))';
  end if;
  if diy then
    if kind is distinct from 'after_cancellation_window' then
      raise exception 'billing_plans: a do-it-yourself subscription is due after the cancellation window';
    end if;
    if coalesce((t ->> 'firstWorkFeeCents')::integer, 0) <> 0 then
      raise exception 'billing_plans: a do-it-yourself plan has no first work fee';
    end if;
    if t ? 'mailFeeCents' and (jsonb_typeof(t -> 'mailFeeCents') <> 'number' or (t ->> 'mailFeeCents')::integer not between 0 and 2500) then
      raise exception 'billing_plans: the mailing fee is 0 to 2500 cents per letter';
    end if;
  else
    if kind is distinct from 'after_first_round' and kind is distinct from 'days_after_first_round' then
      raise exception 'billing_plans: the due date is after the first round is mailed, or N days after it';
    end if;
    if t ? 'mailFeeCents' then
      raise exception 'billing_plans: only a do-it-yourself plan has a mailing fee';
    end if;
  end if;
  if t ? 'periodTiming' and (new.plan_type <> 'subscription' or t ->> 'periodTiming' not in ('on_mailing', 'period_end')) then
    raise exception 'billing_plans: only a monthly subscription has a period timing: on_mailing or period_end';
  end if;
  if kind = 'days_after_first_round' and coalesce((t -> 'dueRule' ->> 'days')::integer, 0) not between 1 and 30 then
    raise exception 'billing_plans: N days after the first round must be 1 to 30';
  end if;
  if coalesce((t ->> 'householdDiscountPercent')::integer, -1) not between 0 and 50 then
    raise exception 'billing_plans: the household discount is 0 to 50 percent';
  end if;
  if new.plan_type = 'flat_fee' then
    if jsonb_typeof(t -> 'flat') <> 'object' or (t -> 'flat' ->> 'totalCents')::integer <= 0
       or (t -> 'flat' ->> 'rounds')::integer not between 1 and 24
       or t -> 'flat' ->> 'schedule' not in ('installments', 'after_last_round') then
      raise exception 'billing_plans: a flat fee needs a total, its rounds and its schedule';
    end if;
  elsif (t ->> 'recurringCents')::integer <= 0 then
    raise exception 'billing_plans: the recurring amount must be positive';
  end if;
  if diy and jsonb_typeof(t -> 'flat') = 'object' then
    raise exception 'billing_plans: a do-it-yourself plan has no flat total';
  end if;
  if new.plan_type = 'pay_per_delete' and (t ->> 'firstWorkFeeCents')::integer > 0 then
    raise exception 'billing_plans: pay per delete has no first work fee';
  end if;
  if public.billing_plan_max_cents(t) is null or public.billing_plan_max_cents(t) <= 0 then
    raise exception 'billing_plans: a plan with no end needs a maximum total';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'billing_plans: a plan version starts as a draft';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.plan_key <> old.plan_key or new.version <> old.version or new.created_at <> old.created_at then
    raise exception 'billing_plans: a version keeps its plan and number';
  end if;
  if old.status <> 'draft' and (
    new.terms is distinct from old.terms or new.terms_hash is distinct from old.terms_hash
    or new.name_en is distinct from old.name_en or new.name_es is distinct from old.name_es
    or new.plan_type is distinct from old.plan_type or new.text_version is distinct from old.text_version
    or new.attorney_name is distinct from old.attorney_name or new.attorney_approved_on is distinct from old.attorney_approved_on
  ) then
    raise exception 'billing_plans: an offered plan version cannot be changed; make a new version';
  end if;
  if new.status <> old.status then
    if not ((old.status = 'draft' and new.status = 'active') or (old.status = 'active' and new.status = 'retired')) then
      raise exception 'billing_plans: a plan goes draft → active → retired, nothing else';
    end if;
    if new.status = 'active' and new.plan_type = 'pay_per_delete' and not public.billing_switch_on('pay_per_delete') then
      raise exception 'billing_plans: pay per delete is off until an administrator records the attorney''s approval';
    end if;
  end if;
  return new;
end;
$$;

-- ── Agreements: one option each; a switch supersedes the old one ────────

alter table public.service_agreements
  add column superseded_at timestamptz,
  -- Deferred: the new agreement may be inserted signed in one step (its row exists by commit).
  add column superseded_by uuid references public.service_agreements (id) on delete restrict deferrable initially deferred,
  add constraint service_agreements_superseded_shape check ((superseded_at is null) = (superseded_by is null)),
  add constraint service_agreements_superseded_after_signature check (superseded_at is null or (signed_at is not null and superseded_at >= signed_at));

-- One agreement in force per client: signed, not cancelled, not superseded.
drop index public.service_agreements_one_in_force;
create unique index service_agreements_one_in_force
  on public.service_agreements (user_id)
  where signed_at is not null and cancelled_at is null and superseded_at is null;

-- The option an agreement (or its signed terms) is for. Absent: full service, as every agreement before 0042.
create function public.agreement_service_option(terms jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when terms ->> 'serviceOption' = 'diy' then 'diy' else 'full_service' end;
$$;

-- The agreement that governs a client: the one in force (signed, not
-- cancelled, not superseded) when there is one, else the newest. Before 0042
-- these were always the same row (a new acknowledgement was refused while one
-- was in force); with a switch, the client keeps their current agreement
-- until they sign the new one, so it is the one in force that decides.
create function public.governing_agreement(uid uuid)
returns public.service_agreements
language sql
stable
set search_path = ''
as $$
  select a.* from public.service_agreements a
   where a.user_id = uid
   order by (a.signed_at is not null and a.cancelled_at is null and a.superseded_at is null) desc, a.created_at desc
   limit 1;
$$;

-- The record rules of 0010, plus: superseded is written once, never changed.
create or replace function public.service_agreements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'service_agreements: a row is a record and cannot be deleted';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.document_version is distinct from old.document_version
    or new.disclosure_acknowledged_at is distinct from old.disclosure_acknowledged_at
    or new.disclosure_locale is distinct from old.disclosure_locale
    or new.disclosure_hash is distinct from old.disclosure_hash
    or new.created_at is distinct from old.created_at
  then
    raise exception 'service_agreements: the disclosure acknowledgement cannot be changed';
  end if;

  if old.signed_at is not null and (
    new.signed_at is distinct from old.signed_at
    or new.signer_name is distinct from old.signer_name
    or new.locale is distinct from old.locale
    or new.document_hash is distinct from old.document_hash
    or new.signer_ip is distinct from old.signer_ip
    or new.signer_user_agent is distinct from old.signer_user_agent
    or new.terms is distinct from old.terms
    or new.cancellation_deadline is distinct from old.cancellation_deadline
  ) then
    raise exception 'service_agreements: a signed agreement cannot be changed';
  end if;

  if old.cancelled_at is not null and (
    new.cancelled_at is distinct from old.cancelled_at
    or new.cancelled_within_window is distinct from old.cancelled_within_window
    or new.cancellation_reason is distinct from old.cancellation_reason
  ) then
    raise exception 'service_agreements: a recorded cancellation cannot be changed';
  end if;

  if old.superseded_at is not null and (
    new.superseded_at is distinct from old.superseded_at or new.superseded_by is distinct from old.superseded_by
  ) then
    raise exception 'service_agreements: a superseded agreement stays superseded';
  end if;

  return new;
end;
$$;

-- Signing an agreement for the OTHER option while one is in force is a
-- switch: the old one is marked superseded by the new one, at the moment of
-- the signature. Signing a second agreement for the same option is refused,
-- as before (the unique index). Nothing else about the old row changes.
create function public.service_agreements_supersede()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o public.service_agreements%rowtype;
begin
  if new.signed_at is null or (tg_op = 'UPDATE' and old.signed_at is not null) then
    return new;
  end if;
  select * into o from public.service_agreements
   where user_id = new.user_id and id <> new.id
     and signed_at is not null and cancelled_at is null and superseded_at is null
   limit 1;
  if not found then
    return new;
  end if;
  if public.agreement_service_option(o.terms) = public.agreement_service_option(new.terms) then
    raise exception 'service_agreements: the client already has an agreement in force for this option';
  end if;
  update public.service_agreements set superseded_at = new.signed_at, superseded_by = new.id where id = o.id;
  return new;
end;
$$;

revoke all on function public.service_agreements_supersede() from public;

create trigger service_agreements_supersede
  before insert or update on public.service_agreements
  for each row execute function public.service_agreements_supersede();

-- A signature under a plan carries that exact plan (0026), and now also: the
-- plan is for the agreement's option, and a DIY plan's mailing fee is the
-- plan's own. A full-service agreement can never carry a DIY plan, nor the
-- other way round.
create or replace function public.service_agreements_plan_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s jsonb;
  p public.billing_plans%rowtype;
  pct integer;
  maxc integer;
begin
  if new.signed_at is null or (tg_op = 'UPDATE' and old.signed_at is not null) then
    return new;
  end if;
  s := new.terms -> 'plan';
  if s is null or jsonb_typeof(s) = 'null' then
    return new;
  end if;
  select * into p from public.billing_plans where id = (s ->> 'planId')::uuid;
  if not found or p.status <> 'active' then
    raise exception 'service_agreements: the plan signed is not an active plan version';
  end if;
  if (s ->> 'version')::integer is distinct from p.version or s ->> 'termsHash' is distinct from p.terms_hash or (s -> 'terms') is distinct from p.terms then
    raise exception 'service_agreements: the plan signed is not exactly the plan version on record';
  end if;
  if p.service_option is distinct from public.agreement_service_option(new.terms)
     or (s ? 'option' and s ->> 'option' is distinct from p.service_option) then
    raise exception 'service_agreements: the plan signed is for the other service option';
  end if;
  if p.plan_type = 'pay_per_delete' and not public.billing_switch_on('pay_per_delete') then
    raise exception 'service_agreements: pay per delete is off until the attorney''s approval is recorded';
  end if;
  pct := coalesce((s ->> 'householdDiscountPercent')::integer, -1);
  if pct <> 0 and (pct <> (p.terms ->> 'householdDiscountPercent')::integer or public.household_partner(new.user_id) is null) then
    raise exception 'service_agreements: a household discount needs the plan''s discount and a linked household';
  end if;
  maxc := public.billing_plan_max_cents(p.terms);
  if (s -> 'effective' ->> 'firstWorkFeeCents')::integer is distinct from round((p.terms ->> 'firstWorkFeeCents')::integer * (100 - pct) / 100.0)::integer
     or (s -> 'effective' ->> 'recurringCents')::integer is distinct from round((p.terms ->> 'recurringCents')::integer * (100 - pct) / 100.0)::integer
     or (s -> 'effective' ->> 'flatTotalCents')::integer is distinct from round(coalesce((p.terms -> 'flat' ->> 'totalCents')::integer, 0) * (100 - pct) / 100.0)::integer
     or (s -> 'effective' ->> 'maxTotalCents')::integer is distinct from round(maxc * (100 - pct) / 100.0)::integer
     or coalesce((s -> 'effective' ->> 'mailFeeCents')::integer, 0) is distinct from coalesce((p.terms ->> 'mailFeeCents')::integer, 0)
  then
    raise exception 'service_agreements: the plan amounts signed are not the plan''s amounts';
  end if;
  return new;
end;
$$;

-- ── Who mailed a round ──────────────────────────────────────────────────

alter table public.attack_rounds drop constraint attack_rounds_mail_via_check;
alter table public.attack_rounds
  add constraint attack_rounds_mail_via_check check (mail_via is null or mail_via in ('mail', 'print', 'client'));

alter table public.letters drop constraint letters_mail_provider_check;
alter table public.letters
  add constraint letters_mail_provider_check check (mail_provider in ('lob', 'simulated', 'print', 'client'));

-- A mailed round of this client, after the cancellation window, with a letter
-- that went out, and mailed BY US: a round the client mailed themselves is
-- never work we performed. Null otherwise.
create or replace function public.billing_performed_round(rid uuid, uid uuid, after timestamptz)
returns public.attack_rounds
language sql
stable
set search_path = ''
as $$
  select r.* from public.attack_rounds r
   where r.id = rid and r.user_id = uid
     and r.status in ('mailed', 'complete') and r.mailed_at is not null and r.mailed_at <= now()
     and r.mailed_at > after
     and r.mail_via is distinct from 'client'
     and exists (select 1 from public.letters l where l.round_id = r.id and l.status in ('queued', 'mailed', 'delivered'));
$$;

-- Pay per delete counts an item disputed THROUGH US: never one in a round the client mailed themselves.
create or replace function public.billing_result_proved_at(uid uuid, item uuid, after timestamptz, counts_updated boolean)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with dispute as (
    select min(r.mailed_at) as disputed_at
      from public.letter_items li
      join public.letters l on l.id = li.letter_id
      join public.attack_rounds r on r.id = l.round_id
     where li.item_id = item and l.user_id = uid
       and l.status in ('queued', 'mailed', 'delivered')
       and l.mail_provider is distinct from 'client'
       and r.status in ('mailed', 'complete') and r.mailed_at is not null
       and r.mail_via is distinct from 'client'
       and r.mailed_at > after and r.mailed_at <= now()
  )
  select min(p.pulled_at)
    from public.item_results ir
    join public.report_pulls p on p.id = ir.proof_pull_id
    join public.report_items i on i.id = ir.item_id
    cross join dispute d
   where ir.item_id = item and ir.user_id = uid and d.disputed_at is not null
     and p.pulled_at > d.disputed_at and p.pulled_at <= now()
     and (
       (ir.outcome = 'deleted' and i.status = 'deleted'
         and coalesce((select s.pulled_at from public.report_pulls s where s.id = i.last_seen_pull), '-infinity') < p.pulled_at)
       or (ir.outcome = 'updated' and counts_updated)
     );
$$;

-- ── "Mail them for me" ──────────────────────────────────────────────────

create table public.mail_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  round_id uuid not null references public.attack_rounds (id) on delete restrict,
  -- The DIY agreement in force when the client asked (set by the trigger).
  agreement_id uuid not null references public.service_agreements (id) on delete restrict,
  -- The prepared letters (drafts) the client asked us to mail.
  letter_ids uuid[] not null,
  letter_count integer not null check (letter_count between 1 and 40),
  -- The fee per letter in the signed plan, and what the client saw and accepted.
  fee_cents integer not null check (fee_cents between 1 and 2500),
  total_cents integer not null,
  accepted_at timestamptz not null default now(),
  accepted_ip text check (accepted_ip is null or char_length(accepted_ip) <= 80),
  accepted_user_agent text check (accepted_user_agent is null or char_length(accepted_user_agent) <= 400),
  status text not null default 'requested' check (status in ('requested', 'mailed', 'cancelled')),
  mailed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  constraint mail_requests_total check (total_cents = fee_cents * letter_count),
  constraint mail_requests_mailed_dated check ((status = 'mailed') = (mailed_at is not null)),
  constraint mail_requests_cancelled_dated check ((status = 'cancelled') = (cancelled_at is not null))
);

create index mail_requests_user_idx on public.mail_requests (user_id, created_at);
create unique index mail_requests_one_open_per_round on public.mail_requests (round_id) where status = 'requested';

alter table public.mail_requests enable row level security;
create policy "own mail requests read" on public.mail_requests
  for select using (auth.uid() = user_id);
create policy "staff read mail requests" on public.mail_requests
  for select using (public.staff_can_see_client(user_id));

create function public.mail_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.service_agreements%rowtype;
  s jsonb;
  fee integer;
  n integer;
  l uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'mail_requests: a request is a record and cannot be deleted';
  end if;

  if tg_op = 'INSERT' then
    a := public.governing_agreement(new.user_id);
    if a.id is null or a.signed_at is null or a.cancelled_at is not null or a.superseded_at is not null then
      raise exception 'mail_requests: the client has no agreement in force';
    end if;
    if public.agreement_service_option(a.terms) <> 'diy' then
      raise exception 'mail_requests: only a do-it-yourself client asks us to mail a letter; under full service the team mails every round';
    end if;
    if a.cancellation_deadline is null or a.cancellation_deadline >= now() then
      raise exception 'mail_requests: nothing is mailed inside the cancellation window';
    end if;
    if a.service_end_requested_at is not null then
      raise exception 'mail_requests: the client asked to end the service';
    end if;
    s := a.terms -> 'plan';
    fee := coalesce((s -> 'effective' ->> 'mailFeeCents')::integer, 0);
    if s is null or s -> 'terms' ->> 'type' <> 'diy_subscription' or fee <= 0 then
      raise exception 'mail_requests: the signed plan does not offer mailing';
    end if;
    if new.fee_cents is distinct from fee then
      raise exception 'mail_requests: the fee per letter is the one in the signed plan (% cents)', fee;
    end if;
    n := coalesce(cardinality(new.letter_ids), 0);
    if n = 0 or (select count(distinct x) from unnest(new.letter_ids) x) <> n or new.letter_count <> n then
      raise exception 'mail_requests: the letters must be listed once each, and counted';
    end if;
    foreach l in array new.letter_ids loop
      if not exists (select 1 from public.letters x where x.id = l and x.user_id = new.user_id and x.round_id = new.round_id and x.status = 'draft') then
        raise exception 'mail_requests: letter % is not a prepared letter of this round', l;
      end if;
      if exists (select 1 from public.mail_requests m where m.status <> 'cancelled' and l = any (m.letter_ids)) then
        raise exception 'mail_requests: letter % is already in a request', l;
      end if;
    end loop;
    if new.status <> 'requested' or new.mailed_at is not null or new.cancelled_at is not null then
      raise exception 'mail_requests: a request starts as requested';
    end if;
    new.agreement_id := a.id;
    new.created_at := now();
    new.accepted_at := now();
    return new;
  end if;

  if new.id <> old.id or new.user_id <> old.user_id or new.round_id <> old.round_id or new.agreement_id <> old.agreement_id
     or new.letter_ids <> old.letter_ids or new.letter_count <> old.letter_count or new.fee_cents <> old.fee_cents
     or new.total_cents <> old.total_cents or new.accepted_at <> old.accepted_at or new.created_at <> old.created_at
     or new.accepted_ip is distinct from old.accepted_ip or new.accepted_user_agent is distinct from old.accepted_user_agent then
    raise exception 'mail_requests: what the client asked for and accepted cannot be changed';
  end if;
  if old.status <> 'requested' and (new.status is distinct from old.status or new.mailed_at is distinct from old.mailed_at or new.cancelled_at is distinct from old.cancelled_at) then
    raise exception 'mail_requests: a mailed or cancelled request is final';
  end if;
  if new.status = 'mailed' and old.status = 'requested' then
    if exists (
      select 1 from unnest(new.letter_ids) x
       where not exists (
         select 1 from public.letters l
          where l.id = x and l.status in ('queued', 'mailed', 'delivered') and l.mail_provider is distinct from 'client'
       )
    ) then
      raise exception 'mail_requests: a request is mailed only when we mailed every one of its letters';
    end if;
    if new.mailed_at > now() then
      raise exception 'mail_requests: the mailing date is in the future';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.mail_requests_guard() from public;

create trigger mail_requests_guard
  before insert or update or delete on public.mail_requests
  for each row execute function public.mail_requests_guard();

-- ── Charges: the two DIY units ──────────────────────────────────────────

alter table public.charges drop constraint charges_unit_check;
alter table public.charges drop constraint charges_plan_type_check;
alter table public.charges drop constraint charges_round_unless_results;
alter table public.charges drop constraint charges_period_shape;
alter table public.charges
  add constraint charges_unit_check check (unit in ('round', 'period', 'installment', 'flat', 'results', 'first_work', 'diy_period', 'mailing')),
  add constraint charges_plan_type_check check (plan_type is null or plan_type in ('subscription', 'per_round', 'flat_fee', 'pay_per_delete', 'diy_subscription')),
  add column mail_request_id uuid references public.mail_requests (id) on delete restrict,
  add constraint charges_round_unless_results check ((unit in ('results', 'diy_period')) = (round_id is null)),
  add constraint charges_period_shape check ((unit in ('period', 'diy_period')) = (period_start is not null and period_end is not null)),
  add constraint charges_mailing_shape check ((unit = 'mailing') = (mail_request_id is not null));

-- One charge per unit of work, ever: as 0026, with a mailing once per request
-- and a DIY period once per agreement and period start.
drop index public.charges_one_per_round_work;
create unique index charges_one_per_round_work on public.charges (round_id) where unit not in ('first_work', 'mailing');
drop index public.charges_one_per_period;
create unique index charges_one_per_period on public.charges (agreement_id, period_start) where unit in ('period', 'diy_period');
create unique index charges_one_per_mailing on public.charges (mail_request_id) where unit = 'mailing';

-- The gate, for every plan type. Replaces 0026's. Everything 0026 checked for
-- a full-service agreement it still checks, in the same order; the changes
-- for full service are only that a round the client mailed themselves
-- (mail_via 'client') is never work we performed, and that the two DIY units
-- are refused. A signed DIY plan is charged only its subscription (from the
-- start of each 30-day period after the cancellation window) and the
-- mailings the client asked for (after we mailed them).
create or replace function public.charges_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.attack_rounds%rowtype;
  a public.service_agreements%rowtype;
  fr public.attack_rounds%rowtype;
  m public.mail_requests%rowtype;
  s jsonb;
  t jsonb;
  e jsonb;
  fee text;
  ptype text;
  base integer;
  fw integer := 0;
  fw_due boolean;
  remaining integer;
  expected integer;
  n integer;
  k integer;
  due_days integer;
  period_index integer;
  anchor timestamptz;
  proved timestamptz;
  latest timestamptz;
  item uuid;
begin
  -- A charge is born unpaid, now. Money is recorded only after the processor answers.
  if new.status is distinct from 'pending' or new.attempts <> 0 or new.charged_at is not null
    or new.gateway_reference is not null or new.last_attempt_at is not null or new.next_attempt_at is not null
  then
    raise exception 'charges: a charge starts as pending, with no attempts';
  end if;
  new.created_at := now();

  -- The agreement: the one that governs the client (in force, else the newest), signed, past its window.
  a := public.governing_agreement(new.user_id);
  if a.id is null or a.signed_at is null then
    raise exception 'charges: the client has no signed agreement';
  end if;
  if a.cancelled_at is not null then
    raise exception 'charges: the client cancelled the agreement; nothing is charged';
  end if;
  if a.superseded_at is not null then
    raise exception 'charges: the agreement was replaced by another; nothing is charged under it';
  end if;
  if a.cancellation_deadline is null or a.cancellation_deadline >= now() then
    raise exception 'charges: the client is inside the cancellation window; nothing may be charged';
  end if;
  -- Like BILL_PERFORMED_WORK_AFTER_END_REQUEST in src/lib/billing/rules.ts. Change both together.
  if a.service_end_requested_at is not null then
    raise exception 'charges: the client asked to end the service; a person decides, nothing is charged automatically';
  end if;
  new.agreement_id := a.id;

  -- A referral credit lowers a charge that is due; it never makes one.
  if new.credit_cents > 0 then
    if not public.billing_switch_on('referral_credits') then
      raise exception 'charges: referral credits are off';
    end if;
    if new.credit_cents > public.client_credit_balance(new.user_id) then
      raise exception 'charges: the credit applied is more than the client''s credit';
    end if;
  end if;

  s := a.terms -> 'plan';
  if s is null or jsonb_typeof(s) = 'null' then
    -- A DIY agreement is charged only under its signed DIY plan.
    if public.agreement_service_option(a.terms) = 'diy' then
      raise exception 'charges: a do-it-yourself agreement without a plan is never charged';
    end if;
    -- ── No plan: as migration 0011. ──
    if new.unit <> 'round' or new.first_work_cents <> 0 or cardinality(new.result_item_ids) <> 0 then
      raise exception 'charges: an agreement without a plan is billed per mailed round only';
    end if;
    select * into r from public.attack_rounds where id = new.round_id;
    if not found then raise exception 'charges: the round does not exist'; end if;
    if r.user_id is distinct from new.user_id then raise exception 'charges: the round belongs to another client'; end if;
    if r.mailed_at is null or r.status not in ('mailed', 'complete') then
      raise exception 'charges: the round is not recorded as mailed, so there is no performed work to charge for';
    end if;
    if r.mail_via is not distinct from 'client' then
      raise exception 'charges: the client mailed this round themselves; it is not work we performed';
    end if;
    if r.mailed_at > now() then raise exception 'charges: the round''s mailing date is in the future'; end if;
    if not exists (select 1 from public.letters l where l.round_id = r.id and l.status in ('queued', 'mailed', 'delivered')) then
      raise exception 'charges: no letter of this round is recorded as mailed';
    end if;
    if r.mailed_at <= a.cancellation_deadline then
      raise exception 'charges: the round was mailed before the cancellation window ended';
    end if;
    fee := a.terms ->> 'monthlyFee';
    if fee is null or fee !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then
      raise exception 'charges: the signed agreement carries no valid monthly fee';
    end if;
    if new.amount_cents is distinct from round(fee::numeric * 100)::integer then
      raise exception 'charges: the amount is not the fee in the signed agreement';
    end if;
    if exists (select 1 from public.charges c where c.user_id = new.user_id and c.work_date > now() - interval '30 days') then
      raise exception 'charges: fewer than 30 days since the work date of the last charged round';
    end if;
    new.round_number := r.round_number;
    new.work_date := r.mailed_at;
    new.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
    return new;
  end if;

  -- ── Under the plan the client signed (the snapshot, never the catalogue). ──
  t := s -> 'terms';
  e := s -> 'effective';
  ptype := t ->> 'type';
  new.plan_type := ptype;

  -- The plan and the agreement are for the same option (also checked at signing).
  if (ptype = 'diy_subscription') <> (public.agreement_service_option(a.terms) = 'diy') then
    raise exception 'charges: the signed plan is for the other service option';
  end if;

  -- ── Do it yourself, guided: the subscription and the mailings asked for. ──
  if ptype = 'diy_subscription' then
    if new.unit not in ('diy_period', 'mailing') then
      raise exception 'charges: a do-it-yourself plan charges only its monthly subscription and the mailings the client asked for';
    end if;
    if new.first_work_cents <> 0 or cardinality(new.result_item_ids) <> 0 or new.installment_number is not null then
      raise exception 'charges: a do-it-yourself charge has no first work fee, items or installments';
    end if;

    if new.unit = 'diy_period' then
      if new.round_id is not null or new.mail_request_id is not null then
        raise exception 'charges: a subscription period names no round and no mailing';
      end if;
      -- Periods of 30 days from the end of the cancellation window, or from 30
      -- days after the last charge under an earlier agreement (a switch: the
      -- new billing starts at the next cycle, never on top of the last one).
      anchor := greatest(
        a.cancellation_deadline,
        coalesce((select max(c.created_at) + interval '30 days' from public.charges c where c.user_id = new.user_id and c.agreement_id <> a.id), '-infinity'::timestamptz)
      );
      if now() < anchor then
        raise exception 'charges: the subscription starts at the next 30-day cycle after the last charge';
      end if;
      period_index := floor(extract(epoch from (now() - anchor)) / (30 * 86400))::integer;
      new.period_start := anchor + make_interval(days => 30 * period_index);
      new.period_end := new.period_start + interval '30 days';
      if t -> 'duration' ->> 'kind' = 'months' and period_index >= (t -> 'duration' ->> 'count')::integer then
        raise exception 'charges: the subscription covers only % months', t -> 'duration' ->> 'count';
      end if;
      -- Most you'll pay: the subscription's charges under this agreement.
      remaining := (e ->> 'maxTotalCents')::integer
        - coalesce((select sum(c.amount_cents) from public.charges c where c.agreement_id = a.id and c.unit = 'diy_period' and c.status <> 'refunded'), 0);
      if remaining <= 0 then
        raise exception 'charges: the plan''s maximum total has been charged; nothing more is charged';
      end if;
      expected := least((e ->> 'recurringCents')::integer, remaining);
      new.round_number := 0;
      new.work_date := new.period_start;
    else
      -- A mailing the client asked for, after we mailed it.
      select * into m from public.mail_requests where id = new.mail_request_id;
      if not found or m.user_id <> new.user_id then
        raise exception 'charges: the mail request does not exist or belongs to another client';
      end if;
      if m.agreement_id <> a.id then
        raise exception 'charges: the mail request was made under another agreement';
      end if;
      if m.status <> 'mailed' or m.mailed_at is null or m.mailed_at > now() then
        raise exception 'charges: a mailing is charged only after we mailed its letters';
      end if;
      if new.round_id is distinct from m.round_id then
        raise exception 'charges: the mailing charge names the round of its letters';
      end if;
      if m.fee_cents is distinct from (e ->> 'mailFeeCents')::integer then
        raise exception 'charges: the fee per letter is not the signed one';
      end if;
      expected := m.total_cents;
      select * into r from public.attack_rounds where id = m.round_id;
      new.round_number := r.round_number;
      new.work_date := m.mailed_at;
    end if;

    if new.amount_cents is distinct from expected then
      raise exception 'charges: the amount is not the one in the signed plan (expected % cents)', expected;
    end if;
    new.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
    return new;
  end if;

  -- ── Done for you (full service): as 0026, unchanged. ──
  if new.unit in ('diy_period', 'mailing') or new.mail_request_id is not null then
    raise exception 'charges: only a do-it-yourself plan charges a subscription from the start or a mailing; full service is charged only after its work';
  end if;

  -- The first round of work: mailed by us after the window, with a letter that went out.
  select r2.* into fr from public.attack_rounds r2
   where r2.user_id = new.user_id and r2.status in ('mailed', 'complete') and r2.mailed_at is not null
     and r2.mailed_at <= now() and r2.mailed_at > a.cancellation_deadline
     and r2.mail_via is distinct from 'client'
     and exists (select 1 from public.letters l where l.round_id = r2.id and l.status in ('queued', 'mailed', 'delivered'))
   order by r2.round_number limit 1;
  if not found then
    raise exception 'charges: no round has been mailed after the cancellation window; there is no performed work';
  end if;
  due_days := case when t -> 'dueRule' ->> 'kind' = 'days_after_first_round' then (t -> 'dueRule' ->> 'days')::integer else 0 end;
  if now() < fr.mailed_at + make_interval(days => greatest(1, due_days)) then
    raise exception 'charges: before the plan''s due date (after the first round is mailed)';
  end if;

  fw_due := (e ->> 'firstWorkFeeCents')::integer > 0
    and not exists (select 1 from public.charges c where c.user_id = new.user_id and c.first_work_cents > 0);

  if new.unit = 'results' then
    if ptype <> 'pay_per_delete' then raise exception 'charges: only pay per delete charges for results'; end if;
    if not public.billing_switch_on('pay_per_delete') then
      raise exception 'charges: pay per delete is off until the attorney''s approval is recorded';
    end if;
    if new.round_id is not null then raise exception 'charges: a results charge names items, not a round'; end if;
    n := coalesce(cardinality(new.result_item_ids), 0);
    if n = 0 then raise exception 'charges: a results charge needs the items it pays for'; end if;
    if (select count(distinct x) from unnest(new.result_item_ids) x) <> n then
      raise exception 'charges: an item is listed twice';
    end if;
    foreach item in array new.result_item_ids loop
      proved := public.billing_result_proved_at(new.user_id, item, a.cancellation_deadline, coalesce((t ->> 'countsUpdated')::boolean, false));
      if proved is null then
        raise exception 'charges: item % was not disputed through us, or no later report shows it gone', item;
      end if;
      if exists (select 1 from public.charge_items ci where ci.item_id = item) then
        raise exception 'charges: item % was already charged', item;
      end if;
      latest := greatest(latest, proved);
    end loop;
    base := n * (e ->> 'recurringCents')::integer;
    new.round_number := 0;
    new.work_date := latest;
  else
    if new.round_id is null then raise exception 'charges: a charge for work names the round'; end if;
    r := public.billing_performed_round(new.round_id, new.user_id, a.cancellation_deadline);
    if r.id is null then
      raise exception 'charges: the round is not recorded as mailed by us after the cancellation window, so there is no performed work to charge for';
    end if;
    new.round_number := r.round_number;
    new.work_date := r.mailed_at;

    if new.unit = 'first_work' then
      if not fw_due then raise exception 'charges: there is no first work fee due'; end if;
      if r.id <> fr.id then raise exception 'charges: the first work fee is charged after the FIRST round'; end if;
      if not (ptype = 'subscription' or (ptype = 'flat_fee' and t -> 'flat' ->> 'schedule' = 'after_last_round')) then
        raise exception 'charges: under this plan the first work fee goes with the first round''s charge';
      end if;
      base := 0;
      fw := (e ->> 'firstWorkFeeCents')::integer;
    elsif new.unit = 'round' then
      if ptype <> 'per_round' then raise exception 'charges: only a per-round plan charges per round'; end if;
      if t -> 'duration' ->> 'kind' = 'rounds' and r.round_number > (t -> 'duration' ->> 'count')::integer then
        raise exception 'charges: the plan covers only % rounds', t -> 'duration' ->> 'count';
      end if;
      base := (e ->> 'recurringCents')::integer;
      if fw_due then fw := (e ->> 'firstWorkFeeCents')::integer; end if;
    elsif new.unit = 'installment' then
      if ptype <> 'flat_fee' or t -> 'flat' ->> 'schedule' <> 'installments' then
        raise exception 'charges: only a flat fee in installments charges installments';
      end if;
      n := (t -> 'flat' ->> 'rounds')::integer;
      if r.round_number > n then raise exception 'charges: the flat fee covers only % rounds', n; end if;
      k := 1 + (select count(*) from public.charges c where c.agreement_id = a.id and c.unit = 'installment');
      if k > n then raise exception 'charges: every installment has been charged'; end if;
      new.installment_number := k;
      base := (e ->> 'flatTotalCents')::integer / n;
      if k = n then base := (e ->> 'flatTotalCents')::integer - base * (n - 1); end if;
      if fw_due then fw := (e ->> 'firstWorkFeeCents')::integer; end if;
    elsif new.unit = 'flat' then
      if ptype <> 'flat_fee' or t -> 'flat' ->> 'schedule' <> 'after_last_round' then
        raise exception 'charges: only a flat fee charged after its last round charges this way';
      end if;
      if r.round_number <> (t -> 'flat' ->> 'rounds')::integer then
        raise exception 'charges: the flat fee is charged after round % is mailed', t -> 'flat' ->> 'rounds';
      end if;
      if fw_due then raise exception 'charges: the first work fee comes first'; end if;
      base := (e ->> 'flatTotalCents')::integer;
    elsif new.unit = 'period' then
      if ptype <> 'subscription' then raise exception 'charges: only a subscription charges per period'; end if;
      if fw_due then raise exception 'charges: the first work fee comes first'; end if;
      -- Periods are 30 days from the first round's mailing; the round must be the first one mailed in its period.
      period_index := floor(extract(epoch from (r.mailed_at - fr.mailed_at)) / (30 * 86400))::integer;
      new.period_start := fr.mailed_at + make_interval(days => 30 * period_index);
      new.period_end := new.period_start + interval '30 days';
      -- Timing (owner's decision, 2026-11-25): "on_mailing" charges the period
      -- right after its round is mailed (the work is performed, like a per-round
      -- charge); "period_end" (0026's, and every plan without the field) waits
      -- for the period to end. Either way the period needs a round WE mailed in it.
      if coalesce(t ->> 'periodTiming', 'period_end') = 'period_end' and new.period_end > now() then
        raise exception 'charges: the period is still open; a month with work is charged when it ends';
      end if;
      if t -> 'duration' ->> 'kind' = 'months' and period_index >= (t -> 'duration' ->> 'count')::integer then
        raise exception 'charges: the subscription covers only % months', t -> 'duration' ->> 'count';
      end if;
      if exists (
        select 1 from public.attack_rounds o
         where o.user_id = new.user_id and o.id <> r.id and o.round_number < r.round_number
           and (public.billing_performed_round(o.id, new.user_id, a.cancellation_deadline)).id is not null
           and o.mailed_at >= new.period_start and o.mailed_at < new.period_end
      ) then
        raise exception 'charges: the period is named by the first round mailed in it';
      end if;
      new.work_date := case when coalesce(t ->> 'periodTiming', 'period_end') = 'on_mailing' then r.mailed_at else new.period_end end;
      base := (e ->> 'recurringCents')::integer;
    else
      raise exception 'charges: unknown unit of work';
    end if;
  end if;

  -- The amount: the snapshot's, trimmed to what is left under the plan's most-you'll-pay total.
  remaining := (e ->> 'maxTotalCents')::integer
    - coalesce((select sum(c.amount_cents) from public.charges c where c.agreement_id = a.id and c.status <> 'refunded'), 0);
  if remaining <= 0 then
    raise exception 'charges: the plan''s maximum total has been charged; nothing more is charged';
  end if;
  expected := least(base + fw, remaining);
  if new.amount_cents is distinct from expected then
    raise exception 'charges: the amount is not the one in the signed plan (expected % cents)', expected;
  end if;
  if new.first_work_cents is distinct from least(fw, expected) then
    raise exception 'charges: the first work fee part is not the signed one';
  end if;

  -- Never more often than every 30 days: since the work date AND the creation of every earlier charge.
  if exists (
    select 1 from public.charges c
     where c.user_id = new.user_id and (c.work_date > now() - interval '30 days' or c.created_at > now() - interval '30 days')
  ) then
    raise exception 'charges: fewer than 30 days since the last charge';
  end if;

  new.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  return new;
end;
$$;

-- A round whose letters ALL came back is not charged (0013). A DIY period
-- names no round; a mailing is judged by its own letters.
create or replace function public.charges_guard_returned()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ids uuid[];
begin
  if new.unit = 'diy_period' or new.round_id is null then
    return new;
  end if;
  if new.unit = 'mailing' then
    select letter_ids into ids from public.mail_requests where id = new.mail_request_id;
    if ids is not null and not exists (
      select 1 from public.letters l where l.id = any (ids) and l.mail_status not in ('returned', 'undeliverable')
    ) then
      raise exception 'charges: the post office returned every letter of this mailing; a person decides, nothing is charged automatically';
    end if;
    return new;
  end if;
  if exists (select 1 from public.letters l where l.round_id = new.round_id and l.status <> 'draft')
    and not exists (
      select 1 from public.letters l
      where l.round_id = new.round_id and l.status <> 'draft'
        and l.mail_status not in ('returned', 'undeliverable')
    )
  then
    raise exception 'charges: the post office returned every letter of this round; a person decides, nothing is charged automatically';
  end if;
  return new;
end;
$$;

-- The record rules of a charge (0026), with the mail request among what never changes.
create or replace function public.charges_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  returned boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'charges: a charge is a record and cannot be deleted';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.round_id is distinct from old.round_id
    or new.round_number is distinct from old.round_number
    or new.work_date is distinct from old.work_date
    or new.agreement_id is distinct from old.agreement_id
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
    or new.unit is distinct from old.unit
    or new.plan_type is distinct from old.plan_type
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.installment_number is distinct from old.installment_number
    or new.first_work_cents is distinct from old.first_work_cents
    or new.credit_cents is distinct from old.credit_cents
    or new.result_item_ids is distinct from old.result_item_ids
    or new.invoice_number is distinct from old.invoice_number
    or new.mail_request_id is distinct from old.mail_request_id
  then
    raise exception 'charges: the client, the work, the amount and the invoice of a charge cannot be changed';
  end if;

  if new.attempts < old.attempts then
    raise exception 'charges: the count of attempts cannot go down';
  end if;

  returned := old.status = 'succeeded' and new.status = 'failed'
    and exists (select 1 from public.payment_returns p where p.charge_id = old.id and p.gateway_reference = old.gateway_reference);

  if old.charged_at is not null and not returned and (
    new.charged_at is distinct from old.charged_at
    or new.gateway_reference is distinct from old.gateway_reference
    or new.gateway is distinct from old.gateway
  ) then
    raise exception 'charges: a paid charge''s date and reference cannot be changed';
  end if;

  if old.status = 'refunded' and new.status <> 'refunded' then
    raise exception 'charges: a refunded charge is final';
  end if;
  if old.status = 'succeeded' and new.status not in ('succeeded', 'refunded') and not returned then
    raise exception 'charges: a paid charge can only become refunded, or failed when its ACH return is on record';
  end if;
  if new.status = 'refunded' and old.status <> 'refunded' then
    if old.status <> 'succeeded' then
      raise exception 'charges: only a paid charge can be refunded';
    end if;
    if not exists (select 1 from public.refunds f where f.charge_id = new.id and f.completed_at is not null) then
      raise exception 'charges: a charge is marked refunded only once its refund is on record';
    end if;
  end if;

  return new;
end;
$$;
