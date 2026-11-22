-- Billing plans, ACH, chargebacks, invoices, results and referral credits.
--
-- The plan catalogue (src/lib/billing/plans.ts, docs/BILLING.md) offers what
-- Credit Repair Cloud offers, in its words: Subscription (monthly), Per round,
-- Flat fee (installments, or one charge after the last round) and Pay per
-- delete, with a first work fee, a due date, a duration, a household discount
-- and a most-you'll-pay cap. One rule is CRC's missing one, from federal law
-- (the Credit Repair Organizations Act, 15 U.S.C. §1679b(b)): nothing is ever
-- charged before the work it pays for is recorded as done. This migration
-- makes the database refuse anything else, whoever asks, including the
-- server.
--
--   billing_program_changes  append-only: the attorney-approved switches
--                            (pay per delete, referral credits). Off by default.
--   billing_plans            versioned plans: draft → active → retired. An
--                            active version is frozen and carries the
--                            attorney's approval. No fee before the work.
--   client_plan_offers       which plan a client is offered before signing.
--   household_links          two clients linked for the household discount.
--   service_agreements       a signature that carries terms.plan must match an
--                            active, approved plan version exactly (trigger).
--   charges                  now say WHAT work they pay for (unit): a round, a
--                            30-day period with a round mailed, a flat fee's
--                            installment or its last round, items a later
--                            report no longer shows, or the first work fee
--                            after the first round. Each unit once, ever; 30
--                            days apart; never above the plan's cap; an
--                            invoice number for every charge.
--   charge_items             pay per delete: each item paid for, once, ever.
--   item_results             the proof: a report pull that no longer shows an
--                            item (written by the report import).
--   payment_returns          ACH returns (R01…), which send a paid charge back
--                            to the dunning schedule.
--   chargebacks              disputes from the client's bank, with status.
--   gateway_events           signed processor webhooks, each processed once.
--   client_referrals         who referred whom (client to client).
--   client_credits           referral credit ledger: earned when the referred
--                            client signs, applied to a charge already due.
--
-- Who writes: only the server, with the service role. Staff read (is_staff()
-- or administrators where noted); a client reads their own credits and
-- results. No insert, update or delete policy for anyone.

-- ── Switches the attorney must clear ────────────────────────────────────

create table public.billing_program_changes (
  seq bigint generated always as identity primary key,
  switch text not null check (switch in ('pay_per_delete', 'referral_credits')),
  enabled boolean not null,
  attorney_name text check (attorney_name is null or char_length(btrim(attorney_name)) between 3 and 120),
  attorney_approved_on date,
  confirmed boolean not null default false,
  -- Referral credits: the credit a client earns when someone they referred signs.
  referral_credit_cents integer check (referral_credit_cents is null or referral_credit_cents between 100 and 50000),
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_name text not null default '' check (char_length(changed_by_name) <= 80),
  changed_at timestamptz not null default now(),
  constraint billing_switch_on_needs_approval check (
    not enabled or (confirmed and attorney_name is not null and attorney_approved_on is not null)
  ),
  constraint billing_switch_referral_amount check (switch <> 'referral_credits' or not enabled or referral_credit_cents is not null)
);

alter table public.billing_program_changes enable row level security;

create trigger billing_program_changes_append_only
  before update or delete on public.billing_program_changes
  for each row execute function public.partner_records_append_only();

create function public.billing_switch_on(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.enabled from public.billing_program_changes c where c.switch = name order by c.seq desc limit 1), false);
$$;

revoke all on function public.billing_switch_on(text) from public;
grant execute on function public.billing_switch_on(text) to authenticated;

create function public.referral_credit_cents()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select c.referral_credit_cents from public.billing_program_changes c
   where c.switch = 'referral_credits' order by c.seq desc limit 1;
$$;

revoke all on function public.referral_credit_cents() from public;

create policy "staff read billing program" on public.billing_program_changes
  for select using (public.staff_role() = 'admin');

