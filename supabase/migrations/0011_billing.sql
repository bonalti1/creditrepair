-- Billing: payment methods, charges, refunds and billing pauses.
--
-- One rule decides the shape of everything here. Federal law (the Credit
-- Repair Organizations Act, 15 U.S.C. §1679b(b)) says a credit repair
-- organization may not charge or receive any money for a service before that
-- service is fully performed. So a charge is not a subscription payment: it is
-- the payment for ONE round of letters that was mailed, made after it was
-- mailed. The application decides when to charge (src/lib/billing/rules.ts);
-- this migration makes the database refuse anything else, whoever asks,
-- including the server itself.
--
-- What the database enforces about a charge (trigger charges_guard_insert):
--   - it names a round, and the round belongs to the same client;
--   - the round is recorded as mailed (status and mailed_at), the mailing date
--     is not in the future, and at least one of its letters went out;
--   - the client's newest agreement is signed, not cancelled, past its
--     cancellation deadline, and has no request to end the service on it;
--   - the round was mailed after that deadline (no work is done inside the
--     cancellation window, so none can be charged for);
--   - the amount is exactly the monthly fee printed in that signed agreement;
--   - at least 30 days have passed since the work date of every earlier charge;
--   - it starts as 'pending' with no attempts: money is recorded only after
--     the processor answers.
-- and by constraint: one charge per round, ever (unique (round_id)); amount > 0.
--
-- What cannot change afterwards (trigger charges_guard):
--   - a charge's client, round, amount, currency, work date and agreement;
--   - a charge cannot be deleted; a paid charge can only become 'refunded',
--     and only once its refund is on record; a refunded charge is final.
-- Refunds are records too: full amount only, a written reason, never deleted.
--
-- No card data. A payment method row holds the brand and the last four
-- digits; the processor's token lives in payment_method_vault, which nobody
-- but the server can read. Card numbers, expiry dates and security codes are
-- never sent to this application at all (the processor's hosted fields take
-- them), so there is no column that could hold one.
--
-- Who writes: only the server, with the service role (the pattern of
-- migration 0006). A client reads their own rows; active staff read all rows
-- (is_staff(), migration 0007). There is no insert, update or delete policy
-- for anyone. In particular nothing lets a member of staff create a charge or
-- change an amount: staff can refund and pause, through the server.

-- ── Payment methods ─────────────────────────────────────────────────────

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  -- The record of an authorization is kept: the account cannot be deleted under it.
  user_id uuid not null references auth.users (id) on delete restrict,
  -- Which processor holds the card ("demo" moves no money).
  gateway text not null check (gateway ~ '^[a-z0-9_-]{2,40}$'),
  brand text not null check (brand ~ '^[a-z0-9_ ]{2,30}$'),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),

  -- The recurring-payment authorization the client accepted with this method
  -- (src/lib/billing/authorization.ts): version, language, and a SHA-256 of
  -- exactly the text shown.
  authorization_version text not null check (authorization_version <> ''),
  authorization_locale text not null check (authorization_locale in ('es', 'en')),
  authorization_hash text not null check (authorization_hash ~ '^[0-9a-f]{64}$'),
  authorized_at timestamptz not null default now(),
  authorized_ip text,
  authorized_user_agent text,

  created_at timestamptz not null default now(),
  -- Set when the client replaced or removed it. The row stays as the record.
  removed_at timestamptz,
  constraint payment_methods_removed_after_created check (removed_at is null or removed_at >= created_at)
);

-- A client has at most one payment method in use.
create unique index payment_methods_one_active on public.payment_methods (user_id) where removed_at is null;

-- The processor's handles for a payment method. Server only: row level
-- security is on and there is no policy, so neither a client nor a member of
-- staff can read a token through the database API.
create table public.payment_method_vault (
  payment_method_id uuid primary key references public.payment_methods (id) on delete restrict,
  customer_ref text not null check (customer_ref <> ''),
  -- The processor's token for the stored method. Never a card number: a value
  -- that is nothing but 12 to 19 digits (with or without spaces or dashes) is refused.
  payment_method_ref text not null check (payment_method_ref <> '' and payment_method_ref !~ '^[0-9 -]{12,23}$')
);

create function public.payment_methods_guard()
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

revoke all on function public.payment_methods_guard() from public;

create trigger payment_methods_guard
  before update or delete on public.payment_methods
  for each row execute function public.payment_methods_guard();

