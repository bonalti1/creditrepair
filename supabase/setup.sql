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

-- ===== 0009_chat_author.sql =====
-- A teammate's reply in a client's conversation carries the teammate's name.
--
-- chat_messages.source = 'human' already marks a message a person wrote
-- (migration 0004). This adds who: the name the client sees beside the
-- message ("Ana, del equipo"). It is empty on every message Capi or the
-- client wrote, and the check keeps it that way, so a name can never be
-- attached to an AI reply or to a line the client added.
--
-- Rows with source 'human' are written by the server only (clients may insert
-- 'journey' rows and nothing else), so a client cannot put a name here.

alter table public.chat_messages
  add column author_name text
  check (author_name is null or (source = 'human' and char_length(author_name) between 1 and 80));

-- ===== 0010_service_agreements.sql =====
-- Service agreements: the disclosure, the contract, the signature and the
-- right to cancel.
--
-- Credalti now prepares and mails dispute letters for its clients. That makes
-- it a "credit repair organization" under the federal Credit Repair
-- Organizations Act (15 U.S.C. §1679 et seq.) and a "credit services
-- organization" under Texas Finance Code chapter 393. Before any work can be
-- done for a client, those laws require, in this order:
--
--   1. a disclosure statement given as its own document, before the contract,
--      with the client's acknowledgement kept for two years
--      (15 U.S.C. §1679c; Tex. Fin. Code §393.105, §393.106);
--   2. a written, dated contract signed by the client
--      (15 U.S.C. §1679d; Tex. Fin. Code §393.201);
--   3. three business days in which the client can cancel without penalty,
--      during which no service may be provided (15 U.S.C. §1679d(a)(2), §1679e).
--
-- One row is one agreement, from the acknowledgement to its end. The app reads
-- it to decide whether a letter may leave (src/lib/agreement/gate.ts).
--
-- Who writes: only the server, with the service role, through
-- /api/agreement/*. A client reads their own rows; active staff read all rows
-- (is_staff(), migration 0007). There is no insert, update or delete policy
-- for anyone else.
--
-- What cannot change, even for the server (trigger below):
--   - the acknowledgement, once written;
--   - the signature (name, time, version, hash, language, address, browser,
--     terms and deadline), once written;
--   - a cancellation, once written;
--   - no row can be deleted, and the account a row belongs to cannot be
--     deleted while the row exists (on delete restrict). These are records the
--     law says to keep; removing one is a deliberate act by the database owner.

create table public.service_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  -- AGREEMENT_VERSION of the text shown (src/lib/agreement/documents.ts).
  document_version text not null check (document_version <> ''),

  -- Step 1: the disclosure statements, acknowledged before the contract is shown.
  disclosure_acknowledged_at timestamptz not null default now(),
  disclosure_locale text not null check (disclosure_locale in ('es', 'en')),
  -- SHA-256 of the disclosure documents exactly as shown.
  disclosure_hash text not null check (disclosure_hash ~ '^[0-9a-f]{64}$'),

  -- Step 2: the signature. All of these are set together, once.
  signer_name text,
  signed_at timestamptz,
  -- The language the contract was shown in.
  locale text check (locale in ('es', 'en')),
  -- SHA-256 of every document exactly as shown when signed.
  document_hash text check (document_hash ~ '^[0-9a-f]{64}$'),
  signer_ip text,
  signer_user_agent text,
  -- The business terms as printed in the contract (company, address, fee, bond…).
  terms jsonb,
  -- The end of the 3rd business day after signing, computed by the server.
  cancellation_deadline timestamptz,

  -- Cancellation. within_window is true when it happened by the deadline.
  cancelled_at timestamptz,
  cancelled_within_window boolean,
  cancellation_reason text check (cancellation_reason is null or char_length(cancellation_reason) <= 2000),

  -- After the window: the client asked to end the service. A person handles it.
  service_end_requested_at timestamptz,
  service_end_reason text check (service_end_reason is null or char_length(service_end_reason) <= 2000),

  created_at timestamptz not null default now(),

  constraint service_agreements_signature_complete check (
    (signed_at is null and signer_name is null and locale is null and document_hash is null
      and terms is null and cancellation_deadline is null)
    or (signed_at is not null and signer_name is not null and btrim(signer_name) <> '' and locale is not null
      and document_hash is not null and terms is not null and cancellation_deadline is not null)
  ),
  -- The disclosure comes first: a contract cannot be signed before it was acknowledged.
  constraint service_agreements_disclosure_first check (signed_at is null or signed_at > disclosure_acknowledged_at),
  constraint service_agreements_deadline_after_signature check (
    cancellation_deadline is null or cancellation_deadline > signed_at
  ),
  constraint service_agreements_cancellation_complete check ((cancelled_at is null) = (cancelled_within_window is null)),
  constraint service_agreements_cancellation_after_signature check (
    cancelled_at is null or (signed_at is not null and cancelled_at >= signed_at)
  ),
  constraint service_agreements_within_window_is_true check (
    cancelled_within_window is distinct from true or cancelled_at <= cancellation_deadline
  ),
  constraint service_agreements_end_after_signature check (
    service_end_requested_at is null or (signed_at is not null and service_end_requested_at >= signed_at)
  )
);

-- A client has at most one agreement in force (signed and not cancelled).
create unique index service_agreements_one_in_force
  on public.service_agreements (user_id)
  where signed_at is not null and cancelled_at is null;

create index service_agreements_user_created on public.service_agreements (user_id, created_at desc);

-- Records, not working data: what was acknowledged and signed stays as it was.
create function public.service_agreements_guard()
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

  return new;
end;
$$;

revoke all on function public.service_agreements_guard() from public;

create trigger service_agreements_guard
  before update or delete on public.service_agreements
  for each row execute function public.service_agreements_guard();

alter table public.service_agreements enable row level security;

-- Read-only for the client it belongs to and for active staff. No write
-- policy: only the service role, which is not subject to these, writes.
create policy "own agreement read" on public.service_agreements
  for select using (auth.uid() = user_id);

create policy "staff read agreements" on public.service_agreements
  for select using (public.is_staff());

-- ===== 0011_billing.sql =====
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

-- ===== 0013_mail_tracking.sql =====
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
