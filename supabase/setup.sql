-- ===== 0001_init.sql =====
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

-- ===== 0002_review_states_and_outcomes.sql =====
-- Review states + letter outcome tracking.
--
-- item_flags.state mirrors the client review store: 'correct' (user verified
-- the item is fine — first-class answer, never enters a letter), 'flagged'
-- (believed inaccurate, attestation still pending), 'attested' (attestation
-- logged — eligible for letters).
--
-- letter_items outcome tracks what the bureau/furnisher did per item per
-- letter, so round N+1 letters can cite the actual prior response and MOV
-- escalation is grounded in a recorded "verified" outcome.

alter table public.item_flags
  add column state text not null default 'flagged'
    check (state in ('correct', 'flagged', 'attested'));

update public.item_flags set state = 'attested' where attested = true;

alter table public.letter_items
  add column outcome text
    check (outcome in ('deleted', 'corrected', 'verified', 'no_response')),
  add column outcome_at timestamptz,
  add column outcome_notes text;

-- ===== 0003_waitlist_documents.sql =====
-- Launch operations: waitlist (non-TX signups — expansion is a legal project,
-- not a config change) and identity documents (bureaus expect a copy of ID +
-- proof of address enclosed with disputes; stored per user, attached as
-- enclosures at letter generation).

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  state text not null, -- two-letter US state
  locale text not null default 'es',
  created_at timestamptz not null default now()
);

-- Waitlist is written pre-auth via service role; no user-facing RLS access.
alter table public.waitlist enable row level security;

create table public.identity_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('government_id', 'proof_of_address', 'ssn_card', 'identity_theft_report')),
  storage_path text not null, -- supabase storage object path in bucket 'identity-docs'
  uploaded_at timestamptz not null default now(),
  unique (user_id, kind)
);

alter table public.identity_documents enable row level security;

create policy "own documents" on public.identity_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket (run in Supabase dashboard or via API; SQL shown for reference):
insert into storage.buckets (id, name, public) values ('identity-docs', 'identity-docs', false)
  on conflict (id) do nothing;

create policy "own identity files read" on storage.objects
  for select using (bucket_id = 'identity-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own identity files write" on storage.objects
  for insert with check (bucket_id = 'identity-docs' and auth.uid()::text = (storage.foldername(name))[1]);

-- ===== 0004_chat_messages.sql =====
-- Conversation history, kept on the server so a client's thread with Capi
-- follows them across devices and so there is a record of what the AI said.
--
-- channel 'app'      : the in-app assistant thread (user_id always set)
-- channel 'whatsapp' : inbound/outbound WhatsApp turns, keyed by phone and
--                      linked to a user when the number matches a profile
--
-- source 'journey' : scripted assistant lines and the client's own taps,
--                    written by the client through /api/chat (RLS-bound)
-- source 'coach'   : AI-generated replies and the questions that prompted
--                    them, written only by the server (service role)
-- source 'human'   : a teammate taking over a thread (assisted plan)

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  phone_e164 text,
  channel text not null default 'app' check (channel in ('app', 'whatsapp')),
  role text not null check (role in ('user', 'assistant')),
  source text not null default 'journey' check (source in ('journey', 'coach', 'human')),
  body text not null check (char_length(body) between 1 and 4000),
  -- Provider message id (WhatsApp `wamid`), so a redelivered webhook is stored once.
  external_id text unique,
  created_at timestamptz not null default now(),
  check (user_id is not null or phone_e164 is not null)
);

create index chat_messages_user_idx on public.chat_messages (user_id, created_at desc);
create index chat_messages_phone_idx on public.chat_messages (phone_e164, created_at desc);

alter table public.chat_messages enable row level security;

create policy "own chat read" on public.chat_messages
  for select using (auth.uid() = user_id);

-- Clients may only add their own in-app journey lines. AI and human-teammate
-- rows come from the server, so a client cannot fabricate what the AI said.
create policy "own chat write" on public.chat_messages
  for insert with check (auth.uid() = user_id and channel = 'app' and source = 'journey');

-- ===== 0005_profile_onboarding.sql =====
-- What onboarding establishes about a customer, kept on the profile so it
-- follows them across devices and so sales attribution is on record.

alter table public.profiles
  add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$'),
  add column if not exists assisted boolean,
  -- Salesperson handle from the invite link (lowercase letters, digits, hyphens).
  -- Set once, on the first sync; later links do not overwrite it.
  add column if not exists referred_by text check (referred_by is null or referred_by ~ '^[a-z0-9-]{2,30}$'),
  add column if not exists onboarded_at timestamptz;

create index if not exists profiles_referred_by_idx on public.profiles (referred_by) where referred_by is not null;

-- ===== 0006_server_written_tables.sql =====
-- Customers read these tables; only the server writes them.
--
-- The first schema let a signed-in customer write any row of their own in
-- every table. For records the server creates, that is a hole: a customer
-- could insert their own "report" or "subscription" row straight through the
-- database API and unlock the letter builder without a monitoring
-- subscription, or alter the record of a letter after it was mailed.
--
-- The server uses the service role, which is not subject to these policies.
-- Tables customers do write stay as they were: profiles, item_flags,
-- identity_documents, and chat_messages (own journey lines only).

