-- Mail tracking and the furnisher address book.
--
-- Letters can now go first class or certified, and Lob reports what the post
-- office does with each one (POST /api/webhooks/lob). This migration keeps
-- that record:
--
--   letters (new columns): the mail class, who mailed it (lob / simulated /
--     print), the status the tracking events add up to, the certified
--     tracking number, and the dates that matter: delivered_at (the bureaus'
--     30-day window runs from receipt) and returned_at with the reason.
--     mailed_at, which billing and the response window count from, already
--     exists. Customers read their own letters (policy "own letters read",
--     migration 0006), so the client app can show "Enviada el … · Certificada
--     · Entregada el …". Nobody but the server writes letters.
--
--   mail_events: every tracking event, once. Written by the server only (no
--     insert/update/delete policy for anyone), deduplicated by the provider's
--     own event id (unique), and append-only: an event cannot be edited, and
--     cannot be deleted except when its letter goes (account deletion).
--     Staff read all of them; a customer reads the events of their own letters.
--
--   billing: a round whose letters ALL came back from the post office is not
--     charged (charges_guard_returned), the same rule as
--     src/lib/billing/rules.ts (all_letters_returned). A person decides.
--
--   furnishers + furnisher_changes: the address book for letters to
--     creditors and collectors. Staff read it; the server writes it (POST
--     /api/furnishers checks is_staff()). Every insert and change writes a
--     history line by trigger, with who and what changed, and history lines
--     cannot be edited or deleted. An address counts as verified only with a
--     date and a source. Customers cannot read either table.
--
-- Apply after 0011 (and after 0012 if present). Letters already queued or
-- mailed are marked "in_transit".

-- ── Letters ────────────────────────────────────────────────────────────

alter table public.letters
  add column mail_class text not null default 'first_class'
    check (mail_class in ('first_class', 'certified', 'certified_return_receipt')),
  add column mail_provider text check (mail_provider in ('lob', 'simulated', 'print')),
  add column mail_status text not null default 'not_sent'
    check (mail_status in ('not_sent', 'in_transit', 'delivered', 'returned', 'undeliverable')),
  add column tracking_number text check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9 -]{8,40}$'),
  add column delivered_at timestamptz,
  add column returned_at timestamptz,
  add column return_reason text check (return_reason is null or length(return_reason) <= 200),
  add column mail_updated_at timestamptz,
  -- A date belongs to its status: delivered has a delivery date, back has a return date.
  add constraint letters_delivered_dated check (mail_status <> 'delivered' or delivered_at is not null),
  add constraint letters_returned_dated check (mail_status not in ('returned', 'undeliverable') or returned_at is not null);

-- Letters already handed to the mail service. No delivery date was ever
-- recorded before this migration, so none is made up: they read "in transit"
-- until a tracking event says otherwise.
update public.letters set mail_status = 'in_transit'
  where status in ('queued', 'mailed', 'delivered') and mail_status = 'not_sent';

-- The webhook finds a letter by Lob's id.
create index letters_lob_id_idx on public.letters (lob_id) where lob_id is not null;

-- ── Tracking events ────────────────────────────────────────────────────

create table public.mail_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('lob')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 128),
  letter_id uuid not null references public.letters (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (length(event_type) between 1 and 100),
  kind text not null check (kind in ('created', 'mailed', 'in_transit', 'in_local_area', 'processed_for_delivery',
    'pickup_available', 're_routed', 'delivered', 'returned_to_sender', 'issue', 'failed', 'cancelled', 'other')),
  mail_status text check (mail_status in ('not_sent', 'in_transit', 'delivered', 'returned', 'undeliverable')),
  occurred_at timestamptz not null,
  tracking_number text,
  location text check (location is null or length(location) <= 100),
  detail text check (detail is null or length(detail) <= 200),
  received_at timestamptz not null default now(),
  -- Each provider event is recorded once, whatever the provider retries.
  constraint mail_events_once unique (provider, provider_event_id)
);

create index mail_events_letter_idx on public.mail_events (letter_id, occurred_at);

alter table public.mail_events enable row level security;

create policy "own mail events read" on public.mail_events
  for select using (auth.uid() = user_id);

create policy "staff read mail events" on public.mail_events
  for select using (public.is_staff());

-- The event must belong to the letter's client: a webhook cannot file an event under someone else.
create function public.mail_events_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.letters l where l.id = new.letter_id and l.user_id = new.user_id) then
    raise exception 'mail_events: the letter belongs to another client';
  end if;
  return new;
end;
$$;

revoke all on function public.mail_events_guard_insert() from public;

create trigger mail_events_guard_insert
  before insert on public.mail_events
  for each row execute function public.mail_events_guard_insert();