-- ── The plan catalogue ──────────────────────────────────────────────────

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null check (plan_key ~ '^[a-z0-9-]{2,60}$'),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  plan_type text not null check (plan_type in ('subscription', 'per_round', 'flat_fee', 'pay_per_delete')),
  name_en text not null check (char_length(btrim(name_en)) between 2 and 80),
  name_es text not null check (char_length(btrim(name_es)) between 2 and 80),
  terms jsonb not null,
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  text_version text not null check (text_version <> ''),
  is_default boolean not null default false,
  -- The attorney is not a user: a name and a date, recorded by an administrator.
  attorney_name text check (attorney_name is null or char_length(btrim(attorney_name)) between 3 and 120),
  attorney_approved_on date,
  attorney_recorded_by uuid references auth.users (id) on delete set null,
  attorney_recorded_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  unique (plan_key, version),
  constraint billing_plans_type_matches check (terms ->> 'type' = plan_type),
  -- No fee before the work: a field that would hold one cannot be stored at all.
  constraint billing_plans_no_fee_before_work check (
    not (terms ?| array['setupFeeCents', 'setupFee', 'enrollmentFeeCents', 'enrollmentFee', 'signupFeeCents',
                        'activationFeeCents', 'retainerCents', 'upfrontCents', 'depositCents', 'applicationFeeCents'])
  ),
  constraint billing_plans_approved_when_offered check (status = 'draft' or (attorney_name is not null and attorney_approved_on is not null)),
  constraint billing_plans_default_is_active check (not is_default or status = 'active'),
  constraint billing_plans_dates check ((status = 'draft') = (activated_at is null) and (status = 'retired') = (retired_at is not null))
);

create unique index billing_plans_one_draft on public.billing_plans (plan_key) where status = 'draft';
create unique index billing_plans_one_active on public.billing_plans (plan_key) where status = 'active';
create unique index billing_plans_one_default on public.billing_plans ((is_default)) where is_default;

alter table public.billing_plans enable row level security;

create policy "staff read plans" on public.billing_plans
  for select using (public.staff_role() in ('admin', 'specialist'));

-- The most a client on these terms can be charged (list price), or null when unbounded.
create function public.billing_plan_max_cents(t jsonb)
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
  elsif t ->> 'type' = 'subscription' and t -> 'duration' ->> 'kind' = 'months' then
    implied := fw + (t -> 'duration' ->> 'count')::integer * rec;
  elsif t ->> 'type' = 'per_round' and t -> 'duration' ->> 'kind' = 'rounds' then
    implied := fw + (t -> 'duration' ->> 'count')::integer * rec;
  end if;
  if implied is null then return cap; end if;
  if cap is null then return implied; end if;
  return least(implied, cap);
end;
$$;

-- What src/lib/billing/plans.ts (validatePlanTerms) checks, again, for every write.
create function public.billing_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  t jsonb;
  kind text;
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then return old; end if;
    raise exception 'billing_plans: an offered plan version is a record and cannot be deleted';
  end if;

  t := new.terms;
  if coalesce((t ->> 'firstWorkFeeCents')::integer, -1) < 0 or coalesce((t ->> 'recurringCents')::integer, -1) < 0 then
    raise exception 'billing_plans: amounts must be whole cents, zero or more';
  end if;
  kind := t -> 'dueRule' ->> 'kind';
  if kind in ('days_after_plan_saved', 'when_letters_saved') then
    raise exception 'billing_plans: that due date can charge before any work is performed (15 U.S.C. §1679b(b))';
  end if;
  if kind is distinct from 'after_first_round' and kind is distinct from 'days_after_first_round' then
    raise exception 'billing_plans: the due date is after the first round is mailed, or N days after it';
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

revoke all on function public.billing_plans_guard() from public;

create trigger billing_plans_guard
  before insert or update or delete on public.billing_plans
  for each row execute function public.billing_plans_guard();

-- ── Which plan a client is offered, and households ──────────────────────

create table public.client_plan_offers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id uuid not null references public.billing_plans (id) on delete restrict,
  offered_by uuid references auth.users (id) on delete set null,
  offered_by_name text not null default '' check (char_length(offered_by_name) <= 80),
  created_at timestamptz not null default now()
);

alter table public.client_plan_offers enable row level security;
create policy "staff read plan offers" on public.client_plan_offers for select using (public.is_staff());

create table public.household_links (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint household_links_two_people check (user_a < user_b)
);

alter table public.household_links enable row level security;
create policy "staff read households" on public.household_links for select using (public.is_staff());