drop policy "own monitoring" on public.monitoring_subscriptions;
create policy "own monitoring read" on public.monitoring_subscriptions
  for select using (auth.uid() = user_id);

drop policy "own pulls" on public.report_pulls;
create policy "own pulls read" on public.report_pulls
  for select using (auth.uid() = user_id);

drop policy "own items" on public.report_items;
create policy "own items read" on public.report_items
  for select using (auth.uid() = user_id);

drop policy "own rounds" on public.attack_rounds;
create policy "own rounds read" on public.attack_rounds
  for select using (auth.uid() = user_id);

drop policy "own letters" on public.letters;
create policy "own letters read" on public.letters
  for select using (auth.uid() = user_id);

drop policy "own letter items" on public.letter_items;
create policy "own letter items read" on public.letter_items
  for select using (exists (select 1 from public.letters l where l.id = letter_id and l.user_id = auth.uid()));

drop policy "own events" on public.events;
create policy "own events read" on public.events
  for select using (auth.uid() = user_id);

-- An acknowledgment is a record: it can be made and read, not edited or removed.
drop policy "own aba" on public.aba_acknowledgments;
create policy "own aba read" on public.aba_acknowledgments
  for select using (auth.uid() = user_id);
create policy "own aba create" on public.aba_acknowledgments
  for insert with check (auth.uid() = user_id);

-- ===== 0007_staff.sql =====
-- Staff access for the console at /equipo.
--
-- Credalti is moving to full service: two members of staff run fulfillment for
-- every client, so they need to see client records. Until now each table was
-- readable only by the customer who owns the row.
--
-- What this adds:
--   - staff_members: who is on the team, their role, and whether they are active.
--   - is_staff(): true when the signed-in user is an active member of staff.
--   - "staff read" policies: an active member of staff can SELECT the client
--     tables the console shows.
--
-- What it does not add, on purpose: staff get no INSERT, UPDATE or DELETE
-- policy on any table. Everything staff do (send a round, add a note, mark an
-- exception handled) goes through the server, which checks is_staff() and
-- writes with the service role, so each action is validated and logged in one
-- place. In particular no policy lets staff write item_flags: which items are
-- disputed is the client's own answer.
--
-- Add a person (SQL editor, after they have signed in once):
--   insert into public.staff_members (user_id, role)
--   select id, 'specialist' from auth.users where phone = '+1XXXXXXXXXX';
-- Remove access without losing the record: set active = false.

create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- admin: everything, including the team list. specialist: fulfillment.
  -- sales: leads and invitations. The console does not yet tell them apart.
  role text not null check (role in ('admin', 'specialist', 'sales')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_members enable row level security;

-- Security definer so the check works inside other tables' policies without
-- giving anyone read access to the team list. search_path is pinned so the
-- function cannot be pointed at another schema's tables.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- A member of staff can see their own row (their role); nobody can see the
-- whole list or change it through the database API. Rows are managed with the
-- service role.
create policy "own staff row" on public.staff_members
  for select using (auth.uid() = user_id);

-- Read-only access to client records. These sit beside the "own … read"
-- policies: a customer still sees only their own rows.
create policy "staff read profiles" on public.profiles
  for select using (public.is_staff());

create policy "staff read monitoring" on public.monitoring_subscriptions
  for select using (public.is_staff());

create policy "staff read pulls" on public.report_pulls
  for select using (public.is_staff());

create policy "staff read items" on public.report_items
  for select using (public.is_staff());

create policy "staff read flags" on public.item_flags
  for select using (public.is_staff());

create policy "staff read rounds" on public.attack_rounds
  for select using (public.is_staff());

create policy "staff read letters" on public.letters
  for select using (public.is_staff());

create policy "staff read letter items" on public.letter_items
  for select using (public.is_staff());

-- The rows only (which kinds are on file, and when). The files themselves are
-- in storage, which staff cannot read yet.
create policy "staff read documents" on public.identity_documents
  for select using (public.is_staff());

create policy "staff read chat" on public.chat_messages
  for select using (public.is_staff());

create policy "staff read events" on public.events
  for select using (public.is_staff());

-- ===== 0008_dispute_reason.sql =====
-- A stated reason for every disputed item.
--
-- When a customer says an item is inaccurate they now pick a standard reason
-- ("this account is not mine", "I was never late"…). The letter prints that
-- reason's sentence after the item, because a dispute that gives no reason is
-- easy for a bureau to set aside.
--
-- item_flags.reason_code holds the code of the reason picked. The list of
-- reasons lives in the app (src/lib/letters/reasons.ts), and /api/flags only
-- accepts a code that is on it. The check here guards the shape of the value,
-- so nothing but a short code can be stored whatever route a write takes.
--
-- The column is nullable on purpose: an item confirmed before this change has
-- no reason code. It still counts, and its line in the letter carries no
-- reason. item_flags.reason stays what it was, the customer's own words. Those
-- words are shown to the team and are never printed in a letter.

alter table public.item_flags
  add column reason_code text
    check (reason_code ~ '^[a-z_]{2,40}$');
