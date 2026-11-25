-- The accounting department (/equipo/contabilidad; src/lib/accounting).
--
-- What is here is only what billing does not already know: what the company
-- spends, money from elsewhere (monitoring commissions), the processor's own
-- export, people's decisions (reconciliation, collections), the tax details
-- of partners for the 1099-NEC, closed months and an append-only audit trail.
-- Income from clients is NOT copied here: the books read charges, refunds,
-- chargebacks and returns as billing recorded them (migrations 0011, 0026),
-- so the two can never disagree. Nothing in this migration touches a billing
-- table, trigger or rule.
--
-- Money is integer cents everywhere. Calendar days are dates (Texas).
--
-- Who reads: only staff with the accounting capability (today: active
-- administrators; staff_can_see_accounting()). Clients, partners, anonymous
-- visitors, specialists and sales read nothing here. Who writes: only the
-- server with the service role, after requireCapability('accounting'); there
-- is no insert, update or delete policy for anyone.
--
-- Closed months: once a month is in month_closes, nothing dated in it can be
-- added, changed or voided in expenses or other_income (trigger
-- accounting_closed_month_guard), except an ADJUSTMENT: a new row marked as
-- one, dated in that month, which can never change afterwards. There is no
-- reopen: month_closes is append-only.

-- ── Who may read the books ──────────────────────────────────────────────

create function public.staff_can_see_accounting()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.staff_role() = 'admin', false);
$$;

revoke all on function public.staff_can_see_accounting() from public;
-- Anonymous visitors too, so a signed-out read is an empty answer (the
-- function is false for them), not an error.
grant execute on function public.staff_can_see_accounting() to authenticated, anon;

create function public.accounting_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: the books keep this record as it was; it cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.accounting_append_only() from public;

-- ── Categories ──────────────────────────────────────────────────────────
-- The same keys as src/lib/accounting/categories.ts (a test keeps them equal).

create table public.expense_categories (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  category_group text not null check (category_group in ('advertising', 'operations', 'people', 'compliance', 'financial', 'other')),
  name_en text not null check (char_length(name_en) between 2 and 80),
  name_es text not null check (char_length(name_es) between 2 and 80),
  account text not null check (char_length(account) between 2 and 80),
  sort integer not null default 0
);

insert into public.expense_categories (key, category_group, name_en, name_es, account, sort) values
  ('advertising_meta', 'advertising', 'Advertising: Meta (Facebook, Instagram)', 'Publicidad: Meta (Facebook, Instagram)', 'Advertising & Marketing:Meta Ads', 1),
  ('advertising_google', 'advertising', 'Advertising: Google', 'Publicidad: Google', 'Advertising & Marketing:Google Ads', 2),
  ('advertising_tiktok', 'advertising', 'Advertising: TikTok', 'Publicidad: TikTok', 'Advertising & Marketing:TikTok Ads', 3),
  ('advertising_other', 'advertising', 'Advertising: other', 'Publicidad: otra', 'Advertising & Marketing:Other', 4),
  ('software', 'operations', 'Software and subscriptions', 'Software y suscripciones', 'Software & Subscriptions', 5),
  ('postage', 'operations', 'Postage: Lob and certified mail', 'Correo: Lob y correo certificado', 'Postage & Delivery', 6),
  ('credit_monitoring', 'operations', 'Credit monitoring', 'Monitoreo de crédito', 'Credit Monitoring Services', 7),
  ('payroll', 'people', 'Payroll', 'Nómina', 'Payroll Expenses', 8),
  ('contractors', 'people', 'Contractors', 'Contratistas', 'Contract Labor', 9),
  ('legal_compliance', 'compliance', 'Legal and compliance', 'Legal y cumplimiento', 'Legal & Professional Fees', 10),
  ('insurance', 'compliance', 'Insurance', 'Seguros', 'Insurance', 11),
  ('office_rent', 'operations', 'Office and rent', 'Oficina y renta', 'Rent & Office', 12),
  ('bank_fees', 'financial', 'Bank fees', 'Comisiones bancarias', 'Bank Service Charges', 13),
  ('processing_fees', 'financial', 'Card and ACH processing fees', 'Comisiones del procesador (tarjeta y ACH)', 'Merchant Account Fees', 14),
  ('phone_whatsapp', 'operations', 'Phone and WhatsApp', 'Teléfono y WhatsApp', 'Telephone & Messaging', 15),
  ('taxes_licenses', 'compliance', 'Taxes and licenses', 'Impuestos y licencias', 'Taxes & Licenses', 16),
  ('other', 'other', 'Other', 'Otros', 'Other Expenses', 17);

