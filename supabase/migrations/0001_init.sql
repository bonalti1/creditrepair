-- Bonalti Credit SaaS — initial schema (spec §4.1, §4.2, §5)
-- Supabase Postgres with RLS. All user-owned tables are keyed by user_id
-- referencing auth.users and locked down to the owning user.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  address_lines text[] not null default '{}',
  phone_e164 text,
  locale text not null default 'es' check (locale in ('es', 'en')),
  -- Goal selector at onboarding: "¿Para qué estás reparando tu crédito?"
  goal text,
  goal_score_band int,
  created_at timestamptz not null default now()
);

-- Monitoring subscription is the revenue engine and a usage gate:
-- the attack builder requires an active subscription.
create table public.monitoring_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  external_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Raw snapshot stored per pull (spec §4.1); the diff engine compares pulls.
create table public.report_pulls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  pulled_at timestamptz not null,
  raw jsonb not null,
  created_at timestamptz not null default now()
);

-- Canonical parsed items, deduped across pulls by fingerprint.
create table public.report_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  bureau text not null check (bureau in ('equifax', 'experian', 'transunion')),
  category text not null check (category in ('tradeline', 'inquiry', 'public_record', 'personal_info')),
  name text not null,
  furnisher jsonb,
  data jsonb not null default '{}',
  negative boolean not null default false,
  status text not null default 'active' check (status in ('active', 'deleted', 'changed')),
  first_seen_pull uuid references public.report_pulls (id),
  last_seen_pull uuid references public.report_pulls (id),
  deleted_detected_at timestamptz,
  unique (user_id, fingerprint)
);

-- Armor #2: accuracy attestation per disputed item, logged with timestamp and
-- the exact attestation text/version the user checked.
create table public.item_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.report_items (id) on delete cascade,
  reason text not null default '',
  attested boolean not null default false,
  attestation_text text,
  attestation_version text,
  attested_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create table public.attack_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  round_number int not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'mailed', 'complete')),
  -- The DIY moment (legally load-bearing): the user pressed the button.
  approved_at timestamptz,
  mailed_at timestamptz,
  next_round_due_at timestamptz, -- approved_at + ~40 days
  created_at timestamptz not null default now(),
  unique (user_id, round_number)
);

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  round_id uuid not null references public.attack_rounds (id) on delete cascade,
  target_type text not null check (target_type in ('bureau', 'secondary_bureau', 'furnisher')),
  target_key text not null,
  target_name text not null,
  target_address_lines text[] not null default '{}',
  template_key text not null,
  escalation_stage text not null,
  body text not null,
  font_family text,
  lob_id text,
  status text not null default 'draft' check (status in ('draft', 'queued', 'mailed', 'delivered', 'failed')),
  mailed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.letter_items (
  letter_id uuid not null references public.letters (id) on delete cascade,
  item_id uuid not null references public.report_items (id) on delete cascade,
  escalation_stage text not null,
  primary key (letter_id, item_id)
);

-- Mortgage handoff (spec §5): ABA disclosure acknowledgment, logged before any
-- warm intro. Zero per-referral compensation (RESPA §8) — nothing to store on
-- compensation by design.
create table public.aba_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  disclosure_version text not null,
  locale text not null,
  acknowledged_at timestamptz not null default now()
);

-- WhatsApp / lifecycle event log (idempotency + audit).
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index report_items_user_idx on public.report_items (user_id, status);
create index letters_round_idx on public.letters (round_id);
create index rounds_due_idx on public.attack_rounds (next_round_due_at) where status = 'mailed';

-- RLS: owner-only access on every user table.
alter table public.profiles enable row level security;
alter table public.monitoring_subscriptions enable row level security;
alter table public.report_pulls enable row level security;
alter table public.report_items enable row level security;
alter table public.item_flags enable row level security;
alter table public.attack_rounds enable row level security;
alter table public.letters enable row level security;
alter table public.letter_items enable row level security;
alter table public.aba_acknowledgments enable row level security;
alter table public.events enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own monitoring" on public.monitoring_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own pulls" on public.report_pulls
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own items" on public.report_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own flags" on public.item_flags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rounds" on public.attack_rounds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own letters" on public.letters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own letter items" on public.letter_items
  for all using (exists (select 1 from public.letters l where l.id = letter_id and l.user_id = auth.uid()));

create policy "own aba" on public.aba_acknowledgments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own events" on public.events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