-- ── Charges ─────────────────────────────────────────────────────────────

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  -- The work this charge pays for. A round with a charge cannot be deleted.
  round_id uuid not null references public.attack_rounds (id) on delete restrict,
  -- Copied from the round and the agreement by the insert trigger, so a
  -- charge always says what it was for even if those rows are read later.
  round_number int not null,
  work_date timestamptz not null,
  agreement_id uuid not null references public.service_agreements (id) on delete restrict,

  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),

  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  -- Times the processor was asked and answered.
  attempts int not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  -- When the system tries a declined charge again; null once paid or out of retries.
  next_attempt_at timestamptz,
  charged_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) <= 80),
  gateway text,
  gateway_reference text,
  created_at timestamptz not null default now(),

  -- One charge per round, ever. A failed payment retries this row.
  constraint charges_one_per_round unique (round_id),
  constraint charges_paid_has_date check ((status in ('succeeded', 'refunded')) = (charged_at is not null)),
  constraint charges_paid_has_reference check (charged_at is null or gateway_reference is not null),
  constraint charges_no_retry_once_paid check (status in ('pending', 'failed') or next_attempt_at is null)
);

create index charges_user_idx on public.charges (user_id, work_date desc);
create index charges_retry_idx on public.charges (next_attempt_at) where status = 'failed';

-- The gate. Runs for every insert, including the server's.
create function public.charges_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.attack_rounds%rowtype;
  a public.service_agreements%rowtype;
  fee text;
begin
  -- The work: a round of this client, recorded as mailed, in the past.
  select * into r from public.attack_rounds where id = new.round_id;
  if not found then
    raise exception 'charges: the round does not exist';
  end if;
  if r.user_id is distinct from new.user_id then
    raise exception 'charges: the round belongs to another client';
  end if;
  if r.mailed_at is null or r.status not in ('mailed', 'complete') then
    raise exception 'charges: the round is not recorded as mailed, so there is no performed work to charge for';
  end if;
  if r.mailed_at > now() then
    raise exception 'charges: the round''s mailing date is in the future';
  end if;
  if not exists (
    select 1 from public.letters l
    where l.round_id = r.id and l.status in ('queued', 'mailed', 'delivered')
  ) then
    raise exception 'charges: no letter of this round is recorded as mailed';
  end if;

  -- The agreement: the client's newest one, signed, in force, past its window.
  select * into a from public.service_agreements
    where user_id = new.user_id
    order by created_at desc
    limit 1;
  if not found or a.signed_at is null then
    raise exception 'charges: the client has no signed agreement';
  end if;
  if a.cancelled_at is not null then
    raise exception 'charges: the client cancelled the agreement; nothing is charged';
  end if;
  if a.cancellation_deadline is null or a.cancellation_deadline >= now() then
    raise exception 'charges: the client is inside the cancellation window; nothing may be charged';
  end if;
  if r.mailed_at <= a.cancellation_deadline then
    raise exception 'charges: the round was mailed before the cancellation window ended';
  end if;
  -- Whether work already performed may be billed after a request to end the
  -- service is a question for the attorney (docs/BILLING.md). Until it is
  -- answered the database says no, like BILL_PERFORMED_WORK_AFTER_END_REQUEST
  -- in src/lib/billing/rules.ts. Change both together.
  if a.service_end_requested_at is not null then
    raise exception 'charges: the client asked to end the service; a person decides, nothing is charged automatically';
  end if;

  -- The amount: the fee printed in the agreement the client signed. Nothing else.
  fee := a.terms ->> 'monthlyFee';
  if fee is null or fee !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then
    raise exception 'charges: the signed agreement carries no valid monthly fee';
  end if;
  if new.amount_cents is distinct from round(fee::numeric * 100)::int then
    raise exception 'charges: the amount is not the fee in the signed agreement';
  end if;

  -- Never more often than monthly: 30 days since the work of every earlier charge.
  if exists (
    select 1 from public.charges c
    where c.user_id = new.user_id and c.work_date > now() - interval '30 days'
  ) then
    raise exception 'charges: fewer than 30 days since the work date of the last charged round';
  end if;

  -- A charge is born unpaid. Money is recorded only after the processor answers.
  if new.status is distinct from 'pending' or new.attempts <> 0 or new.charged_at is not null
    or new.gateway_reference is not null or new.last_attempt_at is not null or new.next_attempt_at is not null
  then
    raise exception 'charges: a charge starts as pending, with no attempts';
  end if;

  new.round_number := r.round_number;
  new.work_date := r.mailed_at;
  new.agreement_id := a.id;
  return new;
end;
$$;

revoke all on function public.charges_guard_insert() from public;

create trigger charges_guard_insert
  before insert on public.charges
  for each row execute function public.charges_guard_insert();