-- ── Settings ────────────────────────────────────────────────────────────

create table public.accounting_settings (
  id boolean primary key default true check (id),
  -- The share of profit the owner puts aside for taxes (an estimate), in basis points.
  tax_set_aside_bps integer not null default 2500 check (tax_set_aside_bps between 0 and 6000),
  -- Bank feeds are off until the owner sets one up (src/lib/accounting/bankFeeds.ts).
  bank_feed_provider text not null default 'none' check (bank_feed_provider in ('none', 'plaid')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.accounting_settings (id) values (true);

-- ── Closed months ───────────────────────────────────────────────────────

create table public.month_closes (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users (id) on delete set null,
  closed_by_name text not null default '' check (char_length(closed_by_name) <= 80),
  -- The figures as they were that day (src/lib/accounting/summary.ts snapshotOf).
  totals jsonb not null check (jsonb_typeof(totals) = 'object' and octet_length(totals::text) <= 4000),
  note text not null default '' check (char_length(note) <= 500)
);

create function public.month_closes_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a month that is over on the Texas calendar.
  if (new.month || '-01')::date + interval '1 month' > (now() at time zone 'America/Chicago')::date then
    raise exception 'month_closes: % is not over yet', new.month;
  end if;
  new.closed_at := now();
  return new;
end;
$$;

create trigger month_closes_guard_insert
  before insert on public.month_closes
  for each row execute function public.month_closes_guard_insert();

create trigger month_closes_append_only
  before update or delete on public.month_closes
  for each row execute function public.accounting_append_only();

create function public.accounting_month_closed(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.month_closes c where c.month = to_char(d, 'YYYY-MM'));
$$;

revoke all on function public.accounting_month_closed(date) from public;

-- ── Imports (bank statements, processor exports) ────────────────────────

create table public.accounting_imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bank_statement', 'processor_settlement', 'other_income')),
  gateway text check (gateway is null or gateway in ('nmi', 'authorize_net')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  -- The same file twice is refused.
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count >= 0),
  added_count integer not null check (added_count >= 0),
  duplicate_count integer not null check (duplicate_count >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint accounting_imports_gateway check ((kind = 'processor_settlement') = (gateway is not null)),
  unique (kind, file_sha256)
);

create trigger accounting_imports_append_only
  before update or delete on public.accounting_imports
  for each row execute function public.accounting_append_only();

-- ── Monthly expense rules ───────────────────────────────────────────────

create table public.accounting_recurring (
  id uuid primary key default gen_random_uuid(),
  vendor text not null check (char_length(vendor) between 2 and 120),
  description text not null default '' check (char_length(description) <= 500),
  category_key text not null references public.expense_categories (key) on delete restrict,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  day_of_month integer not null check (day_of_month between 1 and 31),
  payment_method text not null check (payment_method in ('business_card', 'bank_transfer', 'ach', 'check', 'cash', 'personal_card', 'other')),
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint accounting_recurring_dates check (ends_on is null or ends_on >= starts_on)
);

create function public.accounting_recurring_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'accounting_recurring: a monthly rule is stopped, not deleted';
  end if;
  -- Only stopping, resuming or ending it. A different amount is a new rule.
  if new.vendor is distinct from old.vendor or new.category_key is distinct from old.category_key
     or new.amount_cents is distinct from old.amount_cents or new.day_of_month is distinct from old.day_of_month
     or new.starts_on is distinct from old.starts_on or new.created_at is distinct from old.created_at then
    raise exception 'accounting_recurring: a monthly rule keeps its terms; stop it and add a new one';
  end if;
  return new;
end;
$$;

create trigger accounting_recurring_guard
  before update or delete on public.accounting_recurring
  for each row execute function public.accounting_recurring_guard();

-- ── Expenses ────────────────────────────────────────────────────────────

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  -- Positive; only an adjustment to a closed month may be negative.
  amount_cents integer not null check (amount_cents between -100000000 and 100000000 and amount_cents <> 0),
  category_key text not null references public.expense_categories (key) on delete restrict,
  vendor text not null check (char_length(vendor) between 2 and 120),
  description text not null default '' check (char_length(description) <= 500),
  payment_method text not null check (payment_method in ('business_card', 'bank_transfer', 'ach', 'check', 'cash', 'personal_card', 'other')),
  source text not null default 'manual' check (source in ('manual', 'recurring', 'bank_import', 'adjustment')),
  recurring_id uuid references public.accounting_recurring (id) on delete restrict,
  import_id uuid references public.accounting_imports (id) on delete restrict,
  bank_fingerprint text check (bank_fingerprint is null or char_length(bank_fingerprint) <= 200),
  adjusts_month text check (adjusts_month is null or adjusts_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- The receipt, in the private bucket accounting-receipts (server only).
  receipt_path text check (receipt_path is null or receipt_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'),
  receipt_kind text check (receipt_kind is null or receipt_kind in ('pdf', 'jpeg', 'png')),
  receipt_bytes integer check (receipt_bytes is null or receipt_bytes between 1 and 10485760),
  receipt_name text check (receipt_name is null or char_length(receipt_name) <= 200),
  receipt_uploaded_at timestamptz,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 5 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint expenses_positive_unless_adjustment check (source = 'adjustment' or amount_cents > 0),
  constraint expenses_adjustment_month check ((source = 'adjustment') = (adjusts_month is not null)),
  constraint expenses_adjustment_in_its_month check (adjusts_month is null or to_char(spent_on, 'YYYY-MM') = adjusts_month),
  constraint expenses_recurring_source check ((source = 'recurring') = (recurring_id is not null)),
  constraint expenses_void_pair check ((voided_at is null) = (void_reason is null)),
  constraint expenses_receipt_pair check ((receipt_path is null) = (receipt_kind is null) and (receipt_path is null) = (receipt_bytes is null))
);

create index expenses_spent_idx on public.expenses (spent_on);
-- A monthly rule posts once per month; a bank line comes in once.
create unique index expenses_one_per_rule_month on public.expenses (recurring_id, (date_trunc('month', spent_on::timestamp))) where recurring_id is not null and voided_at is null;
create unique index expenses_one_per_bank_line on public.expenses (bank_fingerprint) where bank_fingerprint is not null and voided_at is null;

-- ── Money from elsewhere: monitoring commissions, other income ─────────

create table public.other_income (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('monitoring_commission', 'other')),
  source text not null check (char_length(source) between 2 and 120),
  received_on date not null,
  amount_cents integer not null check (amount_cents between -100000000 and 100000000 and amount_cents <> 0),
  note text not null default '' check (char_length(note) <= 500),
  import_id uuid references public.accounting_imports (id) on delete restrict,
  is_adjustment boolean not null default false,
  adjusts_month text check (adjusts_month is null or adjusts_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 5 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint other_income_positive_unless_adjustment check (is_adjustment or amount_cents > 0),
  constraint other_income_adjustment_month check (is_adjustment = (adjusts_month is not null)),
  constraint other_income_adjustment_in_its_month check (adjusts_month is null or to_char(received_on, 'YYYY-MM') = adjusts_month),
  constraint other_income_void_pair check ((voided_at is null) = (void_reason is null))
);

create index other_income_received_idx on public.other_income (received_on);

-- The closed-month rule, for both tables. tg_argv[0] is the date column.
create function public.accounting_closed_month_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text := tg_argv[0];
  new_day date;
  old_day date;
  new_adjustment boolean;
  old_adjustment boolean;
  n jsonb;
  o jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception '%: a line in the books is voided, never deleted', tg_table_name;
  end if;
  n := to_jsonb(new);
  new_day := (n ->> col)::date;
  new_adjustment := coalesce((n ->> 'source') = 'adjustment', false) or coalesce((n ->> 'is_adjustment')::boolean, false);
  if tg_op = 'INSERT' then
    if public.accounting_month_closed(new_day) and not new_adjustment then
      raise exception '%: % is a closed month; record an adjustment instead', tg_table_name, to_char(new_day, 'YYYY-MM');
    end if;
    if new_adjustment and not public.accounting_month_closed(new_day) then
      raise exception '%: an adjustment is only for a closed month', tg_table_name;
    end if;
    return new;
  end if;
  o := to_jsonb(old);
  old_day := (o ->> col)::date;
  old_adjustment := coalesce((o ->> 'source') = 'adjustment', false) or coalesce((o ->> 'is_adjustment')::boolean, false);
  if (n - 'receipt_path' - 'receipt_kind' - 'receipt_bytes' - 'receipt_name' - 'receipt_uploaded_at') = (o - 'receipt_path' - 'receipt_kind' - 'receipt_bytes' - 'receipt_name' - 'receipt_uploaded_at') then
    -- Only the receipt changed: a receipt can be attached at any time.
    return new;
  end if;
  if old_adjustment then
    raise exception '%: an adjustment is never changed; record another adjustment', tg_table_name;
  end if;
  if (o ->> 'voided_at') is not null then
    raise exception '%: a voided line stays voided', tg_table_name;
  end if;
  if public.accounting_month_closed(old_day) or public.accounting_month_closed(new_day) then
    raise exception '%: % is a closed month; record an adjustment instead', tg_table_name, to_char(case when public.accounting_month_closed(old_day) then old_day else new_day end, 'YYYY-MM');
  end if;
  if (n ->> 'created_at') is distinct from (o ->> 'created_at') or (n ->> 'id') is distinct from (o ->> 'id')
     or (n ->> 'source') is distinct from (o ->> 'source') or (n ->> 'is_adjustment') is distinct from (o ->> 'is_adjustment') then
    raise exception '%: where a line came from cannot change', tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on function public.accounting_closed_month_guard() from public;

create trigger expenses_closed_month_guard
  before insert or update or delete on public.expenses
  for each row execute function public.accounting_closed_month_guard('spent_on');

create trigger other_income_closed_month_guard
  before insert or update or delete on public.other_income
  for each row execute function public.accounting_closed_month_guard('received_on');

-- ── The processor's export ──────────────────────────────────────────────

create table public.settlement_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.accounting_imports (id) on delete restrict,
  gateway text not null check (gateway in ('nmi', 'authorize_net')),
  transaction_id text not null check (char_length(transaction_id) between 1 and 120),
  order_id text check (order_id is null or char_length(order_id) <= 120),
  kind text not null check (kind in ('sale', 'refund', 'void', 'chargeback', 'return', 'fee', 'other')),
  status text not null check (status in ('settled', 'declined', 'voided', 'pending', 'other')),
  amount_cents integer not null check (amount_cents between 0 and 100000000),
  fee_cents integer not null default 0 check (fee_cents between 0 and 100000000),
  settled_on date not null,
  batch_id text check (batch_id is null or char_length(batch_id) <= 80),
  created_at timestamptz not null default now(),
  unique (gateway, transaction_id, kind)
);

create index settlement_rows_day_idx on public.settlement_rows (settled_on);

create trigger settlement_rows_append_only
  before update or delete on public.settlement_rows
  for each row execute function public.accounting_append_only();

-- A person's decision on a reconciliation line: paired by hand, or a difference explained.
create table public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  settlement_row_id uuid references public.settlement_rows (id) on delete restrict,
  charge_id uuid references public.charges (id) on delete restrict,
  decision text not null check (decision in ('manual_match', 'explained')),
  note text not null check (char_length(btrim(note)) between 5 and 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_by_name text not null default '' check (char_length(decided_by_name) <= 80),
  decided_at timestamptz not null default now(),
  constraint reconciliation_matches_something check (settlement_row_id is not null or charge_id is not null),
  constraint reconciliation_matches_pair check (decision <> 'manual_match' or (settlement_row_id is not null and charge_id is not null))
);

create trigger reconciliation_matches_append_only
  before update or delete on public.reconciliation_matches
  for each row execute function public.accounting_append_only();

-- ── Collections: what a person did about a payment that did not go through ──
-- Reminders are WhatsApp or email only: there is no SMS kind, on purpose.

create table public.collection_actions (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('reminder_whatsapp', 'reminder_email', 'called', 'note', 'decided_wait', 'decided_write_off', 'decided_pause')),
  note text not null default '' check (char_length(note) <= 1000),
  by_user uuid references auth.users (id) on delete set null,
  by_name text not null default '' check (char_length(by_name) <= 80),
  at timestamptz not null default now()
);

create index collection_actions_charge_idx on public.collection_actions (charge_id, at);

create function public.collection_actions_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.charges%rowtype;
begin
  select * into c from public.charges where id = new.charge_id;
  if not found or c.user_id <> new.user_id then
    raise exception 'collection_actions: the charge belongs to another client';
  end if;
  -- Only a charge that is not paid: nothing is asked for money already taken.
  if c.status not in ('pending', 'failed') then
    raise exception 'collection_actions: only an unpaid charge is in collections';
  end if;
  -- Never a reminder to a client who asked for no messages (their newest
  -- record in message_opt_outs, migration 0015, decides).
  if new.kind in ('reminder_whatsapp', 'reminder_email') and coalesce((
    select o.kind from public.message_opt_outs o where o.user_id = new.user_id order by o.at desc limit 1
  ), 'opt_in') = 'opt_out' then
    raise exception 'collection_actions: the client asked for no messages';
  end if;
  new.at := now();
  return new;
end;
$$;

create trigger collection_actions_guard_insert
  before insert on public.collection_actions
  for each row execute function public.collection_actions_guard_insert();

create trigger collection_actions_append_only
  before update or delete on public.collection_actions
  for each row execute function public.accounting_append_only();

-- ── Partners' tax details for the 1099-NEC ─────────────────────────────
-- Never the tax id itself: only whether the W-9 is on file, the legal name
-- it gives, and whether it says the partner is exempt. The CPA files.

create table public.partner_tax_info (
  partner_id uuid primary key references public.partners (id) on delete restrict,
  legal_name text not null default '' check (char_length(legal_name) <= 120 and legal_name !~ '\d{3}-?\d{2}-?\d{4}' and legal_name !~ '\d{2}-?\d{7}'),
  w9_received_on date,
  exempt boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ── The audit trail ─────────────────────────────────────────────────────

create table public.accounting_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid,
  actor_name text not null default '' check (char_length(actor_name) <= 80),
  action text not null check (action ~ '^[a-z_]{2,60}$'),
  entity text not null check (entity ~ '^[a-z_]{2,40}$'),
  entity_id text check (entity_id is null or char_length(entity_id) <= 120),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4000)
);