create function public.household_partner(uid uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when h.user_a = uid then h.user_b else h.user_a end
    from public.household_links h
   where h.ended_at is null and (h.user_a = uid or h.user_b = uid)
   limit 1;
$$;

create function public.household_links_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (public.household_partner(new.user_a) is not null or public.household_partner(new.user_b) is not null) then
    raise exception 'household_links: a client is in one household at a time';
  end if;
  if tg_op = 'UPDATE' and (new.user_a <> old.user_a or new.user_b <> old.user_b or new.created_at <> old.created_at
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)) then
    raise exception 'household_links: a link can only be ended';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'household_links: a link is a record; end it instead';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger household_links_guard
  before insert or update or delete on public.household_links
  for each row execute function public.household_links_guard();

-- ── A signature under a plan carries that exact plan ────────────────────

create function public.service_agreements_plan_check()
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
  then
    raise exception 'service_agreements: the plan amounts signed are not the plan''s amounts';
  end if;
  return new;
end;
$$;

revoke all on function public.service_agreements_plan_check() from public;

create trigger service_agreements_plan_check
  before insert or update on public.service_agreements
  for each row execute function public.service_agreements_plan_check();

-- ── Proof of results (pay per delete) ───────────────────────────────────

create table public.item_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  item_id uuid not null references public.report_items (id) on delete restrict,
  outcome text not null check (outcome in ('deleted', 'updated')),
  -- The report pull that shows it: no longer listed, or listed changed.
  proof_pull_id uuid not null references public.report_pulls (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (item_id, outcome, proof_pull_id)
);

create index item_results_user_idx on public.item_results (user_id, created_at);

create function public.item_results_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  i public.report_items%rowtype;
  proof timestamptz;
  seen timestamptz;
begin
  if tg_op <> 'INSERT' then
    raise exception 'item_results: a proof is a record and cannot be changed or deleted';
  end if;
  select * into i from public.report_items where id = new.item_id;
  if not found or i.user_id <> new.user_id then
    raise exception 'item_results: the item belongs to another client';
  end if;
  select pulled_at into proof from public.report_pulls where id = new.proof_pull_id and user_id = new.user_id;
  if proof is null then
    raise exception 'item_results: the report pull belongs to another client';
  end if;
  if new.outcome = 'deleted' then
    select pulled_at into seen from public.report_pulls where id = i.last_seen_pull;
    if seen is not null and seen >= proof then
      raise exception 'item_results: that report still lists the item';
    end if;
  end if;
  return new;
end;
$$;

create trigger item_results_guard
  before insert or update or delete on public.item_results
  for each row execute function public.item_results_guard();

alter table public.item_results enable row level security;
create policy "own item results read" on public.item_results for select using (auth.uid() = user_id);
create policy "staff read item results" on public.item_results for select using (public.is_staff());

/**
 * When a later report proved this item: the earliest report pull, after the
 * round that disputed the item through us was mailed, that no longer lists it
 * (or lists it updated, when the plan counts that) and while it is still
 * gone. Null when nothing proves it.
 */
create function public.billing_result_proved_at(uid uuid, item uuid, after timestamptz, counts_updated boolean)
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
       and r.status in ('mailed', 'complete') and r.mailed_at is not null
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

-- ── Referral credits (off until the attorney clears them) ───────────────

create table public.client_referrals (
  referred_user_id uuid primary key references auth.users (id) on delete restrict,
  referrer_user_id uuid not null references auth.users (id) on delete restrict,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text not null default '' check (char_length(recorded_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint client_referrals_not_self check (referred_user_id <> referrer_user_id)
);

alter table public.client_referrals enable row level security;
create policy "staff read client referrals" on public.client_referrals for select using (public.is_staff());
create trigger client_referrals_append_only
  before update or delete on public.client_referrals
  for each row execute function public.partner_records_append_only();

create table public.client_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('referral', 'applied')),
  -- Earned: positive. Applied to a charge: negative.
  cents integer not null check (cents <> 0),
  referred_user_id uuid references auth.users (id) on delete restrict,
  charge_id uuid,
  created_at timestamptz not null default now(),
  constraint client_credits_shape check (
    (kind = 'referral' and cents > 0 and referred_user_id is not null and charge_id is null)
    or (kind = 'applied' and cents < 0 and charge_id is not null and referred_user_id is null)
  )
);

create unique index client_credits_one_per_referral on public.client_credits (referred_user_id) where kind = 'referral';
create unique index client_credits_one_per_charge on public.client_credits (charge_id) where kind = 'applied';
create index client_credits_user_idx on public.client_credits (user_id);