-- Records, not working data.
create function public.charges_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
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
  then
    raise exception 'charges: the client, the round, the amount and the work date of a charge cannot be changed';
  end if;

  if new.attempts < old.attempts then
    raise exception 'charges: the count of attempts cannot go down';
  end if;

  -- Once money was taken, when and under which reference stays as recorded.
  if old.charged_at is not null and (
    new.charged_at is distinct from old.charged_at
    or new.gateway_reference is distinct from old.gateway_reference
    or new.gateway is distinct from old.gateway
  ) then
    raise exception 'charges: a paid charge''s date and reference cannot be changed';
  end if;

  if old.status = 'refunded' and new.status <> 'refunded' then
    raise exception 'charges: a refunded charge is final';
  end if;
  if old.status = 'succeeded' and new.status not in ('succeeded', 'refunded') then
    raise exception 'charges: a paid charge can only become refunded';
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

revoke all on function public.charges_guard() from public;

create trigger charges_guard
  before update or delete on public.charges
  for each row execute function public.charges_guard();

-- ── Refunds ─────────────────────────────────────────────────────────────

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  -- A charge is returned in full, so at most once.
  charge_id uuid not null unique references public.charges (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  amount_cents int not null check (amount_cents > 0),
  -- Why, in the teammate's words. Required.
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  -- The member of staff who asked for it.
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_name text not null default '' check (char_length(requested_by_name) <= 80),
  created_at timestamptz not null default now(),
  -- Set when the processor confirmed the money went back.
  completed_at timestamptz,
  gateway_reference text,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  constraint refunds_completed_has_reference check (completed_at is null or gateway_reference is not null)
);

create index refunds_user_idx on public.refunds (user_id, created_at desc);

create function public.refunds_guard_insert()
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
  if new.amount_cents is distinct from c.amount_cents then
    raise exception 'refunds: a refund is the full amount of the charge';
  end if;
  if new.completed_at is not null or new.gateway_reference is not null then
    raise exception 'refunds: a refund is recorded first and completed when the processor confirms';
  end if;
  return new;
end;
$$;

revoke all on function public.refunds_guard_insert() from public;

create trigger refunds_guard_insert
  before insert on public.refunds
  for each row execute function public.refunds_guard_insert();

create function public.refunds_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'refunds: a refund is a record and cannot be deleted';
  end if;
  if new.id is distinct from old.id
    or new.charge_id is distinct from old.charge_id
    or new.user_id is distinct from old.user_id
    or new.amount_cents is distinct from old.amount_cents
    or new.reason is distinct from old.reason
    or new.requested_by_name is distinct from old.requested_by_name
    or new.created_at is distinct from old.created_at
  then
    raise exception 'refunds: a recorded refund cannot be changed';
  end if;
  if old.completed_at is not null and (
    new.completed_at is distinct from old.completed_at
    or new.gateway_reference is distinct from old.gateway_reference
  ) then
    raise exception 'refunds: a completed refund cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.refunds_guard() from public;

create trigger refunds_guard
  before update or delete on public.refunds
  for each row execute function public.refunds_guard();

-- ── Billing pauses ──────────────────────────────────────────────────────
-- A member of staff stopped automatic charges for one client, with a reason.
-- While a pause is open the system creates no charge and retries none.

create table public.billing_pauses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  paused_by uuid references auth.users (id) on delete set null,
  paused_by_name text not null default '' check (char_length(paused_by_name) <= 80),
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  constraint billing_pauses_lifted_after_created check (lifted_at is null or lifted_at >= created_at)
);

create unique index billing_pauses_one_open on public.billing_pauses (user_id) where lifted_at is null;

-- ── Row level security ──────────────────────────────────────────────────
-- Read-only for the client the row belongs to and for active staff. No write
-- policy anywhere: only the service role, which is not subject to these, writes.

alter table public.payment_methods enable row level security;
alter table public.payment_method_vault enable row level security;
alter table public.charges enable row level security;
alter table public.refunds enable row level security;
alter table public.billing_pauses enable row level security;

create policy "own payment methods read" on public.payment_methods
  for select using (auth.uid() = user_id);
create policy "staff read payment methods" on public.payment_methods
  for select using (public.is_staff());

-- payment_method_vault: no policy at all. Nobody reads a token through the API.

create policy "own charges read" on public.charges
  for select using (auth.uid() = user_id);
create policy "staff read charges" on public.charges
  for select using (public.is_staff());

create policy "own refunds read" on public.refunds
  for select using (auth.uid() = user_id);
create policy "staff read refunds" on public.refunds
  for select using (public.is_staff());

-- A pause carries the team's own note: staff read it, the client does not.
-- The client's screen learns that billing is paused from the server.
create policy "staff read billing pauses" on public.billing_pauses
  for select using (public.is_staff());