create index accounting_audit_at_idx on public.accounting_audit (at desc);

create trigger accounting_audit_append_only
  before update or delete on public.accounting_audit
  for each row execute function public.accounting_append_only();

-- ── Receipts: a private bucket, no policy (the server hands out short links) ──

insert into storage.buckets (id, name, public) values ('accounting-receipts', 'accounting-receipts', false)
  on conflict (id) do nothing;

-- ── Row level security: read by accounting staff only, written by nobody ──

alter table public.expense_categories enable row level security;
alter table public.accounting_settings enable row level security;
alter table public.month_closes enable row level security;
alter table public.accounting_imports enable row level security;
alter table public.accounting_recurring enable row level security;
alter table public.expenses enable row level security;
alter table public.other_income enable row level security;
alter table public.settlement_rows enable row level security;
alter table public.reconciliation_matches enable row level security;
alter table public.collection_actions enable row level security;
alter table public.partner_tax_info enable row level security;
alter table public.accounting_audit enable row level security;

create policy "accounting read categories" on public.expense_categories for select using (public.staff_can_see_accounting());
create policy "accounting read settings" on public.accounting_settings for select using (public.staff_can_see_accounting());
create policy "accounting read month closes" on public.month_closes for select using (public.staff_can_see_accounting());
create policy "accounting read imports" on public.accounting_imports for select using (public.staff_can_see_accounting());
create policy "accounting read recurring" on public.accounting_recurring for select using (public.staff_can_see_accounting());
create policy "accounting read expenses" on public.expenses for select using (public.staff_can_see_accounting());
create policy "accounting read other income" on public.other_income for select using (public.staff_can_see_accounting());
create policy "accounting read settlement" on public.settlement_rows for select using (public.staff_can_see_accounting());
create policy "accounting read reconciliation" on public.reconciliation_matches for select using (public.staff_can_see_accounting());
create policy "accounting read collections" on public.collection_actions for select using (public.staff_can_see_accounting());
create policy "accounting read partner tax" on public.partner_tax_info for select using (public.staff_can_see_accounting());
create policy "accounting read audit" on public.accounting_audit for select using (public.staff_can_see_accounting());