alter table public.client_credits enable row level security;
create policy "own credits read" on public.client_credits for select using (auth.uid() = user_id);
create policy "staff read credits" on public.client_credits for select using (public.is_staff());

create function public.client_credit_balance(uid uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(cents), 0)::integer from public.client_credits where user_id = uid;
$$;

create function public.client_credits_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.service_agreements%rowtype;
  c public.charges%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'client_credits: a credit is a record and cannot be changed or deleted';
  end if;
  if new.kind = 'referral' then
    if not public.billing_switch_on('referral_credits') then
      raise exception 'client_credits: referral credits are off until the attorney''s approval is recorded';
    end if;
    if not exists (select 1 from public.client_referrals r where r.referred_user_id = new.referred_user_id and r.referrer_user_id = new.user_id) then
      raise exception 'client_credits: there is no referral on record between these clients';
    end if;
    select * into a from public.service_agreements where user_id = new.referred_user_id order by created_at desc limit 1;
    if not found or a.signed_at is null or a.cancelled_at is not null or a.cancellation_deadline >= now() then
      raise exception 'client_credits: the referred client has not signed, or is still inside the cancellation window';
    end if;
    if new.cents is distinct from public.referral_credit_cents() then
      raise exception 'client_credits: the credit is the amount the program set';
    end if;
  else
    select * into c from public.charges where id = new.charge_id;
    if not found or c.user_id <> new.user_id or c.credit_cents <> -new.cents then
      raise exception 'client_credits: a credit is applied only by the charge it lowers';
    end if;
  end if;
  return new;
end;
$$;

create trigger client_credits_guard
  before insert or update or delete on public.client_credits
  for each row execute function public.client_credits_guard();

-- ── Charges: what they pay for ──────────────────────────────────────────

create sequence public.invoice_number_seq;

alter table public.charges drop constraint charges_one_per_round;
alter table public.charges alter column round_id drop not null;
alter table public.charges
  add column unit text not null default 'round' check (unit in ('round', 'period', 'installment', 'flat', 'results', 'first_work')),
  add column plan_type text check (plan_type is null or plan_type in ('subscription', 'per_round', 'flat_fee', 'pay_per_delete')),
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column installment_number integer check (installment_number is null or installment_number >= 1),
  add column first_work_cents integer not null default 0 check (first_work_cents >= 0),
  add column credit_cents integer not null default 0 check (credit_cents >= 0),
  add column result_item_ids uuid[] not null default '{}',
  add column invoice_number text unique,
  add column method_kind text check (method_kind is null or method_kind in ('card', 'ach')),
  add column return_code text check (return_code is null or return_code ~ '^R[0-9A-Z]{2}$'),
  add constraint charges_round_unless_results check ((unit = 'results') = (round_id is null)),
  add constraint charges_parts_within_amount check (first_work_cents <= amount_cents and credit_cents <= amount_cents),
  add constraint charges_period_shape check ((unit = 'period') = (period_start is not null and period_end is not null));

-- One charge per unit of work, ever: a round pays once, a first work fee once, a period once, an installment once.
create unique index charges_one_per_round_work on public.charges (round_id) where unit <> 'first_work';
create unique index charges_one_first_work on public.charges (user_id) where first_work_cents > 0;
create unique index charges_one_per_period on public.charges (agreement_id, period_start) where unit = 'period';
create unique index charges_one_per_installment on public.charges (agreement_id, installment_number) where unit = 'installment';
create unique index charges_one_flat on public.charges (agreement_id) where unit = 'flat';