-- Append-only, for everyone including the service role. A delete is allowed
-- only as part of deleting the letter itself (on delete cascade), when the
-- letter is already gone.
create function public.mail_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'mail_events: an event is a record and cannot be changed';
  end if;
  if exists (select 1 from public.letters l where l.id = old.letter_id) then
    raise exception 'mail_events: an event is a record and cannot be deleted';
  end if;
  return old;
end;
$$;

revoke all on function public.mail_events_append_only() from public;

create trigger mail_events_append_only
  before update or delete on public.mail_events
  for each row execute function public.mail_events_append_only();

-- ── Billing: nothing reached anyone ────────────────────────────────────

-- Alongside charges_guard_insert (migration 0011): a round with letters that
-- ALL came back is not charged. Letters still in transit or delivered count
-- as performed work; a draft never does.
create function public.charges_guard_returned()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

revoke all on function public.charges_guard_returned() from public;

create trigger charges_guard_returned
  before insert on public.charges
  for each row execute function public.charges_guard_returned();

-- ── Furnisher address book ─────────────────────────────────────────────

create table public.furnishers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- The name as compared (src/lib/mail/furnishers.ts: normalizeCompanyName). One company per name.
  normalized_name text not null unique check (length(normalized_name) between 1 and 120),
  -- How reports print it ("MIDLAND CREDIT MGMT", "MCM").
  aliases text[] not null default '{}' check (cardinality(aliases) <= 20),
  -- Where disputes are mailed. Empty until someone finds it.
  address_lines text[] not null default '{}' check (cardinality(address_lines) <= 5),
  phone text check (phone is null or length(phone) <= 40),
  notes text check (notes is null or length(notes) <= 1000),
  -- Where the address was checked: a link to the company's own page, or the letter it came from.
  source text check (source is null or length(source) <= 500),
  -- The day a person checked it. Without an address and a source, nothing is "verified".
  verified_on date check (verified_on is null or verified_on <= current_date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text not null default 'sistema' check (length(updated_by_name) between 1 and 80),
  constraint furnishers_verified_needs_address check (
    verified_on is null or (cardinality(address_lines) >= 2 and source is not null and length(btrim(source)) > 0)
  )
);

create table public.furnisher_changes (
  id uuid primary key default gen_random_uuid(),
  furnisher_id uuid not null references public.furnishers (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_name text not null,
  -- {"field": {"from": …, "to": …}, …}
  changes jsonb not null
);

create index furnisher_changes_idx on public.furnisher_changes (furnisher_id, changed_at);

alter table public.furnishers enable row level security;
alter table public.furnisher_changes enable row level security;

create policy "staff read furnishers" on public.furnishers
  for select using (public.is_staff());

create policy "staff read furnisher changes" on public.furnisher_changes
  for select using (public.is_staff());

-- Every insert and every change writes its history line: who, when, what.
create function public.furnishers_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  diff jsonb := '{}'::jsonb;
  f text;
  before jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  after jsonb := to_jsonb(new);
begin
  foreach f in array array['name', 'aliases', 'address_lines', 'phone', 'notes', 'source', 'verified_on'] loop
    if (before -> f) is distinct from (after -> f) then
      diff := diff || jsonb_build_object(f, jsonb_build_object('from', before -> f, 'to', after -> f));
    end if;
  end loop;
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return new;
  end if;
  insert into public.furnisher_changes (furnisher_id, changed_by, changed_by_name, changes)
    values (new.id, new.updated_by, new.updated_by_name, diff);
  return new;
end;
$$;

revoke all on function public.furnishers_history() from public;

create trigger furnishers_history
  after insert or update on public.furnishers
  for each row execute function public.furnishers_history();

create function public.furnishers_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function public.furnishers_touch() from public;

create trigger furnishers_touch
  before update on public.furnishers
  for each row execute function public.furnishers_touch();

-- History is a record: never changed, never deleted (except with its company).
create function public.furnisher_changes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'furnisher_changes: history cannot be changed';
  end if;
  if exists (select 1 from public.furnishers f where f.id = old.furnisher_id) then
    raise exception 'furnisher_changes: history cannot be deleted';
  end if;
  return old;
end;
$$;

revoke all on function public.furnisher_changes_append_only() from public;

create trigger furnisher_changes_append_only
  before update or delete on public.furnisher_changes
  for each row execute function public.furnisher_changes_append_only();

-- Seed: the companies the demo reports name, by name and spelling only. No
-- address: a person adds each one from the company's own site or a letter,
-- with the source and the date.
insert into public.furnishers (name, normalized_name, aliases, notes) values
  ('Capital One', 'CAPITALONE', array['CAPITAL ONE BANK USA NA', 'CAPITAL ONE N.A.', 'CAP ONE', 'CAPITAL ONE BANK'],
    'Credit cards and auto loans use different dispute addresses.'),
  ('Midland Credit Management', 'MIDLANDCREDITMANAGEMENT', array['MIDLAND CREDIT MGMT', 'MIDLAND CREDIT MANAGEMENT INC', 'MCM'],
    'Debt collector.');