-- Pay per delete: each item paid for once, ever. Written by the charge's own trigger.
create table public.charge_items (
  charge_id uuid not null references public.charges (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  item_id uuid not null unique references public.report_items (id) on delete restrict,
  proved_at timestamptz not null,
  primary key (charge_id, item_id)
);

alter table public.charge_items enable row level security;
create policy "own charge items read" on public.charge_items for select using (auth.uid() = user_id);
create policy "staff read charge items" on public.charge_items for select using (public.is_staff());
create trigger charge_items_append_only
  before update or delete on public.charge_items
  for each row execute function public.partner_records_append_only();

-- A mailed round of this client, after the cancellation window, with a letter that went out. Null otherwise.
create function public.billing_performed_round(rid uuid, uid uuid, after timestamptz)
returns public.attack_rounds
language sql
stable
set search_path = ''
as $$
  select r.* from public.attack_rounds r
   where r.id = rid and r.user_id = uid
     and r.status in ('mailed', 'complete') and r.mailed_at is not null and r.mailed_at <= now()
     and r.mailed_at > after
     and exists (select 1 from public.letters l where l.round_id = r.id and l.status in ('queued', 'mailed', 'delivered'));
$$;

-- The gate, for every plan type. Replaces 0011's: an agreement without a plan
-- is billed exactly as before (one mailed round at the signed monthly fee).
create or replace function public.charges_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.attack_rounds%rowtype;
  a public.service_agreements%rowtype;
  fr public.attack_rounds%rowtype;
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

  -- The agreement: the client's newest one, signed, in force, past its window.
  select * into a from public.service_agreements where user_id = new.user_id order by created_at desc limit 1;
  if not found or a.signed_at is null then
    raise exception 'charges: the client has no signed agreement';
  end if;
  if a.cancelled_at is not null then
    raise exception 'charges: the client cancelled the agreement; nothing is charged';
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

  -- The first round of work: mailed after the window, with a letter that went out.
  select r2.* into fr from public.attack_rounds r2
   where r2.user_id = new.user_id and r2.status in ('mailed', 'complete') and r2.mailed_at is not null
     and r2.mailed_at <= now() and r2.mailed_at > a.cancellation_deadline
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
      raise exception 'charges: the round is not recorded as mailed after the cancellation window, so there is no performed work to charge for';
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
      if new.period_end > now() then
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
      new.work_date := new.period_end;
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

-- After the row exists: the items it pays for, and the credit it used.
create function public.charges_after_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item uuid;
  a timestamptz;
begin
  select cancellation_deadline into a from public.service_agreements where id = new.agreement_id;
  foreach item in array new.result_item_ids loop
    insert into public.charge_items (charge_id, user_id, item_id, proved_at)
    values (new.id, new.user_id, item, public.billing_result_proved_at(new.user_id, item, a, true));
  end loop;
  if new.credit_cents > 0 then
    insert into public.client_credits (user_id, kind, cents, charge_id) values (new.user_id, 'applied', -new.credit_cents, new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.charges_after_insert() from public;

create trigger charges_after_insert
  after insert on public.charges
  for each row execute function public.charges_after_insert();

-- ── ACH returns ─────────────────────────────────────────────────────────

create table public.payment_returns (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  -- Nacha return reason code: R01 insufficient funds, R02 account closed, R10 not authorized…
  code text not null check (code ~ '^R[0-9A-Z]{2}$'),
  -- The processor's reference of the attempt that came back.
  gateway_reference text not null check (gateway_reference <> ''),
  returned_at timestamptz not null,
  source text not null check (source in ('webhook', 'manual')),
  created_at timestamptz not null default now(),
  unique (charge_id, gateway_reference)
);

alter table public.payment_returns enable row level security;
create policy "staff read payment returns" on public.payment_returns for select using (public.is_staff());
create trigger payment_returns_append_only
  before update or delete on public.payment_returns
  for each row execute function public.partner_records_append_only();

create function public.payment_returns_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.charges%rowtype;
begin
  select * into c from public.charges where id = new.charge_id;
  if not found or c.user_id <> new.user_id then
    raise exception 'payment_returns: the charge belongs to another client';
  end if;
  if c.status <> 'succeeded' or c.gateway_reference is distinct from new.gateway_reference then
    raise exception 'payment_returns: only the paid attempt on record can come back';
  end if;
  return new;
end;
$$;

create trigger payment_returns_guard_insert
  before insert on public.payment_returns
  for each row execute function public.payment_returns_guard_insert();

-- The record rules of a charge, extended: the unit columns never change, and
-- a paid ACH charge may go back to 'failed' (the dunning schedule) only once
-- its return is on record.
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

-- ── Refunds and voids: what was collected, never more ───────────────────

alter table public.refunds
  add column kind text not null default 'refund' check (kind in ('refund', 'void'));

create or replace function public.refunds_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.charges%rowtype;
begin
  select * into c from public.charges where id = new.charge_id;
  if not found then
    raise exception 'refunds: the charge does not exist';
  end if;
  if c.user_id is distinct from new.user_id then
    raise exception 'refunds: the charge belongs to another client';
  end if;
  if c.status <> 'succeeded' then
    raise exception 'refunds: only a paid charge that was not already returned can be refunded';
  end if;
  -- What the processor took: the charge less any referral credit applied to it.
  if new.amount_cents is distinct from c.amount_cents - c.credit_cents then
    raise exception 'refunds: a refund is the full amount collected for the charge';
  end if;
  if new.completed_at is not null or new.gateway_reference is not null then
    raise exception 'refunds: a refund is recorded first and completed when the processor confirms';
  end if;
  return new;
end;
$$;

-- ── Payment methods: card or bank account ───────────────────────────────

alter table public.payment_methods
  add column kind text not null default 'card' check (kind in ('card', 'ach'));

create or replace function public.payment_methods_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment_methods: a row is the record of an authorization and cannot be deleted';
  end if;
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.gateway is distinct from old.gateway
    or new.kind is distinct from old.kind
    or new.brand is distinct from old.brand
    or new.last4 is distinct from old.last4
    or new.authorization_version is distinct from old.authorization_version
    or new.authorization_locale is distinct from old.authorization_locale
    or new.authorization_hash is distinct from old.authorization_hash
    or new.authorized_at is distinct from old.authorized_at
    or new.authorized_ip is distinct from old.authorized_ip
    or new.authorized_user_agent is distinct from old.authorized_user_agent
    or new.created_at is distinct from old.created_at
  then
    raise exception 'payment_methods: a recorded payment method and its authorization cannot be changed';
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'payment_methods: a removed payment method stays removed';
  end if;
  return new;
end;
$$;

-- An account or routing number is never a token: nine digits (an ABA routing
-- number) or 4 to 17 digits on its own is refused, like a card number in 0011.
alter table public.payment_method_vault
  add constraint payment_method_vault_not_account_number check (payment_method_ref !~ '^[0-9 -]{4,17}$');

-- ── Chargebacks ─────────────────────────────────────────────────────────

create table public.chargebacks (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null unique references public.charges (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'accepted')),
  reason_code text check (reason_code is null or char_length(reason_code) <= 40),
  amount_cents integer not null check (amount_cents > 0),
  received_at timestamptz not null,
  source text not null check (source in ('webhook', 'manual')),
  gateway_case_id text check (gateway_case_id is null or char_length(gateway_case_id) <= 120),
  note text check (note is null or char_length(note) <= 2000),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text not null default '' check (char_length(recorded_by_name) <= 80),
  responded_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chargebacks_closed check ((status = 'open') = (closed_at is null))
);

create index chargebacks_received_idx on public.chargebacks (received_at);

alter table public.chargebacks enable row level security;
create policy "staff read chargebacks" on public.chargebacks for select using (public.staff_role() = 'admin');

create function public.chargebacks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.charges%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'chargebacks: a chargeback is a record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    select * into c from public.charges where id = new.charge_id;
    if not found or c.user_id <> new.user_id then
      raise exception 'chargebacks: the charge belongs to another client';
    end if;
    if c.charged_at is null then
      raise exception 'chargebacks: only money that was taken can be disputed';
    end if;
    if new.status <> 'open' then
      raise exception 'chargebacks: a chargeback starts open';
    end if;
    return new;
  end if;
  if new.charge_id <> old.charge_id or new.user_id <> old.user_id or new.amount_cents <> old.amount_cents
     or new.received_at <> old.received_at or new.source <> old.source or new.created_at <> old.created_at then
    raise exception 'chargebacks: what was received cannot be changed';
  end if;
  if old.status <> 'open' and new.status is distinct from old.status then
    raise exception 'chargebacks: a closed chargeback stays closed';
  end if;
  return new;
end;
$$;

create trigger chargebacks_guard
  before insert or update or delete on public.chargebacks
  for each row execute function public.chargebacks_guard();

-- ── Processor webhooks: each event once ─────────────────────────────────

create table public.gateway_events (
  id uuid primary key default gen_random_uuid(),
  gateway text not null check (gateway ~ '^[a-z0-9_-]{2,40}$'),
  event_id text not null check (char_length(event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 120),
  -- What we did with it: 'applied', 'ignored', or why it could not be applied.
  outcome text not null default 'received' check (char_length(outcome) <= 300),
  received_at timestamptz not null default now(),
  unique (gateway, event_id)
);

alter table public.gateway_events enable row level security;
create policy "staff read gateway events" on public.gateway_events for select using (public.staff_role() = 'admin');
