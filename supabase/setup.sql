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

-- ===== 0012_team.sql =====
-- The team: roles that limit what each member sees, the team list, who works
-- each client, people added by hand, and a record of every change.
--
-- Until now every active member of staff could read every client record
-- (migration 0007), whatever their role. This migration makes the role count,
-- in the database itself, with the same scopes as the console's permission
-- matrix (src/lib/staff/permissions.ts; change both together):
--   admin       every client, every record.
--   specialist  the clients assigned to them (client_assignments): their
--               case (report, answers, rounds, letters, conversation) and
--               their billing, read-only.
--   sales       the clients they brought in (profiles.referred_by = their
--               handle): who the person is, the agreement and the documents
--               on file. Not the case, not the money.
--
-- What it adds:
--   - staff_members: a display name, a handle (the one sales links carry),
--     email, phone, when and by whom they were invited, and when they were
--     deactivated. Nobody is ever deleted: a member who leaves is deactivated,
--     loses access at once (is_staff() counts active members only) and their
--     name stays on everything they did.
--   - staff_invitations: someone added to the team who has not signed in yet.
--     The server turns it into a staff_members row the first time they sign in
--     with that email or phone.
--   - client_assignments: the teammate who works each client (one row per
--     client). team_settings: the round-robin switch.
--   - prospects: people sales added by hand before they have an account.
--   - team_audit: an append-only record of role changes, (de)activations,
--     invitations, assignments and prospects added. It cannot be edited or
--     deleted, by anyone.
--   - staff_role(), staff_handle(), staff_can_see_client(), staff_can_see_case(),
--     staff_can_see_billing(): the scopes above, for the read policies.
--   - The "staff read …" policies from 0007, 0010 and 0011 are replaced by the
--     same policies scoped by role. They stay read-only.
--
-- Who writes: only the server, with the service role, after checking the
-- caller's role (src/app/api/staff/*). No member of staff gets an insert,
-- update or delete policy on any table here, and clients read none of them.

-- ── Who is on the team ──────────────────────────────────────────────────

alter table public.staff_members
  add column display_name text not null default '' check (char_length(display_name) <= 80),
  add column handle text check (handle is null or handle ~ '^[a-z0-9-]{2,30}$'),
  add column email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  add column phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column invited_at timestamptz not null default now(),
  add column invited_by uuid references auth.users (id) on delete set null,
  add column deactivated_at timestamptz;

create unique index staff_members_handle_key on public.staff_members (handle) where handle is not null;

-- "active" and "deactivated_at" always agree: setting active = false (the way
-- 0007 says to remove access) dates it, and reactivating clears the date.
create function public.staff_members_track_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active then
    new.deactivated_at := null;
  elsif new.deactivated_at is null then
    new.deactivated_at := now();
  end if;
  return new;
end;
$$;

create trigger staff_members_track_active
  before insert or update on public.staff_members
  for each row execute function public.staff_members_track_active();

-- A member deactivated before this migration gets a date too.
update public.staff_members set deactivated_at = now() where not active and deactivated_at is null;

-- Deactivate, never delete: the row is the name on the member's work.
create function public.staff_members_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'staff_members: a member is deactivated (active = false), never deleted';
end;
$$;

create trigger staff_members_no_delete
  before delete on public.staff_members
  for each row execute function public.staff_members_no_delete();

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 80),
  handle text not null unique check (handle ~ '^[a-z0-9-]{2,30}$'),
  role text not null check (role in ('admin', 'specialist', 'sales')),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint staff_invitations_contact check (email is not null or phone_e164 is not null),
  constraint staff_invitations_accepted_pair check ((accepted_by is null) = (accepted_at is null))
);

alter table public.staff_invitations enable row level security;

-- ── Role helpers ────────────────────────────────────────────────────────
-- Security definer, like is_staff(): they read staff_members without giving
-- anyone the list. search_path is pinned.

create function public.staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.role from public.staff_members s where s.user_id = auth.uid() and s.active;
$$;

create function public.staff_handle()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.handle from public.staff_members s where s.user_id = auth.uid() and s.active;
$$;

-- ── Who works each client ───────────────────────────────────────────────

create table public.client_assignments (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Null: the client was left without anyone.
  staff_user_id uuid references public.staff_members (user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  -- Null: the round-robin did it.
  assigned_by uuid references auth.users (id) on delete set null,
  auto boolean not null default false
);

alter table public.client_assignments enable row level security;

create table public.team_settings (
  id boolean primary key default true check (id),
  auto_assign boolean not null default false,
  last_auto_assigned uuid references public.staff_members (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.team_settings (id) values (true);

alter table public.team_settings enable row level security;

-- ── People added by hand ────────────────────────────────────────────────
-- Only what sales needs to start the conversation. There is no column for a
-- Social Security number or a date of birth, on purpose: the client gives
-- their identity data themselves, in their own app.

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 2 and 40),
  last_name text not null check (char_length(last_name) between 2 and 40),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  state text not null check (state ~ '^[A-Z]{2}$'),
  goal text not null check (goal in ('mortgage', 'auto', 'card', 'general')),
  -- The salesperson's handle, the same value an invite link writes to profiles.referred_by.
  salesperson text not null check (salesperson ~ '^[a-z0-9-]{2,30}$'),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  assigned_to uuid references public.staff_members (user_id) on delete restrict,
  -- Set when the person creates their account: from then on they are a client.
  converted_user_id uuid references auth.users (id) on delete set null,
  converted_at timestamptz
);

-- One open prospect per phone number.
create unique index prospects_open_phone on public.prospects (phone_e164) where converted_user_id is null;

alter table public.prospects enable row level security;

-- ── The record of every change ──────────────────────────────────────────
-- Plain ids, no foreign keys: a referential action would have to edit a row,
-- and rows here are never edited.

create table public.team_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- Null: the system (the round-robin).
  actor uuid,
  kind text not null check (kind in (
    'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
    'auto_assign_changed', 'client_assigned', 'prospect_added'
  )),
  member uuid,
  member_handle text,
  client_id uuid,
  prospect_id uuid,
  from_role text check (from_role is null or from_role in ('admin', 'specialist', 'sales')),
  to_role text check (to_role is null or to_role in ('admin', 'specialist', 'sales')),
  detail jsonb not null default '{}'
);

create index team_audit_at_idx on public.team_audit (at desc);
create index team_audit_client_idx on public.team_audit (client_id) where client_id is not null;

alter table public.team_audit enable row level security;

create function public.team_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'team_audit: the record of team changes is append-only';
end;
$$;

create trigger team_audit_append_only
  before update or delete on public.team_audit
  for each row execute function public.team_audit_append_only();

-- ── Scopes ──────────────────────────────────────────────────────────────

-- The client's record at all: who they are, the agreement, the documents on file.
create function public.staff_can_see_client(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active and (
      s.role = 'admin'
      or (s.role = 'specialist' and exists (
        select 1 from public.client_assignments a where a.user_id = client and a.staff_user_id = s.user_id
      ))
      or (s.role = 'sales' and s.handle is not null and exists (
        select 1 from public.profiles p where p.id = client and p.referred_by = s.handle
      ))
    )
  );
$$;

-- The case: report, answers, rounds, letters, conversation, events. Not sales.
create function public.staff_can_see_case(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_role() in ('admin', 'specialist') and public.staff_can_see_client(client);
$$;

-- Billing, read-only: payment method summary, charges, refunds, pauses. Not sales.
create function public.staff_can_see_billing(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_role() in ('admin', 'specialist') and public.staff_can_see_client(client);
$$;

revoke all on function public.staff_role() from public;
revoke all on function public.staff_handle() from public;
revoke all on function public.staff_can_see_client(uuid) from public;
revoke all on function public.staff_can_see_case(uuid) from public;
revoke all on function public.staff_can_see_billing(uuid) from public;
grant execute on function public.staff_role() to authenticated;
grant execute on function public.staff_handle() to authenticated;
grant execute on function public.staff_can_see_client(uuid) to authenticated;
grant execute on function public.staff_can_see_case(uuid) to authenticated;
grant execute on function public.staff_can_see_billing(uuid) to authenticated;

-- ── Read policies, scoped by role ───────────────────────────────────────
-- Same names, same tables, still select-only. The customers' own "own …"
-- policies are untouched.

drop policy "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles
  for select using (public.staff_can_see_client(id));

drop policy "staff read monitoring" on public.monitoring_subscriptions;
create policy "staff read monitoring" on public.monitoring_subscriptions
  for select using (public.staff_can_see_client(user_id));

drop policy "staff read documents" on public.identity_documents;
create policy "staff read documents" on public.identity_documents
  for select using (public.staff_can_see_client(user_id));

drop policy "staff read agreements" on public.service_agreements;
create policy "staff read agreements" on public.service_agreements
  for select using (public.staff_can_see_client(user_id));

drop policy "staff read pulls" on public.report_pulls;
create policy "staff read pulls" on public.report_pulls
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read items" on public.report_items;
create policy "staff read items" on public.report_items
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read flags" on public.item_flags;
create policy "staff read flags" on public.item_flags
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read rounds" on public.attack_rounds;
create policy "staff read rounds" on public.attack_rounds
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read letters" on public.letters;
create policy "staff read letters" on public.letters
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read letter items" on public.letter_items;
create policy "staff read letter items" on public.letter_items
  for select using (exists (
    select 1 from public.letters l where l.id = letter_id and public.staff_can_see_case(l.user_id)
  ));

-- A WhatsApp message from a number with no account (user_id null) is for an administrator.
drop policy "staff read chat" on public.chat_messages;
create policy "staff read chat" on public.chat_messages
  for select using (public.staff_can_see_case(user_id) or (user_id is null and public.staff_role() = 'admin'));

drop policy "staff read events" on public.events;
create policy "staff read events" on public.events
  for select using (public.staff_can_see_case(user_id) or (user_id is null and public.staff_role() = 'admin'));

drop policy "staff read payment methods" on public.payment_methods;
create policy "staff read payment methods" on public.payment_methods
  for select using (public.staff_can_see_billing(user_id));

drop policy "staff read charges" on public.charges;
create policy "staff read charges" on public.charges
  for select using (public.staff_can_see_billing(user_id));

drop policy "staff read refunds" on public.refunds;
create policy "staff read refunds" on public.refunds
  for select using (public.staff_can_see_billing(user_id));

drop policy "staff read billing pauses" on public.billing_pauses;
create policy "staff read billing pauses" on public.billing_pauses
  for select using (public.staff_can_see_billing(user_id));

-- ── The team tables ─────────────────────────────────────────────────────

-- Teammates' names and roles, for the console (assignment, the activity log).
create policy "staff read team" on public.staff_members
  for select using (public.is_staff());

create policy "admin read invitations" on public.staff_invitations
  for select using (public.staff_role() = 'admin');

create policy "staff read assignments" on public.client_assignments
  for select using (public.staff_can_see_client(user_id));

create policy "staff read team settings" on public.team_settings
  for select using (public.is_staff());

create policy "staff read prospects" on public.prospects
  for select using (
    public.staff_role() = 'admin'
    or (public.staff_role() = 'specialist' and assigned_to = auth.uid())
    or (public.staff_role() = 'sales' and salesperson = public.staff_handle())
  );

create policy "admin read team audit" on public.team_audit
  for select using (public.staff_role() = 'admin');

create policy "staff read audit of their clients" on public.team_audit
  for select using (client_id is not null and public.staff_can_see_client(client_id));

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

-- Role-scoped like the rest of the case (0012): admins, and the specialist
-- assigned to this client. Sales does not see letters.
create policy "staff read mail events" on public.mail_events
  for select using (public.staff_can_see_case(user_id));

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

-- ===== 0014_staff_records.sql =====
-- The staff console on the database: what the team records that had no
-- table yet, and a few facts about rounds and reports the console shows.
--
-- Until now the console ran only on invented clients (src/lib/staff/data.ts).
-- Its database version reads the tables of 0001-0013 through each member's own
-- connection, so the role-scoped "staff read" policies of migration 0012
-- decide what each person sees. This migration adds what those tables could
-- not hold:
--
--   staff_notes       a teammate's note on a client. Readable by every member
--                     who may see the client (staff_can_see_client): sales
--                     follows up too. Never shown to the client.
--   exception_marks   "marked as handled" on one of the console's notices
--                     (src/lib/staff/stage.ts: clientExceptions). Same scope.
--   report_samples    a report page kept as received, for a provider that has
--                     no reader yet. Part of the case (staff_can_see_case):
--                     not for sales, not for the client.
--   report_pulls      who brought a report in, with which reader, and what it
--                     changed (the console's "Reportes importados").
--   attack_rounds     who sent a round and how (mail service or printed in the
--                     office), when the bureaus' answers came back, and the
--                     items a later report no longer lists (round results).
--
-- Who writes: only the server, with the service role, after checking the
-- caller's role (src/app/api/staff/*). No member of staff and no client gets
-- an insert, update or delete policy on any table here. Notes, handled marks
-- and samples are records: they cannot be edited or deleted, except together
-- with the client's account.

-- ── Notes ──────────────────────────────────────────────────────────────

create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  -- The client the note is about: one with an account, or a person sales added by hand.
  user_id uuid references auth.users (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete cascade,
  author uuid references auth.users (id) on delete set null,
  -- The teammate's handle as the console shows it ("marta").
  author_name text not null check (char_length(author_name) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint staff_notes_one_subject check ((user_id is null) <> (prospect_id is null))
);

create index staff_notes_user_idx on public.staff_notes (user_id, created_at) where user_id is not null;
create index staff_notes_prospect_idx on public.staff_notes (prospect_id, created_at) where prospect_id is not null;

alter table public.staff_notes enable row level security;

-- A prospect's notes follow the prospect's own read policy (migration 0012).
create policy "staff read notes" on public.staff_notes
  for select using (
    (user_id is not null and public.staff_can_see_client(user_id))
    or (prospect_id is not null and exists (select 1 from public.prospects p where p.id = prospect_id))
  );

-- ── Handled marks ──────────────────────────────────────────────────────

create table public.exception_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The notice's key: its kind, and for some kinds what it is about
  -- ("documents_missing", "payment_past_due:<charge id>", "question:<id>").
  exception_key text not null check (char_length(exception_key) between 2 and 200 and exception_key ~ '^[a-z_]{2,40}(:|$)'),
  handled_at timestamptz not null default now(),
  handled_by uuid references auth.users (id) on delete set null,
  handled_by_name text not null default '' check (char_length(handled_by_name) <= 80)
);

create index exception_marks_user_idx on public.exception_marks (user_id, handled_at);

alter table public.exception_marks enable row level security;

create policy "staff read exception marks" on public.exception_marks
  for select using (public.staff_can_see_client(user_id));

-- ── Report samples ─────────────────────────────────────────────────────

create table public.report_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Reader key of the provider it came from (src/lib/reports/readers.ts).
  provider text not null check (provider ~ '^[a-z0-9_]{2,40}$'),
  file_name text check (file_name is null or char_length(file_name) <= 200),
  -- The text exactly as received. Nothing is read from it. Up to 5 MB.
  body text not null check (octet_length(body) between 1 and 5242880),
  saved_by uuid references auth.users (id) on delete set null,
  saved_by_name text not null default '' check (char_length(saved_by_name) <= 80),
  saved_at timestamptz not null default now()
);

create index report_samples_user_idx on public.report_samples (user_id, saved_at);

alter table public.report_samples enable row level security;

create policy "staff read report samples" on public.report_samples
  for select using (public.staff_can_see_case(user_id));

-- ── Records stay as written ────────────────────────────────────────────
-- A delete is allowed only when the client's account (or the prospect) itself
-- is being deleted (the cascade), never on its own.

create function public.staff_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '%: a record cannot be changed', tg_table_name;
  end if;
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  if tg_table_name = 'staff_notes' and exists (select 1 from public.prospects p where p.id = (to_jsonb(old) ->> 'prospect_id')::uuid) then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  return old;
end;
$$;

revoke all on function public.staff_records_append_only() from public;

create trigger staff_notes_append_only
  before update or delete on public.staff_notes
  for each row execute function public.staff_records_append_only();

create trigger exception_marks_append_only
  before update or delete on public.exception_marks
  for each row execute function public.staff_records_append_only();

create trigger report_samples_append_only
  before update or delete on public.report_samples
  for each row execute function public.staff_records_append_only();

-- ── Who imported a report ──────────────────────────────────────────────
-- Empty on a report the monitoring pull brought in by itself.

alter table public.report_pulls
  add column imported_by uuid references auth.users (id) on delete set null,
  add column imported_by_name text check (imported_by_name is null or char_length(imported_by_name) between 1 and 80),
  add column reader_key text check (reader_key is null or reader_key ~ '^[a-z0-9_]{2,40}$'),
  -- {"removed": n, "added": n, "changed": n, "closedRound": n | null}
  add column import_summary jsonb check (import_summary is null or jsonb_typeof(import_summary) = 'object');

-- ── Rounds: who sent them, and what came back ──────────────────────────

alter table public.attack_rounds
  add column sent_by uuid references auth.users (id) on delete set null,
  add column sent_by_name text check (sent_by_name is null or char_length(sent_by_name) between 1 and 80),
  -- "mail": through the mail service (Lob, or simulated without a key). "print": printed in the office.
  add column mail_via text check (mail_via is null or mail_via in ('mail', 'print')),
  -- When a report dated after the response window was imported: the bureaus' answers are in.
  add column responded_at timestamptz,
  -- [{"fingerprint": "...", "outcome": "removed", "reportDate": "..."}]: items of this
  -- round a later report no longer lists. Only what a report proves by itself.
  add column results jsonb not null default '[]' check (jsonb_typeof(results) = 'array'),
  add constraint attack_rounds_responded_after_mailing check (responded_at is null or (mailed_at is not null and responded_at >= mailed_at));

-- ===== 0015_autopilot.sql =====
-- Piloto automático: what the system does by itself, and its record.
--
-- The console used to ask a person to remind clients (sign the agreement,
-- upload documents, finish the review, check the monitoring, add a payment
-- method) and to mail every prepared round by hand. With these tables the
-- system writes the reminders on a short schedule, tells the client what
-- happened (letters mailed, delivered, a new report, a receipt) and mails a
-- round that passed every gate after a review window, unless a person holds
-- it (src/lib/autopilot, docs/AUTOPILOT.md).
--
--   autopilot_settings      the team's switches. One row. Everything new
--                           starts OFF: automatic sending of rounds and
--                           automatic reminders run only once an
--                           administrator turns them on.
--   outbound_messages       every automatic message: one row per message,
--                           with a unique dedupe key, so a run that repeats
--                           (a retry, two runs at once) never writes or sends
--                           the same message twice. Append-only: the words
--                           never change; only the delivery result is filled
--                           in, once (queued → sending → sent | failed, or
--                           queued → cancelled).
--   message_opt_outs        "BAJA" / "STOP" / an unsubscribe link, and "ALTA"
--                           / "START" to come back. Append-only; the newest
--                           record of a client decides.
--   autopilot_holds         a teammate stops the automatic sending and the
--                           reminders for one client, with a reason. Released
--                           once, never deleted.
--   autopilot_ready_rounds  when the system first saw a round ready to send,
--                           with those letters (plan_key). The review window
--                           counts from here; different letters, a new window.
--
-- Who writes: only the server, with the service role (the autopilot run
-- /api/cron/autopilot, the inbound WhatsApp webhook, the unsubscribe link and
-- the staff routes after checking the caller's role). Nobody gets an insert,
-- update or delete policy. Staff read by role (the scopes of migration 0012);
-- a client reads their own messages and opt-outs.

-- ── Settings ───────────────────────────────────────────────────────────

create table public.autopilot_settings (
  id boolean primary key default true check (id),
  rounds_enabled boolean not null default false,
  review_window_hours integer not null default 24 check (review_window_hours between 1 and 168),
  followups_enabled boolean not null default false,
  -- {"agreement_unsigned": true, ...}: each situation on or off. A missing key is on.
  followups jsonb not null default '{}' check (jsonb_typeof(followups) = 'object'),
  status_enabled boolean not null default true,
  quiet_start_hour smallint not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour smallint not null default 8 check (quiet_end_hour between 0 and 23),
  daily_cap smallint not null default 2 check (daily_cap between 1 and 5),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80)
);

insert into public.autopilot_settings (id) values (true);

alter table public.autopilot_settings enable row level security;

create policy "staff read autopilot settings" on public.autopilot_settings
  for select using (public.is_staff());

-- A change to the switches is recorded in the team's audit (admin-only read).
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added', 'autopilot_changed'
));

-- ── Outbound messages ──────────────────────────────────────────────────

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "followup:<client>:<situation>:<step>" or "status:<client>:<what>:<which>".
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 240),
  kind text not null check (kind in ('followup', 'status')),
  topic text not null check (topic ~ '^[a-z_]{2,40}$'),
  step smallint check (step is null or step between 1 and 10),
  -- Never 'sms': text messages are only for login codes (docs/AUTOPILOT.md).
  channel text check (channel is null or channel in ('whatsapp', 'email')),
  template text check (template is null or template ~ '^[a-z0-9_]{2,120}$'),
  params jsonb not null default '[]' check (jsonb_typeof(params) = 'array'),
  locale text not null default 'es' check (locale in ('es', 'en')),
  body text not null check (char_length(body) between 1 and 4000),
  link text check (link is null or char_length(link) <= 500),
  status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  note text check (note is null or char_length(note) <= 300),
  constraint outbound_step_matches_kind check ((kind = 'followup') = (step is not null)),
  constraint outbound_channel_once_claimed check (status in ('queued', 'cancelled') or channel is not null)
);

create index outbound_messages_user_idx on public.outbound_messages (user_id, queued_at);
create index outbound_messages_queued_idx on public.outbound_messages (status, queued_at) where status = 'queued';

alter table public.outbound_messages enable row level security;

create policy "staff read outbound messages" on public.outbound_messages
  for select using (public.staff_can_see_case(user_id));

create policy "own outbound messages" on public.outbound_messages
  for select using (auth.uid() = user_id);

-- The words, the client, the key and the kind never change. The delivery
-- result moves forward once: queued → sending | cancelled, sending → sent | failed.
create function public.outbound_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'outbound_messages: a message record cannot be deleted';
    end if;
    return old;
  end if;
  if new.user_id <> old.user_id or new.dedupe_key <> old.dedupe_key or new.kind <> old.kind or new.topic <> old.topic
     or new.step is distinct from old.step or new.body <> old.body or new.locale <> old.locale
     or new.link is distinct from old.link or new.params <> old.params or new.queued_at <> old.queued_at then
    raise exception 'outbound_messages: a message cannot be rewritten';
  end if;
  if not (
       (old.status = 'queued' and new.status in ('sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'failed'))
  ) then
    raise exception 'outbound_messages: % cannot become %', old.status, new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.outbound_messages_guard() from public;

create trigger outbound_messages_guard
  before update or delete on public.outbound_messages
  for each row execute function public.outbound_messages_guard();

-- ── Opt-outs ───────────────────────────────────────────────────────────

create table public.message_opt_outs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  -- For a number with no account yet.
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('opt_out', 'opt_in')),
  -- How it arrived: a WhatsApp keyword, the email unsubscribe link, or a teammate who heard it from the client.
  channel text not null check (channel in ('whatsapp', 'email', 'staff')),
  keyword text check (keyword is null or char_length(keyword) between 1 and 40),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text check (recorded_by_name is null or char_length(recorded_by_name) between 1 and 80),
  at timestamptz not null default now(),
  constraint message_opt_outs_subject check (user_id is not null or phone_e164 is not null)
);

create index message_opt_outs_user_idx on public.message_opt_outs (user_id, at) where user_id is not null;

alter table public.message_opt_outs enable row level security;

-- Sales follows people before the work starts: they see an opt-out too.
create policy "staff read opt-outs" on public.message_opt_outs
  for select using (user_id is not null and public.staff_can_see_client(user_id));

create policy "own opt-outs" on public.message_opt_outs
  for select using (auth.uid() = user_id);

-- ── Holds ──────────────────────────────────────────────────────────────

create table public.autopilot_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  held_at timestamptz not null default now(),
  held_by uuid references auth.users (id) on delete set null,
  held_by_name text not null check (char_length(held_by_name) between 1 and 80),
  released_at timestamptz,
  released_by uuid references auth.users (id) on delete set null,
  released_by_name text check (released_by_name is null or char_length(released_by_name) between 1 and 80),
  constraint autopilot_holds_release_pair check ((released_at is null) = (released_by_name is null)),
  constraint autopilot_holds_release_after check (released_at is null or released_at >= held_at)
);

-- One open hold per client.
create unique index autopilot_holds_open on public.autopilot_holds (user_id) where released_at is null;

alter table public.autopilot_holds enable row level security;

create policy "staff read holds" on public.autopilot_holds
  for select using (public.staff_can_see_case(user_id));

-- A hold is released once and is otherwise never edited or deleted.
create function public.autopilot_holds_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'autopilot_holds: a hold cannot be deleted';
    end if;
    return old;
  end if;
  if old.released_at is not null then
    raise exception 'autopilot_holds: a released hold cannot be changed';
  end if;
  if new.user_id <> old.user_id or new.reason <> old.reason or new.held_at <> old.held_at
     or new.held_by is distinct from old.held_by or new.held_by_name <> old.held_by_name then
    raise exception 'autopilot_holds: only the release can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.autopilot_holds_guard() from public;

create trigger autopilot_holds_guard
  before update or delete on public.autopilot_holds
  for each row execute function public.autopilot_holds_guard();

-- ── Rounds seen ready ──────────────────────────────────────────────────

create table public.autopilot_ready_rounds (
  user_id uuid not null references auth.users (id) on delete cascade,
  round_number integer not null check (round_number between 1 and 100),
  -- A short key of the round's letters (src/lib/autopilot/sending.ts: roundPlanKey).
  plan_key text not null check (plan_key ~ '^p[0-9a-f]{8}[0-9]{1,3}$'),
  first_ready_at timestamptz not null default now(),
  primary key (user_id, round_number, plan_key)
);

alter table public.autopilot_ready_rounds enable row level security;

create policy "staff read ready rounds" on public.autopilot_ready_rounds
  for select using (public.staff_can_see_case(user_id));

-- Opt-outs and rounds seen ready are records: never edited, deleted only with the account.
create function public.autopilot_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '%: a record cannot be changed', tg_table_name;
  end if;
  if old.user_id is not null and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  if old.user_id is null and tg_table_name = 'message_opt_outs' then
    raise exception '%: a record cannot be deleted', tg_table_name;
  end if;
  return old;
end;
$$;

revoke all on function public.autopilot_append_only() from public;

create trigger message_opt_outs_append_only
  before update or delete on public.message_opt_outs
  for each row execute function public.autopilot_append_only();

create trigger autopilot_ready_rounds_append_only
  before update or delete on public.autopilot_ready_rounds
  for each row execute function public.autopilot_append_only();

-- ===== 0016_intake.sql =====
-- AI intake (src/lib/intake, docs/INTAKE.md): what Claude read from a
-- client's documents and what the checks in code decided.
--
--   intake_documents   one row per document read: a credit report staff
--                      uploaded (PDF or saved page), a photo ID or proof of
--                      address the client uploaded, or a bureau's letter
--                      (optional: round results come from the next report).
--                      Kept: the status, the reasons in plain Spanish, the
--                      letter's per-item results, the report reading (to save
--                      it after review), and the tokens and estimated cost.
--                      Never kept: an ID number, a date of birth, a Social
--                      Security number, or the name/address read off an ID.
--   intake-files       a private storage bucket for report PDFs and bureau
--                      letters. ID photos stay in 'identity-docs' (0003).
--
-- Who writes: only the server, with the service role, after checking who is
-- asking (src/app/api/intake/*, src/app/api/staff/intake/*). Nobody gets an
-- insert, update or delete policy. A record is not edited: a new upload is a
-- new row.
--
-- Who reads: the client their own ID/address checks and letters (not the
-- report readings, which are staff work in progress); staff by role, with the
-- same scopes as the documents (staff_can_see_client) and the case
-- (staff_can_see_case) of migration 0012.

create table public.intake_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('credit_report', 'government_id', 'proof_of_address', 'bureau_letter')),
  status text not null check (status in ('accepted', 'needs_person', 'read', 'failed')),
  -- True when no AI read it (no API key configured): never counts as a check.
  simulated boolean not null default false,
  reasons text[] not null default '{}',
  -- Bureau letters: { bureau, letterDate, items: [{ creditor, account (last 4), outcome, fingerprint, citation }] }.
  -- Credit reports: the reading (src/lib/intake/report/envelope.ts) and the validation summary.
  result jsonb,
  storage_bucket text check (storage_bucket is null or storage_bucket in ('identity-docs', 'intake-files')),
  storage_path text,
  file_kind text check (file_kind is null or file_kind in ('pdf', 'jpeg', 'png', 'html', 'text')),
  file_bytes integer check (file_bytes is null or file_bytes >= 0),
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_role text not null check (uploaded_by_role in ('client', 'staff')),
  created_at timestamptz not null default now(),
  constraint intake_reasons_short check (array_length(reasons, 1) is null or array_length(reasons, 1) <= 40)
);

create index intake_documents_user_idx on public.intake_documents (user_id, created_at);

alter table public.intake_documents enable row level security;

create policy "own intake read" on public.intake_documents
  for select using (auth.uid() = user_id and kind <> 'credit_report');

create policy "staff read intake documents" on public.intake_documents
  for select using (
    (kind in ('government_id', 'proof_of_address') and public.staff_can_see_client(user_id))
    or (kind in ('credit_report', 'bureau_letter') and public.staff_can_see_case(user_id))
  );

-- A record of what was read: not edited, not deleted (except with the account).
create function public.intake_documents_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'intake_documents rows are records and cannot be changed';
end;
$$;

create trigger intake_documents_no_update
  before update on public.intake_documents
  for each row execute function public.intake_documents_append_only();

-- Storage for report PDFs and bureau letters. Private, and no policy: only the
-- server (service role) writes and reads it, and hands out short-lived links.
insert into storage.buckets (id, name, public) values ('intake-files', 'intake-files', false)
  on conflict (id) do nothing;

-- ===== 0017_partners_highlevel.sql =====
-- Leads from HighLevel, stage updates back to HighLevel, and referral partners.
--
-- Marketing and the lead CRM run in HighLevel; the app owns the person once
-- sales starts working them. This migration adds what that handoff needs, and
-- the records for referral partners (realtors, loan officers, tax preparers):
--
--   partners             a referral partner: who they are, their status
--                        (pending → approved, or declined / suspended), their
--                        referral code, the salesperson who looks after them,
--                        and the commission terms an administrator set. No
--                        payout is ever made by the app: payments are recorded
--                        by hand in partner_commissions.
--   partner_members      the sign-in (auth user) of an approved partner. A
--                        partner is NOT staff: is_staff() and staff_role() stay
--                        false/null for them, so no "staff read" policy applies.
--   partner_commissions  an administrator's record of commission owed or paid.
--                        Append-only.
--   prospects            + where the person came from (manual, highlevel,
--                        partner), the HighLevel contact id, the campaign and
--                        UTM tags, the partner, the consent the lead gave, when
--                        the invitation went out, and when sales closed them as
--                        lost. A prospect from HighLevel or a partner has no
--                        teammate as its creator (created_by may be null then).
--   profiles             + the partner a client came through, and their
--                        HighLevel contact id. Written by the server only: a
--                        client's own connection cannot set or change either.
--   integration_outbox   stage changes waiting to be sent to HighLevel. Each
--                        event once (dedupe_key), retried with backoff. Rows
--                        are never deleted; only the delivery columns change,
--                        and never after the event was sent or given up.
--   webhook_receipts     one row per HighLevel delivery, keyed by a hash of the
--                        exact body, so a redelivery does nothing twice. Holds
--                        no personal data: never the body, and never the value
--                        of a field that was dropped (only its name).
--
-- Never stored, anywhere here: a Social Security number or a date of birth.
-- There is no column for either; the webhook drops such a field before
-- anything is written and records only that it did.
--
-- Who writes: only the server, with the service role. Nobody (client, staff
-- member or partner) gets an insert, update or delete policy here.
-- Who reads:
--   administrators   everything here;
--   sales            the partner list (to know who referred whom);
--   specialists      nothing new (they see a client's source on the client);
--   a partner        their own partner row, their own commission records, and
--                    their referrals through partner_referrals(): first name,
--                    last initial, date and a coarse status. Never a report,
--                    an item, a letter, a score, an agreement or a payment.

-- ── Partners ────────────────────────────────────────────────────────────

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  company text check (company is null or char_length(company) between 2 and 120),
  kind text not null check (kind in ('realtor', 'loan_officer', 'tax_preparer', 'other')),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'suspended')),
  -- The code in their link (/r/<code>). Given when an administrator approves them.
  referral_code text unique check (referral_code is null or referral_code ~ '^[a-z0-9-]{3,30}$'),
  -- The salesperson who works the people this partner refers (staff_members.handle).
  salesperson text check (salesperson is null or salesperson ~ '^[a-z0-9-]{2,30}$'),
  -- Commission terms, as an administrator set them. Paid per person who signs
  -- or per active client, never per result on a report: there is no such option.
  commission_basis text not null default 'none' check (commission_basis in ('none', 'signed_client', 'active_client')),
  commission_cents integer not null default 0 check (commission_cents between 0 and 100000),
  commission_note text check (commission_note is null or char_length(commission_note) <= 500),
  -- The partner terms they accepted when applying (src/lib/partners/copy.ts PARTNER_TERMS_VERSION).
  terms_version text not null check (char_length(terms_version) between 4 and 40),
  terms_accepted_at timestamptz not null,
  applied_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  constraint partners_code_when_approved check (status <> 'approved' or referral_code is not null),
  constraint partners_commission_pair check ((commission_basis = 'none') = (commission_cents = 0))
);

-- One open application or partnership per phone.
create unique index partners_open_phone on public.partners (phone_e164) where status in ('pending', 'approved');

alter table public.partners enable row level security;

-- A partner is declined or suspended, never deleted: their name stays on their referrals.
create function public.partners_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'partners: a partner is declined or suspended, never deleted';
end;
$$;

revoke all on function public.partners_no_delete() from public;

create trigger partners_no_delete
  before delete on public.partners
  for each row execute function public.partners_no_delete();

create table public.partner_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  partner_id uuid not null unique references public.partners (id) on delete restrict,
  joined_at timestamptz not null default now()
);

alter table public.partner_members enable row level security;

-- Plain ids, no foreign keys to rows that could change: rows here are never edited.
create table public.partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  kind text not null check (kind in ('owed', 'paid')),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  -- The referral it is for, when it is for one (a prospect id).
  referral_id uuid,
  note text check (note is null or char_length(note) <= 300),
  recorded_by uuid,
  recorded_by_name text not null default '' check (char_length(recorded_by_name) <= 80),
  recorded_at timestamptz not null default now()
);

create index partner_commissions_partner_idx on public.partner_commissions (partner_id, recorded_at);

alter table public.partner_commissions enable row level security;

create function public.partner_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a record cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.partner_records_append_only() from public;

create trigger partner_commissions_append_only
  before update or delete on public.partner_commissions
  for each row execute function public.partner_records_append_only();

-- ── Where a person came from ────────────────────────────────────────────

alter table public.prospects
  alter column created_by drop not null,
  add column source text not null default 'manual' check (source in ('manual', 'highlevel', 'partner')),
  -- {"campaign": "...", "utm": {"source": "...", ...}, "form": "...", "lastTouchAt": "..."}: marketing tags only.
  add column source_detail jsonb not null default '{}' check (jsonb_typeof(source_detail) = 'object' and octet_length(source_detail::text) <= 4000),
  add column highlevel_contact_id text check (highlevel_contact_id is null or highlevel_contact_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  add column partner_id uuid references public.partners (id) on delete restrict,
  -- The words the lead agreed to (the form's consent text), and when.
  add column consent_text text check (consent_text is null or char_length(consent_text) between 10 and 1000),
  add column consent_at timestamptz,
  add column invited_at timestamptz,
  add column last_touch_at timestamptz,
  add column lost_at timestamptz,
  add constraint prospects_creator check (created_by is not null or source <> 'manual');

-- One open prospect per phone (0012), where "open" now also means sales has not
-- closed them: a lead who comes back long after being closed is a new lead.
drop index public.prospects_open_phone;
create unique index prospects_open_phone on public.prospects (phone_e164) where converted_user_id is null and lost_at is null;

-- A HighLevel contact is one prospect.
create unique index prospects_highlevel_contact on public.prospects (highlevel_contact_id) where highlevel_contact_id is not null;
create index prospects_partner_idx on public.prospects (partner_id) where partner_id is not null;

alter table public.profiles
  add column referred_partner_id uuid references public.partners (id) on delete restrict,
  add column highlevel_contact_id text check (highlevel_contact_id is null or highlevel_contact_id ~ '^[A-Za-z0-9_-]{4,64}$');

-- The client's own connection may write their profile ("own profile", 0001),
-- but never who referred them to a partner or their HighLevel contact: those
-- decide commissions and are the server's to write. auth.uid() is set on a
-- signed-in person's connection and empty for the service role.
create function public.profiles_attribution_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.referred_partner_id is not null or new.highlevel_contact_id is not null) then
    raise exception 'profiles: partner and HighLevel attribution are written by the server only';
  end if;
  if tg_op = 'UPDATE' and (
    new.referred_partner_id is distinct from old.referred_partner_id
    or new.highlevel_contact_id is distinct from old.highlevel_contact_id
  ) then
    raise exception 'profiles: partner and HighLevel attribution are written by the server only';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_attribution_guard() from public;

create trigger profiles_attribution_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_attribution_guard();

-- The round-robin for leads that arrive with no salesperson: the last
-- salesperson who got one (team_settings.last_auto_assigned is the specialists').
alter table public.team_settings
  add column last_sales_assigned uuid references public.staff_members (user_id) on delete set null;

-- New kinds in the team's record.
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  -- Kept from 0015 (the autopilot's switches); this list replaces the whole constraint.
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded'
));

-- ── Stage updates for HighLevel ─────────────────────────────────────────

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  -- "<client or prospect id>:<stage>": the same stage of the same person is sent once.
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 200),
  destination text not null default 'highlevel' check (destination in ('highlevel')),
  stage text not null check (stage in (
    'invited', 'agreement_signed', 'cancelled_in_window', 'documents_complete',
    'first_round_mailed', 'paused_for_payment', 'service_ended'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000),
  created_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 50),
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  sent_at timestamptz,
  gave_up_at timestamptz
);

create index integration_outbox_due_idx on public.integration_outbox (next_attempt_at) where sent_at is null and gave_up_at is null;

alter table public.integration_outbox enable row level security;

-- What an event may carry: the HighLevel contact, the phone, the stage and its
-- date, and the event's own id. Nothing about the credit file, ever. Checked on
-- the way in, whatever the server code does.
create function public.integration_outbox_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  key text;
begin
  if tg_op = 'DELETE' then
    raise exception 'integration_outbox: an event is never deleted';
  end if;
  if tg_op = 'INSERT' then
    for key in select jsonb_object_keys(new.payload) loop
      if key not in ('event', 'eventId', 'contactId', 'phone', 'stage', 'stageLabel', 'occurredAt', 'source', 'text') then
        raise exception 'integration_outbox: % may not be sent to HighLevel', key;
      end if;
    end loop;
    return new;
  end if;
  if new.id is distinct from old.id
    or new.dedupe_key is distinct from old.dedupe_key
    or new.destination is distinct from old.destination
    or new.stage is distinct from old.stage
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'integration_outbox: an event cannot be changed';
  end if;
  if old.sent_at is not null or old.gave_up_at is not null then
    raise exception 'integration_outbox: a delivered or abandoned event cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.integration_outbox_guard() from public;

create trigger integration_outbox_guard
  before insert or update or delete on public.integration_outbox
  for each row execute function public.integration_outbox_guard();

create table public.webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('highlevel')),
  -- sha256 of the exact body received.
  delivery_key text not null check (delivery_key ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  outcome text not null check (outcome in ('created', 'updated', 'existing_client', 'rejected')),
  prospect_id uuid,
  -- The names of fields that were dropped without being stored (an SSN, a date of birth). Never their values.
  dropped_fields text[] not null default '{}',
  unique (source, delivery_key)
);

alter table public.webhook_receipts enable row level security;

create trigger webhook_receipts_append_only
  before update or delete on public.webhook_receipts
  for each row execute function public.partner_records_append_only();

-- ── Who is a partner ────────────────────────────────────────────────────

-- The approved partner the signed-in person signs in for, or null.
create function public.partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.partner_id from public.partner_members m
  join public.partners p on p.id = m.partner_id
  where m.user_id = auth.uid() and p.status = 'approved';
$$;

-- The signed-in partner's referrals, with only a coarse status:
--   contacted      sales is talking with them, or they have an account but no signed agreement;
--   signed         they signed the service agreement and no round has been mailed yet;
--   active         at least one round of letters has been mailed and the service goes on;
--   not_continued  they cancelled, asked to end the service, or sales closed them.
-- First name and last initial only. Nothing from the credit file, the letters,
-- the agreement's terms or the payments.
create function public.partner_referrals()
returns table (referral_id uuid, first_name text, last_initial text, referred_at timestamptz, status text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.partner_id() as pid),
  people as (
    -- Referred as a prospect (the partner's form, or a HighLevel lead carrying their code).
    select p.id as referral_id, p.first_name, left(p.last_name, 1) as last_initial, p.created_at as referred_at,
           p.converted_user_id as user_id, p.lost_at
    from public.prospects p, me
    where me.pid is not null and p.partner_id = me.pid
    union all
    -- Came by the partner's link and signed up by themselves (no prospect row of this partner).
    select pr.id, split_part(btrim(pr.full_name), ' ', 1), left(split_part(btrim(pr.full_name), ' ', 2), 1), pr.created_at,
           pr.id, null::timestamptz
    from public.profiles pr, me
    where me.pid is not null and pr.referred_partner_id = me.pid
      and not exists (select 1 from public.prospects p2 where p2.converted_user_id = pr.id and p2.partner_id = me.pid)
  )
  select x.referral_id, x.first_name, x.last_initial, x.referred_at,
    case
      when x.lost_at is not null then 'not_continued'
      when a.cancelled_at is not null or a.service_end_requested_at is not null then 'not_continued'
      when a.signed_at is not null and exists (
        select 1 from public.attack_rounds r where r.user_id = x.user_id and r.mailed_at is not null
      ) then 'active'
      when a.signed_at is not null then 'signed'
      else 'contacted'
    end as status
  from people x
  left join lateral (
    select s.signed_at, s.cancelled_at, s.service_end_requested_at
    from public.service_agreements s
    where x.user_id is not null and s.user_id = x.user_id
    order by s.created_at desc
    limit 1
  ) a on true
  order by x.referred_at desc;
$$;

revoke all on function public.partner_id() from public;
revoke all on function public.partner_referrals() from public;
grant execute on function public.partner_id() to authenticated;
grant execute on function public.partner_referrals() to authenticated;

-- ── Read policies ───────────────────────────────────────────────────────

create policy "staff read partners" on public.partners
  for select using (public.staff_role() in ('admin', 'sales'));

create policy "partner reads own partner row" on public.partners
  for select using (id = public.partner_id());

create policy "partner reads own membership" on public.partner_members
  for select using (user_id = auth.uid());

create policy "admin read partner members" on public.partner_members
  for select using (public.staff_role() = 'admin');

create policy "admin read partner commissions" on public.partner_commissions
  for select using (public.staff_role() = 'admin');

create policy "partner reads own commissions" on public.partner_commissions
  for select using (partner_id = public.partner_id());

create policy "admin read outbox" on public.integration_outbox
  for select using (public.staff_role() = 'admin');

create policy "admin read webhook receipts" on public.webhook_receipts
  for select using (public.staff_role() = 'admin');

-- ===== 0018_client_experience.sql =====
-- Client experience: the satisfaction pulse ("¿Cómo vamos?").
--
-- After a few key moments (agreement signed, first round mailed, first answer
-- from a bureau) the client app asks once, with three faces and an optional
-- comment. One row per client per moment.
--
--   Written:  only by the server (POST /api/pulse), after validating the body,
--             for the signed-in client and nobody else. No insert policy: a
--             client cannot write a row by talking to the database directly.
--   Read:     the client reads their own rows; staff read them by role through
--             the 0012 scope functions (admin: everyone; specialist: assigned
--             clients; sales: none, like the rest of the case).
--   Changed:  only one way: a comment the client adds right after tapping a
--             face, once, where there was none (POST /api/pulse again). A
--             trigger refuses every other change, even from the service role.
--             No update or delete policy for anyone: staff can never write,
--             edit or remove a client's answer.

create table public.client_pulses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  moment text not null check (moment in ('agreement_signed', 'first_round_mailed', 'first_answer')),
  -- 1 = not well, 2 = so-so, 3 = well.
  rating smallint not null check (rating between 1 and 3),
  comment text check (comment is null or char_length(btrim(comment)) between 1 and 500),
  locale text not null default 'es' check (locale in ('es', 'en')),
  created_at timestamptz not null default now(),
  unique (user_id, moment)
);

create index client_pulses_created_idx on public.client_pulses (created_at desc);

alter table public.client_pulses enable row level security;

create policy "own pulses read" on public.client_pulses
  for select using (auth.uid() = user_id);

create policy "staff read pulses" on public.client_pulses
  for select using (public.staff_can_see_case(user_id));

create function public.client_pulses_unchangeable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one change allowed: a first comment on an answer that had none.
  if old.comment is null and new.comment is not null
     and new.id = old.id and new.user_id = old.user_id and new.moment = old.moment
     and new.rating = old.rating and new.locale = old.locale and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'client_pulses rows cannot be changed';
end;
$$;

create trigger client_pulses_no_update
  before update on public.client_pulses
  for each row execute function public.client_pulses_unchangeable();

-- ===== 0019_letter_versions.sql =====
-- Letter versions (src/lib/letters/versions, docs/LETTERS-EDITOR.md): the
-- owner changes a dispute letter in /equipo/cartas without a developer, and
-- only text an attorney approved is mailed.
--
--   letter_template_versions   one row per version of a letter template.
--       Version 1 is the text in code ("incluida"); it gets a row only when
--       it is sent to the attorney. Versions 2+ are edits. A version is a
--       draft while it is written, then "sent" to the attorney, then
--       approved or rejected with the attorney's name (text: the attorney is
--       not a user), the date and a note.
--   letters.template_version, letters.template_hash
--       which version, and which exact text (sha-256), a letter was rendered
--       from (src/lib/rounds/send.ts).
--
-- Who writes: only the server, with the service role, after
-- requireCapability('letters.edit') (administrators): POST /api/staff/letters.
-- Nobody gets an insert, update or delete policy.
--
-- Who reads: administrators every version; specialists the approved ones (the
-- console prints and previews letters with the approved text). Sales and
-- clients: none.
--
-- What cannot change, even for the server (trigger below): once a version is
-- sent to the attorney its text, key, number and author are frozen; it can
-- only move sent → approved or sent → rejected, once, and a decided version
-- does not change at all. Only a draft can be deleted. A change is a new
-- version.

create table public.letter_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key ~ '^[a-z0-9_]{1,80}$'),
  version integer not null check (version >= 1),
  origin text not null check (origin in ('builtin', 'edited')),
  -- Letters mail in English (the bureaus' language). Kept as a column so a
  -- Spanish version could be added without changing what a row means.
  locale text not null default 'en' check (locale = 'en'),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  variables text[] not null default '{}',
  based_on integer check (based_on is null or based_on >= 1),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected')),
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by_name text,
  approved_by text check (approved_by is null or char_length(btrim(approved_by)) between 3 and 120),
  approved_at date,
  approval_note text check (approval_note is null or char_length(approval_note) <= 2000),
  rejected_by text check (rejected_by is null or char_length(btrim(rejected_by)) between 3 and 120),
  rejected_at date,
  rejection_note text check (rejection_note is null or char_length(rejection_note) <= 2000),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text,
  recorded_at timestamptz,
  unique (template_key, version),
  constraint letter_versions_origin check ((version = 1) = (origin = 'builtin')),
  constraint letter_versions_sent check ((status = 'draft') = (sent_at is null)),
  constraint letter_versions_approved check (
    (status = 'approved') = (approved_by is not null and approved_at is not null)
  ),
  constraint letter_versions_rejected check (
    (status = 'rejected') = (rejected_by is not null and rejected_at is not null and rejection_note is not null)
  ),
  constraint letter_versions_recorded check ((status in ('approved', 'rejected')) = (recorded_at is not null))
);

-- One open draft per letter.
create unique index letter_versions_one_draft on public.letter_template_versions (template_key) where status = 'draft';
create index letter_versions_status_idx on public.letter_template_versions (status, template_key);

alter table public.letter_template_versions enable row level security;

create policy "admin read letter versions" on public.letter_template_versions
  for select to authenticated using (public.staff_role() = 'admin');

create policy "specialist read approved letter versions" on public.letter_template_versions
  for select to authenticated using (status = 'approved' and public.staff_role() = 'specialist');

create function public.letter_template_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then
      return old;
    end if;
    raise exception 'letter_template_versions: a version sent to the attorney is a record and cannot be deleted';
  end if;

  if new.id <> old.id or new.template_key <> old.template_key or new.version <> old.version
     or new.origin <> old.origin or new.created_at <> old.created_at then
    raise exception 'letter_template_versions: a version keeps its letter and number';
  end if;

  if old.status = 'draft' then
    -- A draft may be rewritten, and may be sent.
    if new.status not in ('draft', 'sent') then
      raise exception 'letter_template_versions: a draft goes to the attorney before it is decided';
    end if;
    return new;
  end if;

  -- Sent or decided: the text is frozen.
  if new.subject <> old.subject or new.body <> old.body or new.variables <> old.variables
     or new.content_hash <> old.content_hash or new.locale <> old.locale
     or new.based_on is distinct from old.based_on
     or new.author_id is distinct from old.author_id or new.author_name <> old.author_name
     or new.sent_at is distinct from old.sent_at or new.sent_by_name is distinct from old.sent_by_name then
    raise exception 'letter_template_versions: the text of a version sent to the attorney cannot be changed; make a new version';
  end if;

  if old.status = 'sent' and new.status in ('approved', 'rejected') then
    return new;
  end if;

  raise exception 'letter_template_versions: the attorney''s decision cannot be changed';
end;
$$;

create trigger letter_template_versions_guard
  before update or delete on public.letter_template_versions
  for each row execute function public.letter_template_versions_guard();

-- Which version, and which exact text, each letter was rendered from.
alter table public.letters
  add column template_version integer check (template_version is null or template_version >= 1),
  add column template_hash text check (template_hash is null or template_hash ~ '^[0-9a-f]{64}$');

-- ===== 0020_staff_assist.sql =====
-- The one-person console: saved answers, the morning summary, and each
-- member's own preferences (docs/STAFF.md).
--
--   saved_answers          the library of approved answers to questions
--                          clients keep asking. Written only by the server
--                          (POST /api/staff/answers), after the role check:
--                          an administrator's goes in approved; a specialist's
--                          goes in proposed until an administrator approves it.
--                          AltiBot (/api/coach) may send an APPROVED answer to
--                          a client by itself, and checks the claim rules again
--                          first. Read by admins and specialists; a proposal
--                          only by admins and the person who proposed it.
--   saved_answer_events    every save, edit, approval and deletion, with the
--                          words as they were. Append-only: what AltiBot could
--                          say on a given day can always be traced.
--   staff_preferences      one row per member: the morning summary (on/off,
--                          channel, time, time zone) and the first-day
--                          checklist. Read by the member; written by the server.
--   staff_digests          one row per member per local day: the morning
--                          summary claimed before it is sent (the unique key
--                          is what makes it go once). Never SMS.
--
-- Staff have no write policy on any of these: every write is a server route
-- that checked the member's role first.

-- ── Saved answers ───────────────────────────────────────────────────────

create table public.saved_answers (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(btrim(question)) between 8 and 500),
  answer text not null check (char_length(btrim(answer)) between 20 and 4000),
  status text not null default 'proposed' check (status in ('proposed', 'approved')),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null check (char_length(created_by_name) between 1 and 80),
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_name text check (approved_by_name is null or char_length(approved_by_name) between 1 and 80),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Approved means an administrator's name and the moment are on record; proposed means neither.
  constraint saved_answers_approval check ((status = 'approved') = (approved_at is not null and approved_by_name is not null))
);

create index saved_answers_status_idx on public.saved_answers (status, updated_at desc);

alter table public.saved_answers enable row level security;

create policy "staff read approved answers" on public.saved_answers
  for select using (status = 'approved' and public.staff_role() in ('admin', 'specialist'));

create policy "staff read proposed answers" on public.saved_answers
  for select using (status = 'proposed' and (public.staff_role() = 'admin' or created_by = auth.uid()));

create function public.saved_answers_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  return new;
end;
$$;

create trigger saved_answers_touch
  before update on public.saved_answers
  for each row execute function public.saved_answers_touch();

create table public.saved_answer_events (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null,
  kind text not null check (kind in ('saved', 'edited', 'approved', 'deleted')),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null,
  question text not null,
  answer text not null,
  status text not null check (status in ('proposed', 'approved')),
  created_at timestamptz not null default now()
);

create index saved_answer_events_answer_idx on public.saved_answer_events (answer_id, created_at);

alter table public.saved_answer_events enable row level security;

create policy "admins read answer history" on public.saved_answer_events
  for select using (public.staff_role() = 'admin');

create function public.saved_answer_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'saved_answer_events: a record cannot be changed or deleted';
end;
$$;

create trigger saved_answer_events_append_only
  before update or delete on public.saved_answer_events
  for each row execute function public.saved_answer_events_append_only();

-- ── Each member's preferences ───────────────────────────────────────────

create table public.staff_preferences (
  user_id uuid primary key references public.staff_members (user_id) on delete cascade,
  digest_enabled boolean not null default false,
  digest_channel text not null default 'whatsapp' check (digest_channel in ('whatsapp', 'email')),
  digest_time text not null default '08:30' check (digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text not null default 'America/Chicago' check (time_zone ~ '^[A-Za-z_]+/[A-Za-z_]+$'),
  checklist_dismissed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.staff_preferences enable row level security;

create policy "own staff preferences read" on public.staff_preferences
  for select using (auth.uid() = user_id);

-- ── The morning summary, once per member per day ────────────────────────

create table public.staff_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  local_day date not null,
  -- Never 'sms': text messages are only for login codes.
  channel text check (channel in ('whatsapp', 'email')),
  status text not null check (status in ('sending', 'sent', 'failed')),
  body text not null,
  note text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, local_day)
);

alter table public.staff_digests enable row level security;

create policy "own staff digests read" on public.staff_digests
  for select using (auth.uid() = user_id or public.staff_role() = 'admin');

-- The words are what was sent: only the status moves forward, from sending.
create function public.staff_digests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.staff_members m where m.user_id = old.user_id) then
      raise exception 'staff_digests: a record cannot be deleted';
    end if;
    return old;
  end if;
  if new.body is distinct from old.body or new.user_id <> old.user_id or new.local_day <> old.local_day or new.created_at <> old.created_at then
    raise exception 'staff_digests: what was sent cannot be changed';
  end if;
  if old.status <> 'sending' then
    raise exception 'staff_digests: a finished record cannot be changed';
  end if;
  return new;
end;
$$;

create trigger staff_digests_guard
  before update or delete on public.staff_digests
  for each row execute function public.staff_digests_guard();

revoke all on function public.saved_answers_touch() from public;
revoke all on function public.saved_answer_events_append_only() from public;
revoke all on function public.staff_digests_guard() from public;

-- ===== 0021_data_checks.sql =====
-- The report facts a client chose to put in their letter.
--
-- The review shows, on each report item, what the report's own data shows
-- ("Equifax shows a balance of $1,250 and Experian shows $900 for the same
-- account"): the data checks in src/lib/domain/checks.ts. They are worked out
-- from the report, never stored, and never answer for the client.
--
-- When the client marks an item inaccurate and picks a reason one of those
-- checks relates to, they may tick "include in my letter what my data shows".
-- item_flags.check_ids records which checks they ticked it for. Ids only: the
-- sentence printed in the letter is worked out again from the report rows on
-- the server (rounds/plan.ts: itemDetailsFromRows), and /api/flags keeps an id
-- only when that check is on the item and relates to the reason picked.
--
-- Written by the client, like the rest of their answer (the "own flags"
-- policy); staff read it and cannot write it (no staff write policy exists on
-- item_flags). Empty for every answer saved before this change, and for every
-- answer where the client did not tick the box.

alter table public.item_flags
  add column check_ids text[] not null default '{}'
    check (
      cardinality(check_ids) <= 20
      and array_to_string(check_ids, '|') ~ '^([a-z_]{2,40}:[A-Za-z+]{1,120}:[0-9a-f.]{1,200}(\|[a-z_]{2,40}:[A-Za-z+]{1,120}:[0-9a-f.]{1,200})*)?$'
    );

comment on column public.item_flags.check_ids is
  'Data checks (src/lib/domain/checks.ts) whose facts the client chose to include in the letter for this item. Set only by the client.';

-- ===== 0022_self_healing.sql =====
-- Fixing things by themselves: addresses checked before mailing, a returned
-- letter re-mailed once, one shared list of companies whose dispute address
-- is missing, the client's one-tap address confirmation, and a record of what
-- the system resolved on its own (src/lib/mail/verify*.ts, returns*.ts,
-- gaps.ts; docs/AUTOPILOT.md "Lo que se arregla solo").
--
--   address_verifications   every check of an address against the post
--                           office's data (Lob's US verification), before a
--                           round is mailed or when a letter comes back: the
--                           lines checked, what came back, the standardized
--                           lines used, the provider and what it cost. Also
--                           the cache: an address checked in the last 30
--                           days is not paid for twice. Append-only.
--   address_confirmations   the client is asked, by the autopilot's channels,
--                           to confirm their own address with one tap
--                           ("Confirmar dirección"), prefilled with what the
--                           post office suggests. One open request per
--                           client; answered or closed once, never edited.
--   letters.remail_of       a returned letter sent again: a new letter row
--                           in the SAME round, pointing at the one that came
--                           back. At most once per letter (unique), never a
--                           re-mail of a re-mail, only of a letter that came
--                           back, same client, same round. Billing is per
--                           round (charges.round_id is unique since 0011), so
--                           a re-mail can never add a charge.
--   furnisher_gaps          one row per company whose dispute address is
--                           missing, shared by every client: when it was
--                           first seen missing, last seen, and resolved.
--   autopilot_resolutions   what the system resolved by itself ("Resuelto
--                           solo" on the staff home): an address corrected,
--                           confirmed by the client, a letter re-mailed, a
--                           payment fixed, a document uploaded again.
--                           Append-only, once per fact (dedupe_key).
--
-- Who writes: only the server, with the service role. Staff read by role
-- (the scopes of migration 0012); a client reads their own confirmations.

-- ── Address verifications ──────────────────────────────────────────────

create table public.address_verifications (
  id uuid primary key default gen_random_uuid(),
  -- The client the check was made for (their own address, or a letter of theirs). Null: a shared address (a company's).
  user_id uuid references auth.users (id) on delete cascade,
  subject text not null check (subject in ('client', 'bureau', 'furnisher')),
  -- A bureau key, a furnisher book id, or the client's id.
  subject_key text check (subject_key is null or char_length(subject_key) <= 120),
  -- The lines as given, and the key they are cached under (src/lib/mail/verify.ts: addressKey).
  input_lines text[] not null check (cardinality(input_lines) between 1 and 6),
  address_key text not null check (char_length(address_key) between 4 and 300),
  result text not null check (result in ('deliverable', 'corrected', 'undeliverable', 'ambiguous', 'unchecked')),
  -- Lob's own word (deliverable, deliverable_missing_unit…), or 'simulado' without a key.
  deliverability text check (deliverability is null or char_length(deliverability) <= 60),
  standardized_lines text[] not null default '{}' check (cardinality(standardized_lines) <= 6),
  provider text not null check (provider in ('lob', 'stub', 'cache')),
  cost_mills integer not null default 0 check (cost_mills between 0 and 100000),
  round_number integer check (round_number is null or round_number between 1 and 100),
  letter_id uuid references public.letters (id) on delete cascade,
  checked_at timestamptz not null default now(),
  constraint address_verifications_standardized check (result not in ('deliverable', 'corrected') or cardinality(standardized_lines) >= 2)
);

create index address_verifications_key_idx on public.address_verifications (address_key, checked_at desc);
create index address_verifications_user_idx on public.address_verifications (user_id, checked_at) where user_id is not null;

alter table public.address_verifications enable row level security;

create policy "staff read address verifications" on public.address_verifications
  for select using (
    (user_id is null and public.is_staff()) or (user_id is not null and public.staff_can_see_case(user_id))
  );

-- ── The client's confirmation of their own address ─────────────────────

create table public.address_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Why it was asked: the check before mailing, or a letter that came back.
  reason text not null check (reason in ('verification', 'returned_letter')),
  -- What the check said about the address on file ('undeliverable', 'ambiguous').
  finding text not null check (finding in ('undeliverable', 'ambiguous')),
  input_lines text[] not null check (cardinality(input_lines) between 1 and 6),
  -- What the post office suggests, when it suggests something. Shown prefilled; never used without the client.
  suggestion_lines text[] not null default '{}' check (cardinality(suggestion_lines) <= 6),
  letter_id uuid references public.letters (id) on delete set null,
  round_number integer check (round_number is null or round_number between 1 and 100),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_lines text[] check (confirmed_lines is null or cardinality(confirmed_lines) between 2 and 6),
  -- Closed without the client: a person settled it, or the address on file changed.
  closed_at timestamptz,
  closed_by_name text check (closed_by_name is null or char_length(closed_by_name) between 1 and 80),
  constraint address_confirmations_confirmed_pair check ((confirmed_at is null) = (confirmed_lines is null)),
  constraint address_confirmations_closed_pair check ((closed_at is null) = (closed_by_name is null)),
  constraint address_confirmations_one_end check (confirmed_at is null or closed_at is null)
);

-- One open request per client.
create unique index address_confirmations_open on public.address_confirmations (user_id)
  where confirmed_at is null and closed_at is null;

alter table public.address_confirmations enable row level security;

create policy "own address confirmations" on public.address_confirmations
  for select using (auth.uid() = user_id);

create policy "staff read address confirmations" on public.address_confirmations
  for select using (public.staff_can_see_case(user_id));

-- Answered or closed once; the request itself never changes.
create function public.address_confirmations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'address_confirmations: a request cannot be deleted';
    end if;
    return old;
  end if;
  if old.confirmed_at is not null or old.closed_at is not null then
    raise exception 'address_confirmations: an answered request cannot be changed';
  end if;
  if new.user_id <> old.user_id or new.reason <> old.reason or new.finding <> old.finding
     or new.input_lines <> old.input_lines or new.suggestion_lines <> old.suggestion_lines
     or new.letter_id is distinct from old.letter_id or new.round_number is distinct from old.round_number
     or new.requested_at <> old.requested_at then
    raise exception 'address_confirmations: only the answer can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.address_confirmations_guard() from public;

create trigger address_confirmations_guard
  before update or delete on public.address_confirmations
  for each row execute function public.address_confirmations_guard();

-- ── A returned letter, sent again once ─────────────────────────────────

alter table public.letters
  add column remail_of uuid references public.letters (id) on delete cascade;

-- At most one re-mail per letter.
create unique index letters_remail_once on public.letters (remail_of) where remail_of is not null;

create function public.letters_remail_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  original public.letters%rowtype;
begin
  if tg_op = 'UPDATE' and new.remail_of is not distinct from old.remail_of then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'letters: what a letter re-mails cannot be changed';
  end if;
  if new.remail_of is null then
    return new;
  end if;
  select * into original from public.letters where id = new.remail_of;
  if not found then
    raise exception 'letters: the letter to re-mail does not exist';
  end if;
  if original.user_id <> new.user_id or original.round_id <> new.round_id then
    raise exception 'letters: a re-mail belongs to the same client and the same round';
  end if;
  if original.remail_of is not null then
    raise exception 'letters: a re-mailed letter is not re-mailed again; a person decides';
  end if;
  if original.mail_status not in ('returned', 'undeliverable') then
    raise exception 'letters: only a letter that came back is re-mailed';
  end if;
  return new;
end;
$$;

revoke all on function public.letters_remail_guard() from public;

create trigger letters_remail_guard
  before insert or update on public.letters
  for each row execute function public.letters_remail_guard();

-- ── Companies whose dispute address is missing, for every client at once ─

create table public.furnisher_gaps (
  -- src/lib/mail/furnishers.ts: normalizeCompanyName.
  normalized_name text primary key check (char_length(normalized_name) between 1 and 120),
  company text not null check (char_length(btrim(company)) between 1 and 120),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- How many clients' rounds were waiting on it when last seen.
  waiting_clients integer not null default 1 check (waiting_clients >= 0),
  resolved_at timestamptz,
  constraint furnisher_gaps_seen_order check (last_seen_at >= first_seen_at)
);

alter table public.furnisher_gaps enable row level security;

create policy "staff read furnisher gaps" on public.furnisher_gaps
  for select using (public.is_staff());

-- When it was first seen missing never changes (the queue's clock counts from it).
create function public.furnisher_gaps_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'furnisher_gaps: a record cannot be deleted';
  end if;
  if new.normalized_name <> old.normalized_name or new.first_seen_at <> old.first_seen_at then
    raise exception 'furnisher_gaps: when a company was first seen missing cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.furnisher_gaps_guard() from public;

create trigger furnisher_gaps_guard
  before update or delete on public.furnisher_gaps
  for each row execute function public.furnisher_gaps_guard();

-- ── What the system resolved by itself ─────────────────────────────────

create table public.autopilot_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'address_corrected', 'address_confirmed', 'letter_remailed', 'payment_fixed', 'document_reuploaded', 'furnisher_matched'
  )),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 240),
  at timestamptz not null default now()
);

create index autopilot_resolutions_at_idx on public.autopilot_resolutions (at);

alter table public.autopilot_resolutions enable row level security;

create policy "staff read resolutions" on public.autopilot_resolutions
  for select using (
    (user_id is null and public.is_staff()) or (user_id is not null and public.staff_can_see_case(user_id))
  );

-- Records: never edited, deleted only with the account (the 0015 function, which reads user_id).
create trigger address_verifications_append_only
  before update or delete on public.address_verifications
  for each row execute function public.autopilot_append_only();

create trigger autopilot_resolutions_append_only
  before update or delete on public.autopilot_resolutions
  for each row execute function public.autopilot_append_only();

-- ===== 0023_partner_sharing.sql =====
-- Partner sharing: a client lets the partner who referred them (or one they
-- add by the partner's code) follow their progress. The client's choice, made
-- explicitly, revocable at any time, effective at once.
--
--   partner_share_consents    every grant, change and revocation, append-only,
--                             with the consent text's version and SHA-256 and
--                             the partner's name as it was shown. The CURRENT
--                             level is the newest row: there is no second copy
--                             that could disagree with the record.
--   partner_view_log          every time a partner opened a client's page
--                             (written by the database function that returns
--                             the page, so there is no read without a row).
--   partner_terms_acceptances the partner terms a partner accepted at sign-in.
--   partner_notices           milestone messages sent to a partner (dedupe).
--   partner_program_changes   "Comisiones a socios": the program-wide switch for
--                             referral fees, OFF until an administrator records
--                             the attorney's approval (append-only).
--   partners                  + logo (an image the partner sent, shown only once
--                             an administrator approved it) and the partner's
--                             notification choices.
--
-- The levels:
--   none      nothing beyond the coarse referral status of migration 0017;
--   progress  "Solo el avance": the client's name, stage, milestone dates, goal;
--   summary   "Avance y resumen": the above plus two counts (items disputed in
--             the current round; disputed items the latest report no longer lists).
--
-- What a partner can never read, at any level: scores, report items, creditor
-- names, account numbers, amounts, letters, documents, SSN or date of birth,
-- address, payments, chat, the client's answers or reasons. A partner has no
-- read policy on any table holding them; the two functions below return only
-- the columns listed, and only for a client whose newest record is not "none",
-- only while the partner is approved and has accepted the current terms.
--
-- Who writes: only the server (service role), after checking the request.
-- Nobody gets an insert, update or delete policy here.

-- ── Commissions, program-wide: OFF until the attorney clears them ───────
--
-- "Comisiones a socios". Until an administrator turns it on, confirming the
-- attorney approved paying referral fees (RESPA Section 8, Texas Finance Code
-- ch. 393), the program has no referral fees: no commission terms can be set
-- and no amount can be recorded, whatever the server code does (triggers
-- below), and the screens say so. Append-only; the newest row is the setting.

create table public.partner_program_changes (
  seq bigint generated always as identity primary key,
  commissions_enabled boolean not null,
  -- Turning it on is an approval: who at the attorney's office, which day, and the box ticked.
  attorney_name text check (attorney_name is null or char_length(btrim(attorney_name)) between 3 and 120),
  attorney_approved_on date,
  confirmed boolean not null default false,
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_name text not null default '' check (char_length(changed_by_name) <= 80),
  changed_at timestamptz not null default now(),
  constraint partner_program_on_needs_approval check (
    not commissions_enabled or (confirmed and attorney_name is not null and attorney_approved_on is not null)
  )
);

alter table public.partner_program_changes enable row level security;

create trigger partner_program_changes_append_only
  before update or delete on public.partner_program_changes
  for each row execute function public.partner_records_append_only();

-- Off unless the newest record turned it on. Public: the signup page and the
-- "Cómo funciona" page say whether the program pays referral fees.
create function public.partner_commissions_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.commissions_enabled from public.partner_program_changes c order by c.seq desc limit 1), false);
$$;

revoke all on function public.partner_commissions_enabled() from public;
grant execute on function public.partner_commissions_enabled() to anon, authenticated;

create policy "staff read partner program" on public.partner_program_changes
  for select using (public.staff_role() in ('admin', 'sales'));

-- While off: no amount is recorded...
create function public.partner_commissions_need_program()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.partner_commissions_enabled() then
    raise exception 'partner_commissions: commissions to partners are off (Comisiones a socios)';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_commissions_need_program() from public;

create trigger partner_commissions_need_program
  before insert on public.partner_commissions
  for each row execute function public.partner_commissions_need_program();

-- ...and no commission terms are set or changed (other changes to a partner still save).
create function public.partners_terms_need_program()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.commission_basis <> 'none'
    and (tg_op = 'INSERT' or new.commission_basis is distinct from old.commission_basis or new.commission_cents is distinct from old.commission_cents)
    and not public.partner_commissions_enabled() then
    raise exception 'partners: commissions to partners are off (Comisiones a socios)';
  end if;
  return new;
end;
$$;

revoke all on function public.partners_terms_need_program() from public;

create trigger partners_terms_need_program
  before insert or update on public.partners
  for each row execute function public.partners_terms_need_program();

-- ── Consent records ─────────────────────────────────────────────────────

create table public.partner_share_consents (
  -- An identity, so "newest" is exact even for two records in the same instant.
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete restrict,
  level text not null check (level in ('none', 'progress', 'summary')),
  -- Filled in by the trigger from the newest earlier record: never trusted from the caller.
  previous_level text not null default 'none' check (previous_level in ('none', 'progress', 'summary')),
  action text not null default 'grant' check (action in ('grant', 'change', 'revoke')),
  -- How the partner is connected to the client.
  how text not null check (how in ('referred', 'added_by_code')),
  -- What the client was shown (src/lib/partners/sharing.ts SHARING_CONSENT_VERSION and its hash).
  text_version text not null check (char_length(text_version) between 4 and 40),
  locale text not null check (locale in ('es', 'en')),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  partner_name_shown text not null check (char_length(partner_name_shown) between 2 and 210),
  created_at timestamptz not null default now()
);

create index partner_share_consents_pair_idx on public.partner_share_consents (user_id, partner_id, seq desc);
create index partner_share_consents_partner_idx on public.partner_share_consents (partner_id, user_id, seq desc);

alter table public.partner_share_consents enable row level security;

create function public.partner_share_consents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prior text;
  partner_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'partner_share_consents: a consent record cannot be changed or deleted';
  end if;
  select c.level into prior from public.partner_share_consents c
    where c.user_id = new.user_id and c.partner_id = new.partner_id
    order by c.seq desc limit 1;
  new.previous_level := coalesce(prior, 'none');
  if new.level = new.previous_level then
    raise exception 'partner_share_consents: the level is already %', new.level;
  end if;
  new.action := case
    when new.previous_level = 'none' then 'grant'
    when new.level = 'none' then 'revoke'
    else 'change'
  end;
  new.created_at := now();
  if new.level <> 'none' then
    select p.status into partner_status from public.partners p where p.id = new.partner_id;
    if partner_status is distinct from 'approved' then
      raise exception 'partner_share_consents: sharing can be granted only to an approved partner';
    end if;
  end if;
  -- "Referred" must be true: the partner on the client's profile (0017, server-written).
  if new.how = 'referred' and not exists (
    select 1 from public.profiles pr where pr.id = new.user_id and pr.referred_partner_id = new.partner_id
  ) then
    raise exception 'partner_share_consents: this partner did not refer this client';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_share_consents_guard() from public;

create trigger partner_share_consents_guard
  before insert or update or delete on public.partner_share_consents
  for each row execute function public.partner_share_consents_guard();

-- ── Views of a client's page ────────────────────────────────────────────

create table public.partner_view_log (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- The partner's sign-in that looked.
  viewer uuid references auth.users (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create index partner_view_log_user_idx on public.partner_view_log (user_id, viewed_at desc);
create index partner_view_log_partner_idx on public.partner_view_log (partner_id, viewed_at desc);

alter table public.partner_view_log enable row level security;

create trigger partner_view_log_append_only
  before update or delete on public.partner_view_log
  for each row execute function public.partner_records_append_only();

-- ── Partner terms ───────────────────────────────────────────────────────

create table public.partner_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  version text not null check (char_length(version) between 4 and 40),
  locale text not null check (locale in ('es', 'en')),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now()
);

create index partner_terms_acceptances_partner_idx on public.partner_terms_acceptances (partner_id, accepted_at desc);

alter table public.partner_terms_acceptances enable row level security;

create trigger partner_terms_acceptances_append_only
  before update or delete on public.partner_terms_acceptances
  for each row execute function public.partner_records_append_only();

-- The version a partner must have accepted to see any client. The same value
-- as PARTNER_CLIENT_TERMS_VERSION in src/lib/partners/terms.ts (a test checks).
create function public.partner_terms_current()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-11-socios-terminos-v1'::text;
$$;

-- Has the signed-in partner accepted the current terms?
create function public.partner_terms_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_terms_acceptances t
    where t.partner_id = public.partner_id() and t.version = public.partner_terms_current()
  );
$$;

-- ── Logo and notifications ──────────────────────────────────────────────

alter table public.partners
  -- A small image (PNG, JPEG or WebP), as a data URL. Shown to referred clients only once approved.
  add column logo_data text check (
    logo_data is null or (octet_length(logo_data) <= 200000 and logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$')
  ),
  add column logo_status text not null default 'none' check (logo_status in ('none', 'pending', 'approved', 'rejected')),
  add column logo_decided_at timestamptz,
  add column logo_decided_by uuid references auth.users (id) on delete set null,
  -- The partner chose to be told of their clients' milestones (never SMS).
  add column notify_email boolean not null default false,
  add column notify_whatsapp boolean not null default false,
  add constraint partners_logo_pair check ((logo_status = 'none') = (logo_data is null));

create table public.partner_notices (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "<partner>:<client>:<milestone>": each milestone of each client once per partner.
  dedupe_key text not null unique check (char_length(dedupe_key) between 10 and 200),
  milestone text not null check (char_length(milestone) between 3 and 60),
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  note text check (note is null or char_length(note) <= 200)
);

create index partner_notices_partner_idx on public.partner_notices (partner_id, created_at desc);

alter table public.partner_notices enable row level security;

create function public.partner_notices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'partner_notices: a notice is never deleted';
  end if;
  if new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.user_id is distinct from old.user_id
    or new.dedupe_key is distinct from old.dedupe_key or new.milestone is distinct from old.milestone
    or new.channel is distinct from old.channel or new.created_at is distinct from old.created_at
    or old.status <> 'sending' then
    raise exception 'partner_notices: only the delivery of a notice being sent can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_notices_guard() from public;

create trigger partner_notices_guard
  before update or delete on public.partner_notices
  for each row execute function public.partner_notices_guard();

-- ── What a partner may see of a consenting client ───────────────────────

-- The newest consent record of each client for a partner, its level, and the
-- limited progress columns. INTERNAL: not granted to anyone; the server's
-- service role calls it for notifications. A signed-in caller (if a platform
-- default ever granted it) gets only what partner_clients() would give them.
create function public.partner_progress_rows(p_partner uuid, p_client uuid)
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (c.user_id) c.user_id, c.level, c.how, c.seq
    from public.partner_share_consents c
    where c.partner_id = p_partner and (p_client is null or c.user_id = p_client)
      and (auth.uid() is null or (p_partner = public.partner_id() and public.partner_terms_ok()))
    order by c.user_id, c.seq desc
  ),
  sharing as (
    select l.*,
      (select min(c2.created_at) from public.partner_share_consents c2
        where c2.user_id = l.user_id and c2.partner_id = p_partner
          and c2.seq > coalesce((select max(c3.seq) from public.partner_share_consents c3
                                 where c3.user_id = l.user_id and c3.partner_id = p_partner and c3.level = 'none'), 0)
      ) as since
    from latest l
    join public.partners p on p.id = p_partner and p.status = 'approved'
    where l.level <> 'none'
  )
  select
    s.user_id,
    btrim(pr.full_name),
    s.level,
    s.how,
    s.since,
    case when pr.goal in ('mortgage', 'auto', 'card', 'general') then pr.goal else null end,
    a.signed_at,
    case when a.signed_at is not null and a.cancelled_at is null then a.cancellation_deadline else null end,
    coalesce(a.cancelled_at, a.service_end_requested_at),
    (select max(d.first_at) from (
        select min(i.uploaded_at) as first_at from public.identity_documents i
        where i.user_id = s.user_id and i.kind in ('government_id', 'proof_of_address') group by i.kind
      ) d having count(*) = 2),
    (select case when count(*) > 0 and count(f.item_id) = count(*) then max(coalesce(f.attested_at, f.created_at)) else null end
       from public.report_items ri
       left join lateral (
         select fl.item_id, fl.attested_at, fl.created_at from public.item_flags fl
         where fl.item_id = ri.id order by fl.created_at desc limit 1
       ) f on true
       where ri.user_id = s.user_id and ri.status = 'active'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', r.round_number,
        'mailed_at', r.mailed_at,
        'answer_due_at', w.window_start + interval '30 days',
        'next_round_at', r.mailed_at + interval '40 days'
      ) order by r.round_number)
      from public.attack_rounds r
      cross join lateral (
        select greatest(r.mailed_at, coalesce(max(lt.delivered_at) filter (
          where lt.mail_class in ('certified', 'certified_return_receipt') and lt.mail_status = 'delivered'
        ), r.mailed_at)) as window_start
        from public.letters lt where lt.round_id = r.id
      ) w
      where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
    ), '[]'::jsonb),
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      where lt.round_id = (
        select r.id from public.attack_rounds r
        where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
        order by r.round_number desc limit 1
      )
    ) else null end,
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      join public.attack_rounds r on r.id = lt.round_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
      join public.report_items ri on ri.id = li.item_id
      where lt.user_id = s.user_id and ri.status = 'deleted'
    ) else null end
  from sharing s
  join public.profiles pr on pr.id = s.user_id
  left join lateral (
    select sa.signed_at, sa.cancellation_deadline, sa.cancelled_at, sa.service_end_requested_at
    from public.service_agreements sa where sa.user_id = s.user_id
    order by sa.created_at desc limit 1
  ) a on true
  order by s.since desc;
$$;

-- The signed-in partner's consenting clients, for "Mis clientes". Nothing for
-- a partner who is not approved or has not accepted the current terms.
create function public.partner_clients()
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.partner_progress_rows(public.partner_id(), null) r
  where public.partner_id() is not null and public.partner_terms_ok();
$$;

-- One client's page for the signed-in partner. Writes the view to the log in
-- the same statement: a page that is returned is a page that is logged.
create function public.partner_client_view(p_client uuid)
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  pid uuid := public.partner_id();
begin
  if pid is null or p_client is null or not public.partner_terms_ok() then
    return;
  end if;
  if exists (select 1 from public.partner_progress_rows(pid, p_client)) then
    insert into public.partner_view_log (partner_id, viewer, user_id) values (pid, auth.uid(), p_client);
    return query select * from public.partner_progress_rows(pid, p_client);
  end if;
end;
$$;

-- ── What a client sees about partners ───────────────────────────────────

-- The partners connected to the signed-in client: the one who referred them,
-- and any they added. Public facts only (name, company, kind, approved logo),
-- and the client's current choice for each.
create function public.client_sharing()
returns table (
  partner_id uuid,
  name text,
  company text,
  kind text,
  status text,
  referred boolean,
  level text,
  how text,
  changed_at timestamptz,
  logo_data text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
  linked as (
    select pr.referred_partner_id as pid from public.profiles pr, me where pr.id = me.uid and pr.referred_partner_id is not null
    union
    select c.partner_id from public.partner_share_consents c, me where c.user_id = me.uid
  )
  select p.id, p.name, p.company, p.kind, p.status,
    exists (select 1 from public.profiles pr, me where pr.id = me.uid and pr.referred_partner_id = p.id),
    coalesce(c.level, 'none'), c.how, c.created_at,
    case when p.logo_status = 'approved' then p.logo_data else null end
  from linked x
  join public.partners p on p.id = x.pid
  left join lateral (
    select c.level, c.how, c.created_at from public.partner_share_consents c, me
    where c.user_id = me.uid and c.partner_id = p.id order by c.seq desc limit 1
  ) c on true
  where (select uid from me) is not null
  order by p.name;
$$;

-- An approved partner's public face, by code: for the referred client's
-- welcome, the "Cómo funciona" page and adding a partner by code.
create function public.partner_public(p_code text)
returns table (partner_id uuid, name text, company text, kind text, logo_data text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.company, p.kind, case when p.logo_status = 'approved' then p.logo_data else null end
  from public.partners p
  where p.status = 'approved' and p.referral_code = lower(p_code);
$$;

revoke all on function public.partner_progress_rows(uuid, uuid) from public, anon, authenticated;
revoke all on function public.partner_terms_current() from public, anon;
revoke all on function public.partner_terms_ok() from public, anon;
revoke all on function public.partner_clients() from public, anon;
revoke all on function public.partner_client_view(uuid) from public, anon;
revoke all on function public.client_sharing() from public, anon;
revoke all on function public.partner_public(text) from public;
grant execute on function public.partner_terms_current() to authenticated;
grant execute on function public.partner_terms_ok() to authenticated;
grant execute on function public.partner_clients() to authenticated;
grant execute on function public.partner_client_view(uuid) to authenticated;
grant execute on function public.client_sharing() to authenticated;
grant execute on function public.partner_public(text) to anon, authenticated;

-- ── Read policies ───────────────────────────────────────────────────────

create policy "own share consents read" on public.partner_share_consents
  for select using (auth.uid() = user_id);

create policy "staff read share consents" on public.partner_share_consents
  for select using (public.staff_role() in ('admin', 'sales'));

create policy "own partner views read" on public.partner_view_log
  for select using (auth.uid() = user_id);

create policy "admin read partner views" on public.partner_view_log
  for select using (public.staff_role() = 'admin');

create policy "partner reads own terms acceptances" on public.partner_terms_acceptances
  for select using (partner_id = public.partner_id());

create policy "admin read partner terms acceptances" on public.partner_terms_acceptances
  for select using (public.staff_role() = 'admin');

create policy "admin read partner notices" on public.partner_notices
  for select using (public.staff_role() = 'admin');

-- ===== 0024_english_default.sql =====
-- English first (November 2026). The owner's decision: the app is in English
-- first, then Spanish if needed. A client or visitor with no saved choice
-- starts in English (or in Spanish when their browser prefers Spanish, or a
-- salesperson's link says so: src/lib/i18n/detect.ts), and the language they
-- use is saved on their profile, which is what their automatic messages go
-- out in.
--
-- Only the DEFAULTS change, for rows created from now on. No existing row is
-- rewritten: a client whose profile says 'es' keeps Spanish, which is what
-- they have had so far.
--
--   profiles.locale           the client's language (app and messages)
--   outbound_messages.locale  an automatic message's language (always written
--                             explicitly by the server; the default is a fallback)
--   client_pulses.locale      the language a satisfaction answer was given in
--   waitlist.locale           the language of a waiting-list signup
--   partners.locale           NEW: the language a referral partner reads their
--                             portal in, which their milestone notices go out
--                             in. Partners who applied before this keep
--                             Spanish (every notice so far was Spanish); new
--                             ones start in English.

alter table public.profiles alter column locale set default 'en';
alter table public.outbound_messages alter column locale set default 'en';
alter table public.client_pulses alter column locale set default 'en';
alter table public.waitlist alter column locale set default 'en';

alter table public.partners add column locale text not null default 'es' check (locale in ('es', 'en'));
alter table public.partners alter column locale set default 'en';

-- ===== 0025_staff_locale.sql =====
-- The staff console in two languages (docs/STAFF.md, "Language").
--
--   staff_preferences.locale   the language the console speaks to this member:
--                              'en' or 'es', chosen on /equipo/perfil or from
--                              the menu under their initial. Null until they
--                              choose; the console then follows their browser,
--                              else English. Written by the server only
--                              (POST /api/staff/preferences), like the rest of
--                              the row; read by the member.
--   saved_answers.language     the language a saved answer is written in. An
--                              answer goes to a client in the client's
--                              language, never the staff member's: the console
--                              suggests only answers in the client's language.
--                              Every answer saved before this migration was
--                              written in Spanish.
--   saved_answer_events.language  the same, kept with each recorded change.

alter table public.staff_preferences
  add column locale text check (locale is null or locale in ('en', 'es'));

alter table public.saved_answers
  add column language text not null default 'es' check (language in ('en', 'es'));

alter table public.saved_answer_events
  add column language text check (language is null or language in ('en', 'es'));

-- ===== 0026_billing_plans.sql =====
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

-- ===== 0027_cards_households.sql =====
-- Accepted card brands, and household signup (Credit Repair Cloud added both
-- in November 2026).
--
--   billing_card_settings  Which card brands the business takes: one row.
--                          Visa and Mastercard on, American Express and
--                          Discover off by default (many merchant accounts
--                          that take credit repair refuse them). At least one
--                          stays on. Read by staff; written by the server for
--                          an administrator. The payment-method route refuses
--                          to put a card of a brand that is off on file
--                          (src/lib/billing/cardBrands.ts). Cards already on
--                          file keep working.
--
--   household_members      A household member added on the invite (staff) or
--                          in the client's onboarding: a person of their own,
--                          a prospect (source 'household') with their own
--                          invitation, and later their own login, agreement and
--                          disputes. The row only links the two people. When
--                          both have accounts, the link becomes a
--                          household_links row (migration 0026) by itself, the
--                          link the plan's household discount reads.
--
-- What a household never does: share data. Every case table keeps its
-- owner-only read policy (a client reads their own rows, nobody else's); a
-- household member has no policy that reaches the other's report, answers,
-- letters, agreement, documents or money, and clients read no row here at
-- all. Staff read households by role, like the people in them. Pausing,
-- cancelling and billing stay per person.

-- ── Accepted card brands ────────────────────────────────────────────────

create table public.billing_card_settings (
  id boolean primary key default true check (id),
  visa boolean not null default true,
  mastercard boolean not null default true,
  amex boolean not null default false,
  discover boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text not null default '' check (char_length(updated_by_name) <= 80),
  constraint billing_card_settings_one_on check (visa or mastercard or amex or discover)
);

insert into public.billing_card_settings (id) values (true);

alter table public.billing_card_settings enable row level security;
create policy "staff read card settings" on public.billing_card_settings for select using (public.is_staff());

create function public.billing_card_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'billing_card_settings: the setting is kept; change it instead';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger billing_card_settings_guard
  before update or delete on public.billing_card_settings
  for each row execute function public.billing_card_settings_guard();

-- ── Household members ───────────────────────────────────────────────────

-- A household member is a prospect like any other, with 'household' as where they came from.
alter table public.prospects drop constraint prospects_source_check;
alter table public.prospects add constraint prospects_source_check check (source in ('manual', 'highlevel', 'partner', 'household'));
-- A household member added by a client who came without a salesperson has none.
alter table public.prospects alter column salesperson drop not null;
alter table public.prospects add constraint prospects_salesperson_present check (salesperson is not null or source = 'household');
-- The language their invitation and app go in.
alter table public.prospects add column locale text check (locale is null or locale in ('en', 'es'));

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  -- The person who added them: a client with an account, or a prospect.
  primary_user_id uuid references auth.users (id) on delete cascade,
  primary_prospect_id uuid references public.prospects (id) on delete cascade,
  -- The household member: always a prospect first (their own invitation).
  member_prospect_id uuid not null references public.prospects (id) on delete cascade,
  -- Names as they were given, so each side can be shown without reading the other's record.
  primary_name text not null check (char_length(primary_name) between 1 and 80),
  member_name text not null check (char_length(member_name) between 2 and 80),
  relationship text not null check (relationship in ('spouse', 'partner', 'family')),
  added_by text not null check (added_by in ('staff', 'client')),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  -- Set when both have accounts and the household link exists.
  link_id uuid references public.household_links (id) on delete restrict,
  ended_at timestamptz,
  constraint household_members_one_primary check (num_nonnulls(primary_user_id, primary_prospect_id) = 1),
  constraint household_members_not_self check (primary_prospect_id is null or primary_prospect_id <> member_prospect_id)
);

-- A person is added as a household member once, and a household is two people.
create unique index household_members_member_once on public.household_members (member_prospect_id);
create unique index household_members_open_user on public.household_members (primary_user_id) where ended_at is null and primary_user_id is not null;
create unique index household_members_open_prospect on public.household_members (primary_prospect_id) where ended_at is null and primary_prospect_id is not null;

alter table public.household_members enable row level security;

-- Staff by role: the people in it decide. A member of staff who may see
-- either person (as a client or as a prospect) sees the household row, and
-- nothing more of the other person than this row says.
create function public.staff_can_see_household(primary_user uuid, primary_prospect uuid, member_prospect uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_role() = 'admin'
    or (primary_user is not null and public.staff_can_see_client(primary_user))
    or exists (
      select 1 from public.prospects p
       where p.id in (primary_prospect, member_prospect)
         and (
           (p.converted_user_id is not null and public.staff_can_see_client(p.converted_user_id))
           or (public.staff_role() = 'specialist' and p.assigned_to = auth.uid())
           or (public.staff_role() = 'sales' and p.salesperson = public.staff_handle())
         )
    );
$$;

create policy "staff read household members" on public.household_members
  for select using (public.staff_can_see_household(primary_user_id, primary_prospect_id, member_prospect_id));

-- Rows are a record: only ending one, or recording its link, changes it.
create function public.household_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'household_members: a household is a record; end it instead';
  end if;
  if new.primary_user_id is distinct from old.primary_user_id or new.primary_prospect_id is distinct from old.primary_prospect_id
     or new.member_prospect_id <> old.member_prospect_id or new.relationship <> old.relationship or new.created_at <> old.created_at
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.link_id is not null and new.link_id is distinct from old.link_id) then
    raise exception 'household_members: only the end and the link can be recorded';
  end if;
  return new;
end;
$$;

create trigger household_members_guard
  before update or delete on public.household_members
  for each row execute function public.household_members_guard();

-- When both people of an open household have accounts, link them for the
-- household discount (household_links, one household at a time). Runs when a
-- prospect becomes a client and when a household row is added.
create function public.household_try_link(household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.household_members%rowtype;
  a uuid;
  b uuid;
  lid uuid;
begin
  select * into h from public.household_members where id = household;
  if not found or h.ended_at is not null or h.link_id is not null then
    return;
  end if;
  a := coalesce(h.primary_user_id, (select p.converted_user_id from public.prospects p where p.id = h.primary_prospect_id));
  b := (select p.converted_user_id from public.prospects p where p.id = h.member_prospect_id);
  if a is null or b is null or a = b then
    return;
  end if;
  if public.household_partner(a) is not null or public.household_partner(b) is not null then
    return;
  end if;
  insert into public.household_links (user_a, user_b, created_by, created_by_name)
    values (least(a, b), greatest(a, b), h.created_by, 'Household signup')
    returning id into lid;
  update public.household_members set link_id = lid where id = h.id;
end;
$$;

create function public.household_members_link_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.household_try_link(new.id);
  return new;
end;
$$;

create trigger household_members_link_on_insert
  after insert on public.household_members
  for each row execute function public.household_members_link_on_insert();

create function public.household_members_link_on_convert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h record;
begin
  if new.converted_user_id is null or new.converted_user_id is not distinct from old.converted_user_id then
    return new;
  end if;
  for h in
    select id from public.household_members
     where ended_at is null and link_id is null and (member_prospect_id = new.id or primary_prospect_id = new.id)
  loop
    perform public.household_try_link(h.id);
  end loop;
  return new;
end;
$$;

create trigger household_members_link_on_convert
  after update of converted_user_id on public.prospects
  for each row execute function public.household_members_link_on_convert();

-- Whether the plan's household discount goes in this person's agreement: they
-- are linked to another client (household_links), or they are in an open
-- household from the signup flow (as the one who added a member, or as the
-- member). The first of the two to sign does not lose it waiting for the
-- second. Called by the server with the service role; a client calling it
-- reads nothing (no policy here or on household_links lets them), so it
-- answers false and tells them nothing about anyone.
create function public.household_discount_applies(uid uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.household_partner(uid) is not null
      or exists (
        select 1
          from public.household_members h
          left join public.prospects pp on pp.id = h.primary_prospect_id
          join public.prospects mp on mp.id = h.member_prospect_id
         where h.ended_at is null
           and (h.primary_user_id = uid or pp.converted_user_id = uid or mp.converted_user_id = uid)
      );
$$;

-- The team's record of who added a household member (team_audit, append-only).
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded',
  -- Added here; this list replaces the whole constraint.
  'household_member_added', 'card_brands_changed'
));

-- ===== 0028_round_timing.sql =====
-- When the next round is due: from the evidence, not a fixed 40 days
-- (src/lib/rounds/timing.ts, nextRoundDue; docs/AUTOPILOT.md).
--
--   round_next_due(round, mailed_at)  The rule in SQL, the same as the
--        TypeScript one (a PGlite test runs both on the same rows):
--          receipt   per letter that reached someone (not returned or
--                    undeliverable): a certified letter's delivery scan; else
--                    its mailing date + 5 days (a First-Class "delivered" is an
--                    estimate and may only move the date later). The round's
--                    receipt is the latest.
--          window    receipt + 30 days (FCRA § 611(a)(1)(A)): never earlier.
--          due       window + 5 days (the bureau's mailed answer, the report's
--                    refresh), at most mailing + 45 days, unless the window
--                    itself ends later.
--
--   attack_rounds.next_round_due_at  Kept equal to it by triggers: when a
--        round is recorded as mailed (any path: the send, the printed batch),
--        and when one of its letters gets a delivery scan, comes back, or is
--        mailed again. The hourly re-pull (/api/cron/rounds) reads it, as it
--        always did. Rounds already mailed are recomputed below.
--
--   partner_progress_rows  The partner's "next round" date now uses the rule
--        (it was mailed_at + 40 days). Nothing else in the function changed.

create function public.round_next_due(p_round uuid, p_mailed_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with l as (
    select
      case
        when lt.mail_class in ('certified', 'certified_return_receipt') and lt.delivered_at is not null
          then greatest(lt.delivered_at, coalesce(lt.mailed_at, p_mailed_at))
        else greatest(coalesce(lt.mailed_at, p_mailed_at) + interval '5 days', coalesce(lt.delivered_at, '-infinity'::timestamptz))
      end as receipt
    from public.letters lt
    where lt.round_id = p_round and lt.mail_status not in ('returned', 'undeliverable')
  ),
  w as (
    select coalesce(max(l.receipt), p_mailed_at + interval '5 days') + interval '30 days' as window_end from l
  )
  select case
    when p_mailed_at is null then null
    else greatest(w.window_end, least(w.window_end + interval '5 days', p_mailed_at + interval '45 days'))
  end
  from w;
$$;

revoke all on function public.round_next_due(uuid, timestamptz) from public, anon;
grant execute on function public.round_next_due(uuid, timestamptz) to authenticated;

-- A round recorded as mailed (or its mailing date corrected): its date from the rule.
create function public.attack_rounds_next_due()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'mailed' and new.mailed_at is not null
     and (tg_op = 'INSERT' or old.mailed_at is distinct from new.mailed_at or old.status is distinct from new.status) then
    new.next_round_due_at := public.round_next_due(new.id, new.mailed_at);
  end if;
  return new;
end;
$$;

revoke all on function public.attack_rounds_next_due() from public;

create trigger attack_rounds_next_due
  before insert or update on public.attack_rounds
  for each row execute function public.attack_rounds_next_due();

-- A letter's delivery, return or re-mail moves its round's date.
create function public.letters_round_next_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or old.delivered_at is distinct from new.delivered_at
     or old.mail_status is distinct from new.mail_status
     or old.mailed_at is distinct from new.mailed_at
     or old.mail_class is distinct from new.mail_class then
    update public.attack_rounds r
       set next_round_due_at = public.round_next_due(r.id, r.mailed_at)
     where r.id = new.round_id and r.status = 'mailed' and r.mailed_at is not null;
  end if;
  return null;
end;
$$;

revoke all on function public.letters_round_next_due() from public;

create trigger letters_round_next_due
  after insert or update on public.letters
  for each row execute function public.letters_round_next_due();

-- Rounds already out: recomputed once (they were stored as mailed_at + 40 days).
update public.attack_rounds r
   set next_round_due_at = public.round_next_due(r.id, r.mailed_at)
 where r.status = 'mailed' and r.mailed_at is not null;

comment on column public.attack_rounds.next_round_due_at is
  'When the report is pulled again and the next round prepared: public.round_next_due (src/lib/rounds/timing.ts). Kept by triggers.';

-- ── The partner view: the same rule ─────────────────────────────────────

create or replace function public.partner_progress_rows(p_partner uuid, p_client uuid)
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (c.user_id) c.user_id, c.level, c.how, c.seq
    from public.partner_share_consents c
    where c.partner_id = p_partner and (p_client is null or c.user_id = p_client)
      and (auth.uid() is null or (p_partner = public.partner_id() and public.partner_terms_ok()))
    order by c.user_id, c.seq desc
  ),
  sharing as (
    select l.*,
      (select min(c2.created_at) from public.partner_share_consents c2
        where c2.user_id = l.user_id and c2.partner_id = p_partner
          and c2.seq > coalesce((select max(c3.seq) from public.partner_share_consents c3
                                 where c3.user_id = l.user_id and c3.partner_id = p_partner and c3.level = 'none'), 0)
      ) as since
    from latest l
    join public.partners p on p.id = p_partner and p.status = 'approved'
    where l.level <> 'none'
  )
  select
    s.user_id,
    btrim(pr.full_name),
    s.level,
    s.how,
    s.since,
    case when pr.goal in ('mortgage', 'auto', 'card', 'general') then pr.goal else null end,
    a.signed_at,
    case when a.signed_at is not null and a.cancelled_at is null then a.cancellation_deadline else null end,
    coalesce(a.cancelled_at, a.service_end_requested_at),
    (select max(d.first_at) from (
        select min(i.uploaded_at) as first_at from public.identity_documents i
        where i.user_id = s.user_id and i.kind in ('government_id', 'proof_of_address') group by i.kind
      ) d having count(*) = 2),
    (select case when count(*) > 0 and count(f.item_id) = count(*) then max(coalesce(f.attested_at, f.created_at)) else null end
       from public.report_items ri
       left join lateral (
         select fl.item_id, fl.attested_at, fl.created_at from public.item_flags fl
         where fl.item_id = ri.id order by fl.created_at desc limit 1
       ) f on true
       where ri.user_id = s.user_id and ri.status = 'active'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', r.round_number,
        'mailed_at', r.mailed_at,
        'answer_due_at', w.window_start + interval '30 days',
        'next_round_at', public.round_next_due(r.id, r.mailed_at)
      ) order by r.round_number)
      from public.attack_rounds r
      cross join lateral (
        select greatest(r.mailed_at, coalesce(max(lt.delivered_at) filter (
          where lt.mail_class in ('certified', 'certified_return_receipt') and lt.mail_status = 'delivered'
        ), r.mailed_at)) as window_start
        from public.letters lt where lt.round_id = r.id
      ) w
      where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
    ), '[]'::jsonb),
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      where lt.round_id = (
        select r.id from public.attack_rounds r
        where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
        order by r.round_number desc limit 1
      )
    ) else null end,
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      join public.attack_rounds r on r.id = lt.round_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
      join public.report_items ri on ri.id = li.item_id
      where lt.user_id = s.user_id and ri.status = 'deleted'
    ) else null end
  from sharing s
  join public.profiles pr on pr.id = s.user_id
  left join lateral (
    select sa.signed_at, sa.cancellation_deadline, sa.cancelled_at, sa.service_end_requested_at
    from public.service_agreements sa where sa.user_id = s.user_id
    order by sa.created_at desc limit 1
  ) a on true
  order by s.since desc;
$$;

-- ===== 0029_reviews.sql =====
-- The review engine (src/lib/reviews, docs/REVIEWS.md): asking every client,
-- once, to leave a public review on the sites the owner configures, and the
-- team's view of it.
--
--   review_settings   One row. Asking by WhatsApp / email at the milestones
--                     starts OFF; an administrator turns it on (/equipo/resenas).
--                     Each milestone can be turned off; that only moves the
--                     ask to the next milestone, it never excludes anyone.
--   review_platforms  Google Business Profile, Trustpilot, BBB: the link a
--                     client writes the review at (https, on the platform's
--                     own host: checked by the server and here), on or off,
--                     and the rating a person typed in from the platform's own
--                     page (we do not read their APIs), with who and when.
--   review_requests   One row per client, ever (unique user_id): the milestone
--                     and the channel ('whatsapp_or_email': the outbound
--                     message, under the autopilot's rules; 'in_app': the
--                     links shown after the pulse). Append-only. It records
--                     NO sentiment: who is asked never depends on how they
--                     feel (no review gating), so there is nothing to keep.
--
-- What is deliberately missing: any per-client "do not ask" flag, any
-- incentive or reward column, any link between a review and the referral
-- credit (migration 0026). Written only by the server (service role) after
-- the caller's role is checked; staff read.

create table public.review_settings (
  id boolean primary key default true check (id),
  requests_enabled boolean not null default false,
  -- {"first_results": true, ...}: a missing key is on.
  milestones jsonb not null default '{}' check (jsonb_typeof(milestones) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80)
);

insert into public.review_settings (id) values (true);

create table public.review_platforms (
  key text primary key check (key in ('google', 'trustpilot', 'bbb')),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  enabled boolean not null default false,
  rating numeric(2, 1) check (rating is null or (rating >= 1 and rating <= 5)),
  review_count integer check (review_count is null or review_count >= 0),
  rating_updated_at timestamptz,
  rating_updated_by_name text check (rating_updated_by_name is null or char_length(rating_updated_by_name) between 1 and 80),
  updated_at timestamptz not null default now(),
  constraint review_platforms_enabled_needs_url check (not enabled or url is not null),
  constraint review_platforms_host check (
    url is null
    or (key = 'google' and url ~* '^https://([a-z0-9-]+\.)*(g\.page|google\.com|goo\.gl)(/|$)')
    or (key = 'trustpilot' and url ~* '^https://([a-z0-9-]+\.)*trustpilot\.com(/|$)')
    or (key = 'bbb' and url ~* '^https://([a-z0-9-]+\.)*bbb\.org(/|$)')
  )
);

insert into public.review_platforms (key) values ('google'), ('trustpilot'), ('bbb');

create table public.review_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  milestone text not null check (milestone in ('pulse_answered', 'first_results', 'referral_signed', 'program_finished')),
  channel text not null check (channel in ('whatsapp_or_email', 'in_app')),
  created_at timestamptz not null default now()
);

alter table public.review_settings enable row level security;
alter table public.review_platforms enable row level security;
alter table public.review_requests enable row level security;

create policy "staff read review settings" on public.review_settings for select using (public.is_staff());
create policy "staff read review platforms" on public.review_platforms for select using (public.is_staff());
create policy "staff read review requests" on public.review_requests for select using (public.staff_can_see_client(user_id));

create function public.review_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '%: the setting is kept; change it instead', tg_table_name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.review_settings_guard() from public;

create trigger review_settings_guard
  before update or delete on public.review_settings
  for each row execute function public.review_settings_guard();

create trigger review_platforms_guard
  before update or delete on public.review_platforms
  for each row execute function public.review_settings_guard();

-- A request is a record: never changed, deleted only with the account.
create function public.review_requests_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'review_requests: a record cannot be changed';
  end if;
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'review_requests: a record cannot be deleted';
  end if;
  return old;
end;
$$;

revoke all on function public.review_requests_append_only() from public;

create trigger review_requests_append_only
  before update or delete on public.review_requests
  for each row execute function public.review_requests_append_only();

-- Who changed the review settings (team_audit, append-only).
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded',
  'household_member_added', 'card_brands_changed',
  -- Added here; this list replaces the whole constraint.
  'reviews_changed'
));

-- ===== 0030_state_openings.sql =====
-- Which states Credalti sells in (src/lib/compliance/states.ts, stateRules.ts;
-- docs/STATES.md).
--
--   state_openings  One row per state an administrator has decided about:
--                   opened or not, and for an opened state the attorney who
--                   reviewed it and the date, the state registration or
--                   license reference, and that the bond is in force (the
--                   server asks for the last two only where the state's law
--                   does). Texas, the launch state, starts opened (Phase 0);
--                   every other state starts closed: a missing row is closed.
--                   Read by staff; written by the server for an
--                   administrator ("states.manage"), each change in the
--                   team's audit. Leads, invitations and signups from a state
--                   not opened are refused politely or put on the waitlist.
--
--   waitlist        Takes a phone instead of an email (a HighLevel lead from
--                   a closed state may have no email) and says where it came
--                   from.
--
--   webhook_receipts  A HighLevel lead from a closed state is recorded as
--                   'waitlisted', not made a prospect.

create table public.state_openings (
  state text primary key check (state ~ '^[A-Z]{2}$'),
  opened boolean not null default false,
  attorney_name text check (attorney_name is null or char_length(attorney_name) between 3 and 120),
  attorney_reviewed_on date,
  registration_ref text check (registration_ref is null or char_length(registration_ref) between 2 and 120),
  bond_confirmed boolean not null default false,
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80),
  -- An opened state carries the attorney's review (Texas, the launch state, is gated by the agreement's own approval).
  constraint state_openings_open_reviewed check (not opened or state = 'TX' or (attorney_name is not null and attorney_reviewed_on is not null)),
  -- Georgia's statute makes operating a credit repair services organization a misdemeanor (O.C.G.A. § 16-9-59).
  constraint state_openings_not_restricted check (not opened or state <> 'GA')
);

insert into public.state_openings (state, opened, note) values ('TX', true, 'Launch state (Phase 0).');

alter table public.state_openings enable row level security;
create policy "staff read state openings" on public.state_openings for select using (public.is_staff());

create trigger state_openings_guard
  before update or delete on public.state_openings
  for each row execute function public.review_settings_guard();

-- The waitlist: a phone instead of an email, and where it came from.
alter table public.waitlist alter column email drop not null;
alter table public.waitlist
  add column phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  add column source text not null default 'web' check (source in ('web', 'highlevel', 'invite', 'partner')),
  add constraint waitlist_reachable check (email is not null or phone_e164 is not null);

alter table public.webhook_receipts drop constraint webhook_receipts_outcome_check;
alter table public.webhook_receipts add constraint webhook_receipts_outcome_check
  check (outcome in ('created', 'updated', 'existing_client', 'rejected', 'waitlisted'));

alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded',
  'household_member_added', 'card_brands_changed',
  'reviews_changed',
  -- Added here; this list replaces the whole constraint.
  'state_opening_changed'
));

-- ===== 0031_aftercare.sql =====
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

-- ===== 0032_calls.sql =====
-- The chat signup's case reference, and calls with a person (docs/SIGNUP-CHAT.md).
--
--   signup_cases   One row per signup started in the chat with Alti
--                  (/registro). Its case reference ("CR-7KQ4M": "CR-" and
--                  five characters with no look-alikes, no 0/O, 1/I/L, U/V)
--                  is shown to the person from the first screen and carried
--                  by everything that follows, so staff can find the signup
--                  by it. The server creates the row for an anonymous
--                  visitor and keeps the step they reached, their state and
--                  language; nothing else about the person is stored here.
--                  The device resumes with a random token kept only as its
--                  SHA-256. The row is linked to the account (user_id) once
--                  the person signs in with their phone, and then the
--                  existing records (profile, agreement, documents) hold the
--                  rest.
--
-- Calls ("Talk to a person first" → "Schedule a call"). Built, and OFF by
-- default (NEXT_PUBLIC_CALLS_ENABLED). A call is for QUESTIONS ONLY: signing
-- up and any payment happen afterwards, in writing, in the app, never on the
-- call (Telemarketing Sales Rule, 16 C.F.R. 310.4(a)(2): credit repair sold
-- by telephone may not be paid for until results are shown on a report issued
-- more than six months later; the general-media exemption does not apply to
-- credit repair, 310.6(b)(5)). The attorney's question is in docs/SALES-FLOW.md.
--
--   call_windows   When the team takes calls: a start and an end, cut into
--                  slots of a fixed length, set in /equipo/llamadas by a member
--                  with "calls.manage". Removed, never deleted or edited.
--   call_bookings  One slot booked by one person, with their explicit consent
--                  to be called at the number they gave (TCPA: the words shown,
--                  their version and hash, the time, the IP and browser), the
--                  version of the "questions only" notice they saw, and how to
--                  confirm (WhatsApp or email; never SMS). One booking per slot.
--                  Created by the server only (POST /api/calls), never by a
--                  browser with the anon key, and nobody but staff reads others'.
--   call_messages  The confirmation and the reminder of each booking: one row
--                  per message under a unique dedupe key, so a repeated run
--                  never sends twice. Channel WhatsApp or email; there is no
--                  SMS value.
--
-- Who writes: only the server, with the service role. Nobody gets an insert,
-- update or delete policy. Reads: a client their own rows; staff by the
-- scopes of migration 0012 (staff_can_see_client) once a row belongs to a
-- client; a booking or signup with no account yet (a lead) by an
-- administrator or sales, like the leads they work.

-- ── The signup's case reference ─────────────────────────────────────────

create table public.signup_cases (
  case_ref text primary key check (case_ref ~ '^CR-[2-9A-HJKMNP-TW-Z]{5}$'),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users (id) on delete set null,
  -- The five steps (start, info, identity, report, signup) and done (signed).
  step text not null default 'start' check (step in ('start', 'info', 'identity', 'report', 'signup', 'done')),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  locale text not null default 'en' check (locale in ('es', 'en')),
  -- They tapped "Rather talk to someone?" at least once.
  wants_person boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_at timestamptz,
  completed_at timestamptz,
  constraint signup_cases_link_pair check ((user_id is null) or (linked_at is not null))
);

create index signup_cases_user_idx on public.signup_cases (user_id) where user_id is not null;

alter table public.signup_cases enable row level security;

create policy "own signup case" on public.signup_cases
  for select using (auth.uid() = user_id);

create policy "staff read signup cases" on public.signup_cases
  for select using (
    (user_id is not null and public.staff_can_see_client(user_id))
    or (user_id is null and public.staff_role() in ('admin', 'sales'))
  );

-- The reference, the token and the start never change; the account is linked
-- once (and only cleared when the account itself is deleted); a finished
-- signup stays finished. Never deleted.
create function public.signup_cases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'signup_cases: a signup is a record and cannot be deleted';
  end if;
  if new.case_ref <> old.case_ref or new.token_hash <> old.token_hash or new.started_at <> old.started_at then
    raise exception 'signup_cases: the reference, its token and its start never change';
  end if;
  if old.user_id is not null and new.user_id is not null and new.user_id <> old.user_id then
    raise exception 'signup_cases: the signup belongs to another account';
  end if;
  if old.user_id is null and new.user_id is not null then
    new.linked_at := now();
  elsif new.linked_at is distinct from old.linked_at and new.user_id is not distinct from old.user_id then
    new.linked_at := old.linked_at;
  end if;
  if old.step = 'done' then
    new.step := 'done';
  end if;
  if old.completed_at is not null then
    new.completed_at := old.completed_at;
  elsif new.step = 'done' and new.completed_at is null then
    new.completed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.signup_cases_guard() from public;

create trigger signup_cases_guard
  before update or delete on public.signup_cases
  for each row execute function public.signup_cases_guard();

-- ── When the team takes calls ───────────────────────────────────────────

create table public.call_windows (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  slot_minutes smallint not null default 20 check (slot_minutes in (15, 20, 30, 45, 60)),
  -- The clock the team set it on (Texas: Central time).
  time_zone text not null default 'America/Chicago' check (time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$'),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null check (char_length(created_by_name) between 1 and 80),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_by_name text check (removed_by_name is null or char_length(removed_by_name) between 1 and 80),
  constraint call_windows_order check (ends_at > starts_at),
  constraint call_windows_length check (ends_at - starts_at <= interval '12 hours'),
  constraint call_windows_whole_slots check (extract(epoch from (ends_at - starts_at))::integer % (slot_minutes * 60) = 0),
  constraint call_windows_removed_pair check ((removed_at is null) = (removed_by_name is null))
);

create index call_windows_open_idx on public.call_windows (starts_at) where removed_at is null;

alter table public.call_windows enable row level security;

create policy "staff read call windows" on public.call_windows
  for select using (public.is_staff());

-- A window is removed once and otherwise never changes or disappears: a
-- booking points at it.
create function public.call_windows_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'call_windows: a window is removed (removed_at), never deleted';
  end if;
  if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.slot_minutes <> old.slot_minutes
     or new.time_zone <> old.time_zone or new.created_at <> old.created_at or new.created_by_name <> old.created_by_name then
    raise exception 'call_windows: a window cannot be edited; remove it and add another';
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'call_windows: the window was already removed';
  end if;
  if old.removed_at is null and new.removed_at is not null then
    new.removed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.call_windows_guard() from public;

create trigger call_windows_guard
  before update or delete on public.call_windows
  for each row execute function public.call_windows_guard();

-- ── Bookings ────────────────────────────────────────────────────────────

create table public.call_bookings (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.call_windows (id) on delete restrict,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  -- The chat signup it came from, when there is one.
  case_ref text references public.signup_cases (case_ref) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  -- The number to call (US).
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  -- How the confirmation and the reminder go. Never 'sms'.
  confirm_channel text not null check (confirm_channel in ('whatsapp', 'email')),
  locale text not null default 'en' check (locale in ('es', 'en')),
  -- The clock the times were shown on (the person's; Texas by default).
  time_zone text not null default 'America/Chicago' check (time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$'),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  question text check (question is null or char_length(question) <= 500),
  -- TCPA: the person agreed, in their own action, to be called at this number.
  call_consent boolean not null check (call_consent),
  consent_version text not null check (char_length(consent_version) between 3 and 40),
  consent_text_hash text not null check (consent_text_hash ~ '^[0-9a-f]{64}$'),
  consent_at timestamptz not null default now(),
  consent_ip text check (consent_ip is null or char_length(consent_ip) <= 64),
  consent_user_agent text check (consent_user_agent is null or char_length(consent_user_agent) <= 300),
  -- The "questions only" notice they saw before booking.
  notice_version text not null check (char_length(notice_version) between 3 and 40),
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed', 'no_answer')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  closed_by_name text check (closed_by_name is null or char_length(closed_by_name) between 1 and 80),
  staff_note text check (staff_note is null or char_length(staff_note) <= 500),
  constraint call_bookings_order check (slot_end > slot_start),
  constraint call_bookings_email_needs_address check (confirm_channel <> 'email' or email is not null),
  constraint call_bookings_closed_pair check ((status = 'booked') = (closed_at is null))
);

-- One person per slot.
create unique index call_bookings_one_per_slot on public.call_bookings (slot_start) where status = 'booked';
create index call_bookings_user_idx on public.call_bookings (user_id) where user_id is not null;

alter table public.call_bookings enable row level security;

create policy "own call bookings" on public.call_bookings
  for select using (auth.uid() = user_id);

create policy "staff read call bookings" on public.call_bookings
  for select using (
    (user_id is not null and public.staff_can_see_client(user_id))
    or (user_id is null and public.staff_role() in ('admin', 'sales'))
  );

-- A new booking is a real slot of an open window, in the future, consented,
-- and starts booked. Afterwards only its outcome (once), who closed it and a
-- note may change; the account link is cleared only by the account's deletion.
create function public.call_bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  w record;
begin
  if tg_op = 'DELETE' then
    raise exception 'call_bookings: a booking is a record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    select * into w from public.call_windows where id = new.window_id;
    if not found or w.removed_at is not null then
      raise exception 'call_bookings: that window is not open';
    end if;
    if new.slot_start < w.starts_at or new.slot_end > w.ends_at
       or extract(epoch from (new.slot_start - w.starts_at))::integer % (w.slot_minutes * 60) <> 0
       or new.slot_end <> new.slot_start + make_interval(mins => w.slot_minutes) then
      raise exception 'call_bookings: not one of the window''s slots';
    end if;
    if new.slot_start <= now() then
      raise exception 'call_bookings: the slot has already started';
    end if;
    if new.status <> 'booked' or new.closed_at is not null then
      raise exception 'call_bookings: a booking starts booked';
    end if;
    new.created_at := now();
    new.consent_at := now();
    return new;
  end if;
  if new.window_id <> old.window_id or new.slot_start <> old.slot_start or new.slot_end <> old.slot_end
     or new.case_ref is distinct from old.case_ref or new.first_name <> old.first_name
     or new.phone_e164 <> old.phone_e164 or new.email is distinct from old.email
     or new.confirm_channel <> old.confirm_channel or new.locale <> old.locale or new.time_zone <> old.time_zone
     or new.state is distinct from old.state or new.question is distinct from old.question
     or new.call_consent <> old.call_consent or new.consent_version <> old.consent_version
     or new.consent_text_hash <> old.consent_text_hash or new.consent_at <> old.consent_at
     or new.consent_ip is distinct from old.consent_ip or new.consent_user_agent is distinct from old.consent_user_agent
     or new.notice_version <> old.notice_version or new.created_at <> old.created_at then
    raise exception 'call_bookings: a booking cannot be rewritten';
  end if;
  if new.user_id is distinct from old.user_id and not (old.user_id is not null and new.user_id is null) then
    raise exception 'call_bookings: the account on a booking does not change';
  end if;
  if old.status <> 'booked' and (new.status <> old.status or new.closed_at is distinct from old.closed_at) then
    raise exception 'call_bookings: the booking was already closed';
  end if;
  if old.status = 'booked' and new.status <> 'booked' then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.call_bookings_guard() from public;

create trigger call_bookings_guard
  before insert or update or delete on public.call_bookings
  for each row execute function public.call_bookings_guard();

-- ── Confirmations and reminders ─────────────────────────────────────────

create table public.call_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.call_bookings (id) on delete restrict,
  -- "call:<booking>:confirmation" or "call:<booking>:reminder".
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 240),
  kind text not null check (kind in ('confirmation', 'reminder')),
  -- Never 'sms' (docs/AUTOPILOT.md).
  channel text not null check (channel in ('whatsapp', 'email')),
  template text check (template is null or template ~ '^[a-z0-9_]{2,120}$'),
  locale text not null default 'en' check (locale in ('es', 'en')),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  note text check (note is null or char_length(note) <= 300)
);

create index call_messages_booking_idx on public.call_messages (booking_id);

alter table public.call_messages enable row level security;

-- Through the booking: whoever may read the booking reads its messages.
create policy "read call messages through the booking" on public.call_messages
  for select using (exists (select 1 from public.call_bookings b where b.id = booking_id));

-- The words never change; the result is filled in once (sending → sent | failed).
create function public.call_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'call_messages: a message record cannot be deleted';
  end if;
  if new.booking_id <> old.booking_id or new.dedupe_key <> old.dedupe_key or new.kind <> old.kind
     or new.channel <> old.channel or new.body <> old.body or new.locale <> old.locale
     or new.template is distinct from old.template or new.created_at <> old.created_at then
    raise exception 'call_messages: a message cannot be rewritten';
  end if;
  if not (old.status = 'sending' and new.status in ('sent', 'failed')) then
    raise exception 'call_messages: % cannot become %', old.status, new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.call_messages_guard() from public;

create trigger call_messages_guard
  before update or delete on public.call_messages
  for each row execute function public.call_messages_guard();

-- ===== 0033_partner_portal.sql =====
-- The partner portal, so a referral partner can see their clients are in good
-- hands (docs/PARTNERS.md, "The partner portal"):
--
--   partners.kind              + car dealers and attorneys (and "other"), so the
--                              program is not realtor-only.
--   partner_referrals()        rebuilt: the pipeline (referred → contacted →
--                              signed → active → finished, and "did not
--                              continue"), when sales first reached out (the
--                              invitation, prospects.invited_at), who on the
--                              team looks after the person (first name and
--                              role only), whether the person has an account
--                              (so they can be asked to share), the client id
--                              only while they share, and when the partner
--                              last asked them to share. Still nothing from
--                              the case.
--   partner_share_requests     "Ask to follow progress": a partner asks a person
--                              they referred to share their progress. The
--                              client gets a card in their app and one message
--                              (WhatsApp or email, never SMS); they decide on
--                              their own sharing screen, with the consent of
--                              migration 0023. At most one request per client
--                              every 14 days; never to a client who already
--                              shares; only from the partner who referred them.
--                              The partner sees only the date they asked.
--   partner_team_notes         Notes between a partner and the team about one
--                              client, both ways, only while the client shares
--                              with that partner. Staff read them under the
--                              client's scope; the partner reads them only
--                              through partner_team_thread(); the client never
--                              does (staff may choose to write to the client
--                              themselves, in the client's conversation).
--   partner_client_care()      who on the team looks after a client who shares.
--   partners.digest_channel    the weekly summary, opt-in (WhatsApp or email,
--   partner_digests            never SMS), once per partner and week.
--
-- As in 0017 and 0023: a partner has NO read policy on any table here; they
-- read only through security-definer functions that return the columns listed,
-- only while approved (partner_id() is null otherwise). Who writes: only the
-- server, with the service role, after checking the request; the triggers
-- below hold the rules whatever the server sends.

-- ── More kinds of partner ───────────────────────────────────────────────

alter table public.partners drop constraint partners_kind_check;
alter table public.partners add constraint partners_kind_check
  check (kind in ('realtor', 'loan_officer', 'tax_preparer', 'car_dealer', 'attorney', 'other'));

-- ── The current sharing level of a pair (internal) ──────────────────────

-- The newest consent record of a client for a partner, or 'none'. Not granted
-- to anyone: the functions below call it as their owner.
create function public.partner_share_level(p_user uuid, p_partner uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.level from public.partner_share_consents c
    where c.user_id = p_user and c.partner_id = p_partner
    order by c.seq desc limit 1
  ), 'none');
$$;

revoke all on function public.partner_share_level(uuid, uuid) from public, anon, authenticated;

-- ── "Ask to follow progress" ────────────────────────────────────────────

create table public.partner_share_requests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The partner's sign-in that asked.
  requested_by uuid references auth.users (id) on delete set null,
  -- "María López, ABC Realty", as the client reads it.
  partner_name_shown text not null check (char_length(partner_name_shown) between 2 and 210),
  created_at timestamptz not null default now(),
  -- The client tapped "Not now" on the card.
  dismissed_at timestamptz,
  -- The one message to the client: WhatsApp or email, never SMS.
  message_status text not null default 'queued' check (message_status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  message_channel text check (message_channel is null or message_channel in ('whatsapp', 'email')),
  message_note text check (message_note is null or char_length(message_note) <= 200),
  message_sent_at timestamptz,
  constraint partner_share_requests_channel_when_sent check (message_status in ('queued', 'skipped') or message_channel is not null)
);

create index partner_share_requests_user_idx on public.partner_share_requests (user_id, created_at desc);
create index partner_share_requests_queued_idx on public.partner_share_requests (created_at) where message_status = 'queued';

alter table public.partner_share_requests enable row level security;

create function public.partner_share_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only together with the client's account.
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'partner_share_requests: a request is never deleted';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if new.dismissed_at is not null or new.message_status <> 'queued' or new.message_channel is not null or new.message_sent_at is not null then
      raise exception 'partner_share_requests: a request starts queued and not dismissed';
    end if;
    if not exists (select 1 from public.partners p where p.id = new.partner_id and p.status = 'approved') then
      raise exception 'partner_share_requests: only an approved partner can ask';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = new.user_id and pr.referred_partner_id = new.partner_id) then
      raise exception 'partner_share_requests: only the partner who referred this client can ask';
    end if;
    if public.partner_share_level(new.user_id, new.partner_id) <> 'none' then
      raise exception 'partner_share_requests: this client already shares with this partner';
    end if;
    if exists (
      select 1 from public.partner_share_requests q
      where q.user_id = new.user_id and q.created_at > now() - interval '14 days'
    ) then
      raise exception 'partner_share_requests: at most one request every 14 days';
    end if;
    return new;
  end if;
  -- UPDATE: the client's "Not now", once; and the message's delivery, forward only.
  if new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.user_id is distinct from old.user_id
    or new.requested_by is distinct from old.requested_by or new.partner_name_shown is distinct from old.partner_name_shown
    or new.created_at is distinct from old.created_at then
    raise exception 'partner_share_requests: a request cannot be changed';
  end if;
  if old.dismissed_at is not null and new.dismissed_at is distinct from old.dismissed_at then
    raise exception 'partner_share_requests: a dismissal cannot be changed';
  end if;
  if new.message_status is distinct from old.message_status then
    if not (
      (old.message_status = 'queued' and new.message_status in ('sending', 'skipped'))
      or (old.message_status = 'sending' and new.message_status in ('sent', 'failed'))
    ) then
      raise exception 'partner_share_requests: the message can only move forward, once';
    end if;
  elsif old.message_status in ('sent', 'failed', 'skipped') and (
    new.message_channel is distinct from old.message_channel or new.message_note is distinct from old.message_note
    or new.message_sent_at is distinct from old.message_sent_at
  ) then
    raise exception 'partner_share_requests: a delivered message cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_share_requests_guard() from public;

create trigger partner_share_requests_guard
  before insert or update or delete on public.partner_share_requests
  for each row execute function public.partner_share_requests_guard();

-- The client sees their own requests (the card on their home and the note on
-- their sharing screen). Staff, under the client's scope. Never a partner.
create policy "own share requests read" on public.partner_share_requests
  for select using (auth.uid() = user_id);

create policy "staff read share requests" on public.partner_share_requests
  for select using (public.staff_can_see_client(user_id));

-- ── Notes between a partner and the team ────────────────────────────────

create table public.partner_team_notes (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- The client the note is about.
  user_id uuid not null references auth.users (id) on delete cascade,
  author_kind text not null check (author_kind in ('partner', 'staff')),
  author uuid references auth.users (id) on delete set null,
  -- First name only, as the other side reads it ("Ana").
  author_first_name text not null check (char_length(btrim(author_first_name)) between 1 and 40),
  -- A teammate's role ("Credit specialist"); null for the partner.
  author_role text check (author_role is null or author_role in ('admin', 'specialist', 'sales')),
  body text not null check (char_length(btrim(body)) between 2 and 1500),
  created_at timestamptz not null default now(),
  constraint partner_team_notes_role check ((author_kind = 'staff') = (author_role is not null))
);

create index partner_team_notes_thread_idx on public.partner_team_notes (user_id, partner_id, created_at);

alter table public.partner_team_notes enable row level security;

create function public.partner_team_notes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'partner_team_notes: a note cannot be changed';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'partner_team_notes: a note cannot be deleted';
    end if;
    return old;
  end if;
  new.created_at := now();
  if not exists (select 1 from public.partners p where p.id = new.partner_id and p.status = 'approved') then
    raise exception 'partner_team_notes: the partner is not approved';
  end if;
  -- Only while the client shares with this partner.
  if public.partner_share_level(new.user_id, new.partner_id) = 'none' then
    raise exception 'partner_team_notes: this client does not share with this partner';
  end if;
  if new.author_kind = 'partner' and not exists (
    select 1 from public.partner_members m where m.user_id = new.author and m.partner_id = new.partner_id
  ) then
    raise exception 'partner_team_notes: the author is not this partner';
  end if;
  if new.author_kind = 'staff' and not exists (
    select 1 from public.staff_members s where s.user_id = new.author and s.active and s.role = new.author_role
  ) then
    raise exception 'partner_team_notes: the author is not an active member of staff in that role';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_team_notes_guard() from public;

create trigger partner_team_notes_guard
  before insert or update or delete on public.partner_team_notes
  for each row execute function public.partner_team_notes_guard();

create policy "staff read partner team notes" on public.partner_team_notes
  for select using (public.staff_can_see_client(user_id));

-- The thread of one client, for the signed-in partner: only while the client
-- shares with them, only approved with the current terms. The notes' words,
-- the authors' first names and roles, and the dates; nothing else.
create function public.partner_team_thread(p_client uuid)
returns table (note_id uuid, author_kind text, author_first_name text, author_role text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.author_kind, n.author_first_name, n.author_role, n.body, n.created_at
  from public.partner_team_notes n
  where public.partner_id() is not null and p_client is not null and public.partner_terms_ok()
    and n.partner_id = public.partner_id() and n.user_id = p_client
    and public.partner_share_level(p_client, public.partner_id()) <> 'none'
  order by n.created_at, n.id;
$$;

-- Who on the team looks after a client who shares with the signed-in partner:
-- the assigned teammate, else the one their lead was given to, else their
-- salesperson (the same order as partner_referrals()); first name and role
-- only. Nothing for anyone else.
create function public.partner_client_care(p_client uuid)
returns table (care_first_name text, care_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(btrim(s.display_name), ' ', 1), s.role
  from public.staff_members s
  where public.partner_id() is not null and p_client is not null and public.partner_terms_ok()
    and public.partner_share_level(p_client, public.partner_id()) <> 'none'
    and s.active and s.user_id = coalesce(
      (select a.staff_user_id from public.client_assignments a where a.user_id = p_client),
      (select p.assigned_to from public.prospects p where p.converted_user_id = p_client order by p.created_at desc limit 1),
      (select s2.user_id from public.staff_members s2 where s2.active and s2.handle = coalesce(
        (select p.salesperson from public.prospects p where p.converted_user_id = p_client order by p.created_at desc limit 1),
        (select pr.referred_by from public.profiles pr where pr.id = p_client)
      ) limit 1)
    )
  limit 1;
$$;

revoke all on function public.partner_team_thread(uuid) from public, anon;
revoke all on function public.partner_client_care(uuid) from public, anon;
grant execute on function public.partner_team_thread(uuid) to authenticated;
grant execute on function public.partner_client_care(uuid) to authenticated;

-- ── The partner's referrals, as a pipeline ──────────────────────────────

drop function public.partner_referrals();

-- The signed-in partner's referrals:
--   referred       a lead the team has not reached yet (no invitation sent, no account);
--   contacted      sales sent the invitation, or they have an account without a signed agreement;
--   signed         signed the service agreement; no round mailed yet;
--   active         at least one round mailed and the service goes on;
--   finished       finished the program (graduation: after-care goes on);
--   not_continued  cancelled, asked to end the service, or sales closed them.
-- First name and last initial only; when sales reached out; who looks after
-- them (first name and role). The client id only while they share. Nothing
-- from the credit file, the letters, the agreement's terms or the payments.
-- The same rules as referralStatus() in src/lib/partners/rules.ts.
create function public.partner_referrals()
returns table (
  referral_id uuid,
  first_name text,
  last_initial text,
  referred_at timestamptz,
  status text,
  contacted_at timestamptz,
  care_first_name text,
  care_role text,
  has_account boolean,
  shared_client_id uuid,
  share_requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.partner_id() as pid),
  people as (
    -- Referred as a prospect (the partner's form, or a HighLevel lead carrying their code).
    select p.id as referral_id, p.first_name, left(p.last_name, 1) as last_initial, p.created_at as referred_at,
           p.converted_user_id as user_id, p.lost_at, p.invited_at, p.assigned_to, p.salesperson
    from public.prospects p, me
    where me.pid is not null and p.partner_id = me.pid
    union all
    -- Came by the partner's link and signed up by themselves (no prospect row of this partner).
    select pr.id, split_part(btrim(pr.full_name), ' ', 1), left(split_part(btrim(pr.full_name), ' ', 2), 1), pr.created_at,
           pr.id, null::timestamptz, null::timestamptz, null::uuid, pr.referred_by
    from public.profiles pr, me
    where me.pid is not null and pr.referred_partner_id = me.pid
      and not exists (select 1 from public.prospects p2 where p2.converted_user_id = pr.id and p2.partner_id = me.pid)
  )
  select x.referral_id, x.first_name, x.last_initial, x.referred_at,
    case
      when x.lost_at is not null then 'not_continued'
      when x.user_id is not null and exists (select 1 from public.program_completions pc where pc.user_id = x.user_id) then 'finished'
      when a.cancelled_at is not null or a.service_end_requested_at is not null then 'not_continued'
      when a.signed_at is not null and exists (
        select 1 from public.attack_rounds r where r.user_id = x.user_id and r.mailed_at is not null
      ) then 'active'
      when a.signed_at is not null then 'signed'
      when x.user_id is null and x.invited_at is null then 'referred'
      else 'contacted'
    end as status,
    x.invited_at,
    split_part(btrim(care.display_name), ' ', 1),
    care.role,
    x.user_id is not null,
    case
      when x.user_id is not null and public.partner_terms_ok()
        and public.partner_share_level(x.user_id, (select pid from me)) <> 'none' then x.user_id
      else null
    end,
    (select max(q.created_at) from public.partner_share_requests q
      where x.user_id is not null and q.user_id = x.user_id and q.partner_id = (select pid from me))
  from people x
  left join lateral (
    select s.signed_at, s.cancelled_at, s.service_end_requested_at
    from public.service_agreements s
    where x.user_id is not null and s.user_id = x.user_id
    order by s.created_at desc
    limit 1
  ) a on true
  left join lateral (
    -- The teammate who looks after them: the assigned specialist once they are a
    -- client, else the one the lead was given to, else their salesperson.
    select st.display_name, st.role
    from public.staff_members st
    where st.active and st.user_id = coalesce(
      (select ca.staff_user_id from public.client_assignments ca where x.user_id is not null and ca.user_id = x.user_id),
      x.assigned_to,
      (select s2.user_id from public.staff_members s2 where s2.handle = x.salesperson and s2.active limit 1)
    )
    limit 1
  ) care on true
  order by x.referred_at desc;
$$;

revoke all on function public.partner_referrals() from public, anon;
grant execute on function public.partner_referrals() to authenticated;

-- ── The weekly summary ──────────────────────────────────────────────────

alter table public.partners
  -- Off (null) unless the partner chose a channel. Never SMS.
  add column digest_channel text check (digest_channel is null or digest_channel in ('whatsapp', 'email'));

create table public.partner_digests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- The partner's local ISO week: "2026-W48". Once per partner and week.
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  channel text not null check (channel in ('email', 'whatsapp')),
  -- How many milestones it carried (the words are only what the partner may see anyway).
  items integer not null check (items between 1 and 200),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  unique (partner_id, week_key)
);

alter table public.partner_digests enable row level security;

create function public.partner_digests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'partner_digests: a summary is never deleted';
  end if;
  if new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.week_key is distinct from old.week_key
    or new.channel is distinct from old.channel or new.items is distinct from old.items or new.created_at is distinct from old.created_at
    or old.status <> 'sending' then
    raise exception 'partner_digests: only the delivery of a summary being sent can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_digests_guard() from public;

create trigger partner_digests_guard
  before update or delete on public.partner_digests
  for each row execute function public.partner_digests_guard();

create policy "admin read partner digests" on public.partner_digests
  for select using (public.staff_role() = 'admin');

-- ===== 0034_control_leads.sql =====
-- Credalti Control, phase 1 (docs/CONTROL.md): the lead inbox, its pipeline,
-- the lead autopilot (off), staff phone alerts (off for everyone) and the
-- Overview's "escalate to the owner".
--
-- What it adds:
--   leads                     One row per prospect conversation, keyed by the
--                             phone. Created and kept up to date by the
--                             database itself (triggers below) from what
--                             already happens: a WhatsApp message from a
--                             number with no account, a prospect added by
--                             hand, from HighLevel or by a partner, a chat
--                             signup (/registro) that reached a phone. The
--                             facts on it (invited, signed, last message,
--                             first reply by a person) are written only by
--                             those triggers.
--   lead_stage_events         Every pipeline move. ONLY PEOPLE MOVE LEADS: a
--                             move needs a person (actor not null) and can
--                             only go to New, Contacted, Qualified, Not
--                             interested, Closed-lost or Archived. "Invited"
--                             and "Signed" are not moves at all: they are the
--                             facts invited_at (the invitation was sent) and
--                             signed_at (the agreement was signed).
--   lead_notes                The team's notes on a lead. Append-only.
--   lead_autopilot_settings   The lead autopilot's switch and numbers: OFF.
--   lead_autopilot_changes    Who turned it on or off, and the numbers. Append-only.
--   lead_auto_messages        One row for every automatic message to a lead,
--                             sent or handed to a person. WhatsApp only.
--   staff_alert_topics        Each member's phone alerts, per topic. Off.
--   staff_push_subscriptions  The browsers a member turned alerts on in.
--   staff_alerts              The alerts themselves (once per member and key).
--   control_escalations       "Escalate to the owner" from the Today list.
--   cron_heartbeats           When a scheduled job last ran.
--
-- Who writes: only the server (service role), after the caller's role is
-- checked (src/app/api/staff/leads, …/alerts, …/control, /api/cron/leads),
-- and the triggers. Nobody gets an insert, update or delete policy.
-- Who reads: leads and everything about them, an administrator, or sales for
-- the leads they work (theirs, or nobody's yet). A specialist, a client, a
-- partner and anon read none of it. A member reads only their own alerts.

-- ── The leads ───────────────────────────────────────────────────────────

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  locale text check (locale is null or locale in ('en', 'es')),
  -- Where the first touch came from. Never overwritten (first touch wins).
  source text not null check (source in ('whatsapp', 'highlevel', 'partner', 'signup_chat', 'manual', 'household')),
  -- Marketing tags only: campaign, UTM, the partner, the signup's case reference.
  first_touch jsonb not null default '{}' check (jsonb_typeof(first_touch) = 'object' and octet_length(first_touch::text) <= 4000),
  prospect_id uuid references public.prospects (id) on delete set null,
  partner_id uuid references public.partners (id) on delete set null,
  signup_case_ref text references public.signup_cases (case_ref) on delete set null,
  -- The salesperson who works the lead (staff_members.handle); null: nobody yet.
  salesperson text check (salesperson is null or salesperson ~ '^[a-z0-9-]{2,30}$'),
  assigned_at timestamptz,
  -- The stage a PERSON chose. Invited and Signed come from the facts below.
  stage text not null default 'new' check (stage in ('new', 'contacted', 'qualified', 'not_interested', 'closed_lost', 'archived')),
  stage_at timestamptz,
  stage_by uuid references auth.users (id) on delete set null,
  -- Facts, written by the triggers only.
  invited_at timestamptz,
  signed_at timestamptz,
  client_user_id uuid references auth.users (id) on delete set null,
  last_inbound_at timestamptz,
  -- The last answer after an inbound message: by a person, or by the AI (the lead autopilot, the coach).
  last_reply_at timestamptz,
  last_human_at timestamptz,
  first_human_reply_at timestamptz,
  last_message_at timestamptz,
  last_message_role text check (last_message_role is null or last_message_role in ('user', 'assistant')),
  last_message_source text check (last_message_source is null or last_message_source in ('journey', 'coach', 'human')),
  last_message_excerpt text check (last_message_excerpt is null or char_length(last_message_excerpt) <= 160),
  created_at timestamptz not null default now()
);

create index leads_salesperson_idx on public.leads (salesperson);
create index leads_created_idx on public.leads (created_at desc);
create index leads_prospect_idx on public.leads (prospect_id) where prospect_id is not null;
create index leads_client_idx on public.leads (client_user_id) where client_user_id is not null;

alter table public.leads enable row level security;

-- Who may see a lead: an administrator; sales for their own leads and for the ones nobody has yet.
create function public.staff_can_see_lead(p_salesperson text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.staff_role() = 'admin', false)
      or coalesce(public.staff_role() = 'sales' and (p_salesperson is null or p_salesperson = public.staff_handle()), false);
$$;

create function public.staff_can_see_lead_id(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.id = p_lead and public.staff_can_see_lead(l.salesperson));
$$;

create function public.staff_can_see_lead_phone(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leads l where l.phone_e164 = p_phone and public.staff_can_see_lead(l.salesperson));
$$;

revoke all on function public.staff_can_see_lead(text) from public;
revoke all on function public.staff_can_see_lead_id(uuid) from public;
revoke all on function public.staff_can_see_lead_phone(text) from public;
grant execute on function public.staff_can_see_lead(text) to authenticated;
grant execute on function public.staff_can_see_lead_id(uuid) to authenticated;
grant execute on function public.staff_can_see_lead_phone(text) to authenticated;

create policy "staff read leads" on public.leads
  for select using (public.staff_can_see_lead(salesperson));

-- A lead's WhatsApp conversation (chat_messages with no account) was for an
-- administrator only (0012). Sales reads the conversations of the leads they work.
create policy "staff read lead chat" on public.chat_messages
  for select using (user_id is null and channel = 'whatsapp' and phone_e164 is not null and public.staff_can_see_lead_phone(phone_e164));

-- And whether that number said STOP.
create policy "staff read lead opt-outs" on public.message_opt_outs
  for select using (user_id is null and phone_e164 is not null and public.staff_can_see_lead_phone(phone_e164));

-- Only people move leads. A stage changes only through a lead_stage_events
-- row (which needs a person); the facts change only through the triggers.
create function public.leads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'leads: a lead is a record and is never deleted (archive it)';
  end if;
  if new.stage is distinct from old.stage or new.stage_at is distinct from old.stage_at or new.stage_by is distinct from old.stage_by then
    if coalesce(current_setting('credalti.lead_stage_move', true), '') <> 'on' then
      raise exception 'leads: only a person moves a lead, through lead_stage_events';
    end if;
  end if;
  if new.phone_e164 <> old.phone_e164 or new.source <> old.source or new.created_at <> old.created_at then
    raise exception 'leads: the phone, the first source and the first touch never change';
  end if;
  -- Facts only move forward: once invited or signed, always.
  if old.invited_at is not null then new.invited_at := old.invited_at; end if;
  if old.signed_at is not null then new.signed_at := old.signed_at; end if;
  if old.first_human_reply_at is not null then new.first_human_reply_at := old.first_human_reply_at; end if;
  if old.first_touch <> '{}'::jsonb then new.first_touch := old.first_touch; end if;
  return new;
end;
$$;

create trigger leads_guard
  before update or delete on public.leads
  for each row execute function public.leads_guard();

-- ── Pipeline moves (people only) ────────────────────────────────────────

create table public.lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_stage text,
  to_stage text not null check (to_stage in ('new', 'contacted', 'qualified', 'not_interested', 'closed_lost', 'archived')),
  -- Only people move leads: never null, never the system.
  actor uuid not null references auth.users (id) on delete restrict,
  actor_handle text check (actor_handle is null or actor_handle ~ '^[a-z0-9-]{2,30}$'),
  at timestamptz not null default now()
);

create index lead_stage_events_lead_idx on public.lead_stage_events (lead_id, at);

alter table public.lead_stage_events enable row level security;

create policy "staff read lead stage events" on public.lead_stage_events
  for select using (public.staff_can_see_lead_id(lead_id));

create function public.lead_stage_events_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'lead_stage_events: the pipeline history is append-only';
  end if;
  if not exists (select 1 from public.staff_members s where s.user_id = new.actor and s.active) then
    raise exception 'lead_stage_events: only an active member of the team moves a lead';
  end if;
  select l.stage into new.from_stage from public.leads l where l.id = new.lead_id;
  new.at := now();
  perform set_config('credalti.lead_stage_move', 'on', true);
  update public.leads set stage = new.to_stage, stage_at = new.at, stage_by = new.actor where id = new.lead_id;
  perform set_config('credalti.lead_stage_move', '', true);
  return new;
end;
$$;

revoke all on function public.lead_stage_events_apply() from public;

create trigger lead_stage_events_apply
  before insert or update or delete on public.lead_stage_events
  for each row execute function public.lead_stage_events_apply();

-- ── Notes ───────────────────────────────────────────────────────────────

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  author uuid not null references auth.users (id) on delete restrict,
  author_handle text check (author_handle is null or author_handle ~ '^[a-z0-9-]{2,30}$'),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now()
);

create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at);

alter table public.lead_notes enable row level security;

create policy "staff read lead notes" on public.lead_notes
  for select using (public.staff_can_see_lead_id(lead_id));

create function public.control_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: this record is append-only', tg_table_name;
end;
$$;

create trigger lead_notes_append_only
  before update or delete on public.lead_notes
  for each row execute function public.control_append_only();

-- ── The lead autopilot: OFF ─────────────────────────────────────────────

create table public.lead_autopilot_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- Wait this long after the lead's message, so a person can answer first.
  reply_delay_seconds integer not null default 120 check (reply_delay_seconds between 30 and 3600),
  per_lead_daily_cap integer not null default 3 check (per_lead_daily_cap between 1 and 10),
  daily_cap integer not null default 40 check (daily_cap between 1 and 500),
  quiet_start_hour integer not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour integer not null default 8 check (quiet_end_hour between 0 and 23),
  send_signup_link boolean not null default true,
  -- When it was last turned on: it never answers a message older than this.
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80)
);

insert into public.lead_autopilot_settings (id) values (true);

alter table public.lead_autopilot_settings enable row level security;

create policy "staff read lead autopilot" on public.lead_autopilot_settings
  for select using (public.is_staff());

create table public.lead_autopilot_changes (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid not null references auth.users (id) on delete restrict,
  actor_name text not null check (char_length(actor_name) between 1 and 80),
  enabled boolean not null,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);

alter table public.lead_autopilot_changes enable row level security;

create policy "admin read lead autopilot changes" on public.lead_autopilot_changes
  for select using (public.staff_role() = 'admin');

create trigger lead_autopilot_changes_append_only
  before update or delete on public.lead_autopilot_changes
  for each row execute function public.control_append_only();

create table public.lead_auto_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- WhatsApp only. Never SMS, for anything automatic.
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  kind text not null check (kind in ('greeting', 'faq', 'signup_link', 'handoff')),
  -- claimed → sent | failed; a hand-off is recorded as handed_off and never sends anything.
  status text not null check (status in ('claimed', 'sent', 'failed', 'handed_off')),
  -- Why a person was called in, or why the send failed.
  reason text check (reason is null or char_length(reason) <= 200),
  -- The exact words (with the AI label), or null for a hand-off.
  body text check (body is null or char_length(body) between 1 and 1500),
  -- The lead's message it answers, so the same message is never answered twice.
  inbound_at timestamptz not null,
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200),
  created_at timestamptz not null default now(),
  constraint lead_auto_messages_body check ((kind = 'handoff') = (body is null)),
  constraint lead_auto_messages_handoff check ((kind = 'handoff') = (status = 'handed_off'))
);

create index lead_auto_messages_lead_idx on public.lead_auto_messages (lead_id, created_at);
create index lead_auto_messages_day_idx on public.lead_auto_messages (created_at);

alter table public.lead_auto_messages enable row level security;

create policy "staff read lead auto messages" on public.lead_auto_messages
  for select using (public.staff_can_see_lead_id(lead_id));

-- The words, the lead and the key never change; the status only moves from claimed to sent or failed.
create function public.lead_auto_messages_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'lead_auto_messages: the record of automatic messages is never deleted';
  end if;
  if new.lead_id <> old.lead_id or new.kind <> old.kind or new.body is distinct from old.body
     or new.dedupe_key <> old.dedupe_key or new.inbound_at <> old.inbound_at or new.created_at <> old.created_at then
    raise exception 'lead_auto_messages: what was sent and to whom never changes';
  end if;
  if new.status <> old.status and not (old.status = 'claimed' and new.status in ('sent', 'failed')) then
    raise exception 'lead_auto_messages: the status only moves from claimed to sent or failed';
  end if;
  return new;
end;
$$;

create trigger lead_auto_messages_guard
  before update or delete on public.lead_auto_messages
  for each row execute function public.lead_auto_messages_guard();

-- ── Staff phone alerts: off until each person turns them on ─────────────

create table public.staff_alert_topics (
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  topic text not null check (topic in ('new_lead', 'lead_waiting', 'complaint', 'partner_note', 'escalation')),
  enabled boolean not null default false,
  waiting_minutes integer not null default 15 check (waiting_minutes between 5 and 240),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic)
);

alter table public.staff_alert_topics enable row level security;

create policy "own alert topics" on public.staff_alert_topics
  for select using (auth.uid() = user_id);

create table public.staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text check (p256dh is null or char_length(p256dh) <= 200),
  auth text check (auth is null or char_length(auth) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index staff_push_subscriptions_user_idx on public.staff_push_subscriptions (user_id) where revoked_at is null;

alter table public.staff_push_subscriptions enable row level security;

create policy "own push subscriptions" on public.staff_push_subscriptions
  for select using (auth.uid() = user_id);

create table public.staff_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_members (user_id) on delete cascade,
  -- 'test': the member's own "Send me a test" on the alerts screen.
  topic text not null check (topic in ('new_lead', 'lead_waiting', 'complaint', 'partner_note', 'escalation', 'test')),
  -- One alert per member per thing: "lead_waiting:<lead>:<message time>".
  dedupe_key text not null check (char_length(dedupe_key) between 4 and 200),
  title text not null check (char_length(title) between 1 and 140),
  body text check (body is null or char_length(body) <= 300),
  url text not null check (url ~ '^/equipo'),
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  seen_at timestamptz,
  unique (user_id, dedupe_key)
);

create index staff_alerts_user_idx on public.staff_alerts (user_id, created_at desc);

alter table public.staff_alerts enable row level security;

create policy "own alerts" on public.staff_alerts
  for select using (auth.uid() = user_id);

-- ── Escalate to the owner ───────────────────────────────────────────────

create table public.control_escalations (
  id uuid primary key default gen_random_uuid(),
  item_key text not null check (char_length(item_key) between 3 and 200),
  title text not null check (char_length(title) between 1 and 160),
  note text check (note is null or char_length(note) <= 500),
  by_user uuid not null references auth.users (id) on delete restrict,
  by_handle text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create index control_escalations_open_idx on public.control_escalations (created_at desc) where resolved_at is null;

alter table public.control_escalations enable row level security;

create policy "admin read escalations" on public.control_escalations
  for select using (public.staff_role() = 'admin');

create policy "own escalations" on public.control_escalations
  for select using (auth.uid() = by_user);

-- Only the resolution is ever written after the fact, once.
create function public.control_escalations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'control_escalations: never deleted';
  end if;
  if new.item_key <> old.item_key or new.title <> old.title or new.note is distinct from old.note
     or new.by_user <> old.by_user or new.created_at <> old.created_at then
    raise exception 'control_escalations: what was escalated never changes';
  end if;
  if old.resolved_at is not null and (new.resolved_at is distinct from old.resolved_at or new.resolved_by is distinct from old.resolved_by) then
    raise exception 'control_escalations: resolved once';
  end if;
  return new;
end;
$$;

create trigger control_escalations_guard
  before update or delete on public.control_escalations
  for each row execute function public.control_escalations_guard();

-- ── When a scheduled job last ran ───────────────────────────────────────

create table public.cron_heartbeats (
  job text primary key check (job ~ '^[a-z0-9-]{2,40}$'),
  last_run_at timestamptz not null,
  last_ok_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2000)
);

alter table public.cron_heartbeats enable row level security;

create policy "admin read heartbeats" on public.cron_heartbeats
  for select using (public.staff_role() = 'admin');

-- ── Keeping the leads up to date, from what already happens ─────────────

-- A prospect (by hand, HighLevel, a partner, a household member) is a lead.
create function public.leads_from_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  touch jsonb := coalesce(new.source_detail -> 'firstTouch', '{}'::jsonb);
begin
  if tg_op = 'INSERT' then
    if new.partner_id is not null then
      touch := touch || jsonb_build_object('partnerId', new.partner_id);
    end if;
    insert into public.leads (phone_e164, display_name, locale, source, first_touch, prospect_id, partner_id, salesperson, assigned_at, invited_at, client_user_id, created_at)
    values (new.phone_e164, left(btrim(new.first_name || ' ' || new.last_name), 80), new.locale, new.source, touch, new.id, new.partner_id,
            new.salesperson, case when new.salesperson is not null then new.created_at end, new.invited_at, new.converted_user_id, new.created_at)
    on conflict (phone_e164) do update set
      prospect_id = case when excluded.prospect_id is not null and new.lost_at is null then excluded.prospect_id else public.leads.prospect_id end,
      display_name = coalesce(public.leads.display_name, excluded.display_name),
      locale = coalesce(public.leads.locale, excluded.locale),
      partner_id = coalesce(public.leads.partner_id, excluded.partner_id),
      salesperson = coalesce(public.leads.salesperson, excluded.salesperson),
      assigned_at = coalesce(public.leads.assigned_at, excluded.assigned_at),
      invited_at = coalesce(public.leads.invited_at, excluded.invited_at);
  else
    update public.leads set
      invited_at = coalesce(invited_at, new.invited_at),
      client_user_id = coalesce(client_user_id, new.converted_user_id),
      display_name = coalesce(display_name, left(btrim(new.first_name || ' ' || new.last_name), 80))
    where prospect_id = new.id or (phone_e164 = new.phone_e164 and new.lost_at is null);
  end if;
  return null;
end;
$$;

revoke all on function public.leads_from_prospect() from public;

create trigger leads_from_prospect
  after insert or update of invited_at, converted_user_id on public.prospects
  for each row execute function public.leads_from_prospect();

-- A WhatsApp message: a number with no account that writes is a lead; every
-- message keeps the lead's last message, and a teammate's answer counts as
-- the first reply by a person.
create function public.leads_from_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  excerpt text := left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 160);
begin
  if new.channel <> 'whatsapp' or new.phone_e164 is null then
    return null;
  end if;
  if new.role = 'user' then
    if new.user_id is null then
      insert into public.leads (phone_e164, source, first_touch, created_at)
      values (new.phone_e164, 'whatsapp', jsonb_build_object('channel', 'whatsapp', 'at', new.created_at), new.created_at)
      on conflict (phone_e164) do nothing;
    end if;
    update public.leads set
      last_inbound_at = greatest(coalesce(last_inbound_at, new.created_at), new.created_at),
      last_message_at = new.created_at, last_message_role = 'user', last_message_source = new.source, last_message_excerpt = excerpt
    where phone_e164 = new.phone_e164;
  else
    update public.leads set
      last_reply_at = case when new.source in ('coach', 'human') then greatest(coalesce(last_reply_at, new.created_at), new.created_at) else last_reply_at end,
      last_human_at = case when new.source = 'human' then greatest(coalesce(last_human_at, new.created_at), new.created_at) else last_human_at end,
      first_human_reply_at = case when new.source = 'human' then coalesce(first_human_reply_at, new.created_at) else first_human_reply_at end,
      last_message_at = new.created_at, last_message_role = 'assistant', last_message_source = new.source, last_message_excerpt = excerpt
    where phone_e164 = new.phone_e164;
  end if;
  return null;
end;
$$;

revoke all on function public.leads_from_whatsapp() from public;

create trigger leads_from_whatsapp
  after insert on public.chat_messages
  for each row execute function public.leads_from_whatsapp();

-- A chat signup (/registro) that reached a verified phone is a lead, with its case reference.
create function public.leads_from_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone text;
begin
  if new.user_id is null or (tg_op = 'UPDATE' and old.user_id is not null) then
    return null;
  end if;
  select p.phone_e164 into phone from public.profiles p where p.id = new.user_id;
  if phone is null then
    select '+' || ltrim(u.phone, '+') into phone from auth.users u where u.id = new.user_id and u.phone is not null and u.phone <> '';
  end if;
  if phone is null or phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  insert into public.leads (phone_e164, locale, source, first_touch, signup_case_ref, client_user_id, created_at)
  values (phone, new.locale, 'signup_chat', jsonb_build_object('caseRef', new.case_ref), new.case_ref, new.user_id, new.started_at)
  on conflict (phone_e164) do update set
    signup_case_ref = coalesce(public.leads.signup_case_ref, excluded.signup_case_ref),
    client_user_id = coalesce(public.leads.client_user_id, excluded.client_user_id),
    locale = coalesce(public.leads.locale, excluded.locale);
  return null;
end;
$$;

revoke all on function public.leads_from_signup() from public;

create trigger leads_from_signup
  after insert or update of user_id on public.signup_cases
  for each row execute function public.leads_from_signup();

-- "Signed" is set automatically, and only here: when the agreement is signed.
create function public.leads_from_agreement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone text;
begin
  if new.signed_at is null or (tg_op = 'UPDATE' and old.signed_at is not null) then
    return null;
  end if;
  select p.phone_e164 into phone from public.profiles p where p.id = new.user_id;
  update public.leads set
    signed_at = coalesce(signed_at, new.signed_at),
    client_user_id = coalesce(client_user_id, new.user_id)
  where client_user_id = new.user_id
     or (phone is not null and phone_e164 = phone)
     or prospect_id in (select pr.id from public.prospects pr where pr.converted_user_id = new.user_id);
  return null;
end;
$$;

revoke all on function public.leads_from_agreement() from public;

create trigger leads_from_agreement
  after insert or update of signed_at on public.service_agreements
  for each row execute function public.leads_from_agreement();

-- ── What is already on record becomes the first leads ───────────────────

insert into public.leads (phone_e164, display_name, locale, source, first_touch, prospect_id, partner_id, salesperson, assigned_at, invited_at, client_user_id, created_at)
select distinct on (p.phone_e164)
  p.phone_e164, left(btrim(p.first_name || ' ' || p.last_name), 80), p.locale, p.source,
  coalesce(p.source_detail -> 'firstTouch', '{}'::jsonb) || case when p.partner_id is not null then jsonb_build_object('partnerId', p.partner_id) else '{}'::jsonb end,
  p.id, p.partner_id, p.salesperson, case when p.salesperson is not null then p.created_at end, p.invited_at, p.converted_user_id, p.created_at
from public.prospects p
order by p.phone_e164, (p.lost_at is null) desc, p.created_at desc
on conflict (phone_e164) do nothing;

insert into public.leads (phone_e164, source, first_touch, created_at)
select m.phone_e164, 'whatsapp', jsonb_build_object('channel', 'whatsapp', 'at', min(m.created_at)), min(m.created_at)
from public.chat_messages m
where m.channel = 'whatsapp' and m.user_id is null and m.role = 'user' and m.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
group by m.phone_e164
on conflict (phone_e164) do nothing;

update public.leads l set
  last_inbound_at = x.last_in, last_reply_at = x.last_reply, last_human_at = x.last_human, first_human_reply_at = x.first_human
from (
  select m.phone_e164,
    max(m.created_at) filter (where m.role = 'user') as last_in,
    max(m.created_at) filter (where m.role = 'assistant' and m.source in ('coach', 'human')) as last_reply,
    max(m.created_at) filter (where m.role = 'assistant' and m.source = 'human') as last_human,
    min(m.created_at) filter (where m.role = 'assistant' and m.source = 'human') as first_human
  from public.chat_messages m
  where m.channel = 'whatsapp' and m.phone_e164 is not null
  group by m.phone_e164
) x
where x.phone_e164 = l.phone_e164;

update public.leads l set
  signed_at = a.signed_at, client_user_id = coalesce(l.client_user_id, a.user_id)
from public.service_agreements a
left join public.profiles p on p.id = a.user_id
where a.signed_at is not null and l.signed_at is null
  and (l.client_user_id = a.user_id or p.phone_e164 = l.phone_e164);

-- ===== 0035_content.sql =====
-- The content hub (/equipo/contenido, src/lib/content, docs/CONTENT.md):
-- marketing content from idea to measured results, the checks and approvals,
-- and publishing to social networks (off by default).
--
--   content_pieces       One row per piece: type, channels, language, audience,
--                        theme, the words (copy: hook, on-screen, script,
--                        caption, call to action, in English and Spanish),
--                        links, owner, due date, status, the checklist, the
--                        hash of what it says now (content_hash, computed by
--                        the server from the words, links, channels and files)
--                        and the approval (approved_hash: the hash that was
--                        approved). Never deleted: archived.
--   content_assets       Files (in the private content-assets bucket) and
--                        links (https) attached to a piece, with alt text.
--                        Removed by marking, so what was approved stays known.
--   content_events       The piece's history: created, edited, moved,
--                        submitted, checked, approved, changes requested,
--                        approval reset, posted. Append-only.
--   content_results      Numbers per piece and channel: typed in by a person,
--                        or read from a network. Append-only; a missing metric
--                        is absent, never 0.
--   content_settings     One row: publishing on or off (OFF by default) and
--                        per channel (all OFF by default).
--   content_connections  The connected accounts (Meta, TikTok, YouTube): the
--                        account's ids and names, the scopes granted, and the
--                        tokens ENCRYPTED by the server (AES-256-GCM,
--                        CONTENT_TOKEN_KEY). No policy at all: only the server
--                        (service role) reads it; tokens never reach a browser.
--   content_schedules    One row per piece, channel and time. The publish key
--                        (piece, channel, approved hash) is unique while the
--                        row is live, so the same approved content is never
--                        posted twice to a channel; a row is claimed before the
--                        provider is called.
--   content_publish_log  Every scheduling, hold, claim, send, answer, retry
--                        and failure, with who approved and exactly what was
--                        sent. Append-only.
--
-- Who reads (row level security): administrators and specialists read the
-- board, history, results, schedules and log (content.view in
-- src/lib/staff/permissions.ts); sales reads only approved partner material
-- and its files (content.share). Clients, partners and anyone signed out read
-- nothing. Every write is the server's (service role), after the caller's
-- capability is checked; the triggers below hold the approval rule and the
-- append-only records again.

create table public.content_pieces (
  id text primary key check (id ~ '^[a-z]{2}_[a-z0-9]{6,40}$'),
  title text not null check (char_length(title) between 2 and 120),
  type text not null check (type in ('short_video', 'carousel', 'image', 'story', 'youtube', 'whatsapp_status', 'partner', 'email', 'blog')),
  channels text[] not null default '{}' check (channels <@ array['instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp', 'partners', 'email', 'website']::text[]),
  language text not null check (language in ('en', 'es', 'both')),
  audience text not null check (audience in ('consumers', 'hispanic', 'partners')),
  theme text not null check (theme in ('rights', 'myths', 'disputes', 'process', 'itin', 'partners', 'aftercare', 'team')),
  goal text not null default '' check (char_length(goal) <= 300),
  copy jsonb not null default '{}' check (jsonb_typeof(copy) = 'object' and octet_length(copy::text) <= 60000),
  characters text[] not null default '{}' check (characters <@ array['alti', 'altibot']::text[]),
  links text[] not null default '{}' check (coalesce(array_length(links, 1), 0) <= 10),
  owner text check (owner is null or owner ~ '^[a-z0-9._-]{1,40}$'),
  due_date date,
  status text not null default 'idea' check (status in ('idea', 'planned', 'in_production', 'review', 'changes', 'approved', 'scheduled', 'posted', 'measured', 'failed', 'archived')),
  campaign_code text not null unique check (campaign_code ~ '^cnt-[a-z0-9]{6}$'),
  template_id text check (template_id is null or template_id ~ '^[a-z0-9-]{2,60}$'),
  ai_draft boolean not null default false,
  checklist jsonb not null default '{}' check (jsonb_typeof(checklist) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  blocking_issues integer not null default 0 check (blocking_issues >= 0),
  approved_hash text check (approved_hash is null or approved_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_handle text check (approved_by_handle is null or char_length(approved_by_handle) between 1 and 40),
  approved_at timestamptz,
  changes_note text check (changes_note is null or char_length(changes_note) <= 600),
  posts jsonb not null default '[]' check (jsonb_typeof(posts) = 'array' and octet_length(posts::text) <= 20000),
  failure text check (failure is null or char_length(failure) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_pieces_approval_pair check ((approved_hash is null) = (approved_at is null)),
  -- An approved, scheduled, posted or measured piece carries an approval of
  -- exactly what it says now, and no blocking issue.
  constraint content_pieces_approval_holds check (
    status not in ('approved', 'scheduled', 'posted', 'measured')
    or (approved_hash is not null and approved_hash = content_hash and blocking_issues = 0)
  )
);

create index content_pieces_status_idx on public.content_pieces (status);
create index content_pieces_due_idx on public.content_pieces (due_date) where due_date is not null;

create table public.content_assets (
  id text primary key check (id ~ '^as_[a-z0-9]{6,40}$'),
  piece_id text not null references public.content_pieces (id) on delete restrict,
  kind text not null check (kind in ('upload', 'url')),
  ref text not null check (
    char_length(ref) <= 600
    and ((kind = 'upload' and ref ~ '^[a-z0-9_]+/[a-z0-9_.-]+$') or (kind = 'url' and ref ~ '^https://'))
  ),
  name text not null check (char_length(name) between 1 and 160),
  media_type text check (media_type is null or media_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'video/quicktime', 'video/webm')),
  bytes bigint check (bytes is null or (bytes between 1 and 524288000)),
  alt_text text not null default '' check (char_length(alt_text) <= 500),
  added_by uuid references auth.users (id) on delete set null,
  added_by_handle text not null check (char_length(added_by_handle) between 1 and 40),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint content_assets_upload_fields check (kind <> 'upload' or (media_type is not null and bytes is not null))
);

create index content_assets_piece_idx on public.content_assets (piece_id);

create table public.content_events (
  id uuid primary key default gen_random_uuid(),
  piece_id text not null references public.content_pieces (id) on delete restrict,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_handle text not null check (char_length(actor_handle) between 1 and 40),
  kind text not null check (kind in (
    'created', 'edited', 'moved', 'submitted', 'checked', 'approved', 'approval_reset', 'changes_requested',
    'posted', 'scheduled', 'schedule_cancelled', 'result_added', 'asset_added', 'asset_removed', 'archived', 'restored', 'failed'
  )),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) <= 1000),
  hash text check (hash is null or hash ~ '^[0-9a-f]{64}$'),
  blocking integer check (blocking is null or blocking >= 0)
);

create index content_events_piece_idx on public.content_events (piece_id, at);

create table public.content_results (
  id uuid primary key default gen_random_uuid(),
  piece_id text not null references public.content_pieces (id) on delete restrict,
  channel text not null check (channel in ('instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp', 'partners', 'email', 'website')),
  source text not null check (source in ('manual', 'meta', 'tiktok', 'youtube')),
  at timestamptz not null default now(),
  -- {"views": 1200, "leads": 3}: only what was measured; whole numbers from 0.
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object' and metrics <> '{}'::jsonb and octet_length(metrics::text) <= 1000),
  note text check (note is null or char_length(note) <= 300),
  entered_by uuid references auth.users (id) on delete set null,
  entered_by_handle text not null check (char_length(entered_by_handle) between 1 and 40)
);

create index content_results_piece_idx on public.content_results (piece_id, at);

create table public.content_settings (
  id boolean primary key default true check (id),
  publishing_enabled boolean not null default false,
  channels jsonb not null default '{"facebook": false, "instagram": false, "tiktok": false, "youtube": false}'
    check (jsonb_typeof(channels) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_handle text check (updated_by_handle is null or char_length(updated_by_handle) between 1 and 40)
);

insert into public.content_settings (id) values (true);

create table public.content_connections (
  provider text primary key check (provider in ('meta', 'tiktok', 'youtube')),
  -- Ids and names only (Page, Instagram account, channel): never a token.
  account jsonb not null default '{}' check (jsonb_typeof(account) = 'object' and octet_length(account::text) <= 2000),
  scopes text[] not null default '{}',
  -- AES-256-GCM, written by the server: "v1.<iv>.<tag>.<ciphertext>".
  token_enc text not null check (token_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  refresh_enc text check (refresh_enc is null or refresh_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'expired', 'error')),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  connected_by uuid references auth.users (id) on delete set null,
  connected_by_handle text not null check (char_length(connected_by_handle) between 1 and 40),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_schedules (
  id uuid primary key default gen_random_uuid(),
  piece_id text not null references public.content_pieces (id) on delete restrict,
  channel text not null check (channel in ('facebook', 'instagram', 'tiktok', 'youtube')),
  lang text not null check (lang in ('en', 'es')),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'retry', 'publishing', 'posted', 'failed', 'cancelled')),
  approval_hash text not null check (approval_hash ~ '^[0-9a-f]{64}$'),
  publish_key text not null check (char_length(publish_key) between 10 and 200),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null,
  claimed_at timestamptz,
  posted_at timestamptz,
  external_id text check (external_id is null or char_length(external_id) <= 200),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  note text check (note is null or char_length(note) <= 300),
  metrics_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live schedule per approved content and channel: never posted twice.
create unique index content_schedules_publish_key on public.content_schedules (publish_key) where status not in ('cancelled', 'failed');
create index content_schedules_due_idx on public.content_schedules (next_attempt_at) where status in ('scheduled', 'retry');

create table public.content_publish_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  schedule_id uuid references public.content_schedules (id) on delete restrict,
  piece_id text references public.content_pieces (id) on delete restrict,
  channel text check (channel is null or channel in ('facebook', 'instagram', 'tiktok', 'youtube')),
  event text not null check (event in (
    'scheduled', 'held', 'claimed', 'sent', 'posted', 'retry', 'failed', 'cancelled', 'blocked', 'metrics',
    'settings_changed', 'connected', 'disconnected'
  )),
  actor uuid references auth.users (id) on delete set null,
  -- A person's handle, or 'system' for the scheduler.
  actor_handle text not null check (char_length(actor_handle) between 1 and 40),
  approved_by_handle text,
  approval_hash text check (approval_hash is null or approval_hash ~ '^[0-9a-f]{64}$'),
  -- What was sent (the text, the files' ids), and what came back, trimmed. Never a token.
  payload jsonb check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 12000)),
  response jsonb check (response is null or (jsonb_typeof(response) = 'object' and octet_length(response::text) <= 4000)),
  note text check (note is null or char_length(note) <= 500)
);

create index content_publish_log_piece_idx on public.content_publish_log (piece_id, at);

-- ── Who reads ───────────────────────────────────────────────────────────

alter table public.content_pieces enable row level security;
alter table public.content_assets enable row level security;
alter table public.content_events enable row level security;
alter table public.content_results enable row level security;
alter table public.content_settings enable row level security;
alter table public.content_connections enable row level security;
alter table public.content_schedules enable row level security;
alter table public.content_publish_log enable row level security;

create policy "content team reads pieces" on public.content_pieces
  for select using (public.staff_role() in ('admin', 'specialist'));
-- Sales: approved partner material only, to see and copy.
create policy "sales reads approved partner material" on public.content_pieces
  for select using (
    public.staff_role() = 'sales'
    and (audience = 'partners' or type = 'partner')
    and status in ('approved', 'scheduled', 'posted', 'measured')
  );
-- A file is readable with its piece (the subquery applies the piece's policies).
create policy "content files with their piece" on public.content_assets
  for select using (public.is_staff() and exists (select 1 from public.content_pieces p where p.id = piece_id));
create policy "content team reads history" on public.content_events
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads results" on public.content_results
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads publishing settings" on public.content_settings
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads schedules" on public.content_schedules
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads the publish log" on public.content_publish_log
  for select using (public.staff_role() in ('admin', 'specialist'));
-- content_connections: no policy. Only the server reads the encrypted tokens.

-- ── The approval rule, again in the database ────────────────────────────

-- A piece is never deleted (archived instead). When its words, links,
-- channels, type, language or characters change, its hash must change too,
-- and an approval of the old hash is dropped: the piece goes back to review.
create function public.content_pieces_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'content_pieces: a piece is archived, never deleted';
  end if;
  if (new.copy, new.links, new.channels, new.type, new.language, new.characters)
     is distinct from (old.copy, old.links, old.channels, old.type, old.language, old.characters)
     and new.content_hash = old.content_hash then
    raise exception 'content_pieces: the content changed, so content_hash must change with it';
  end if;
  if new.approved_hash is not null and new.approved_hash <> new.content_hash then
    new.approved_hash := null;
    new.approved_at := null;
    new.approved_by := null;
    new.approved_by_handle := null;
    if new.status in ('approved', 'scheduled', 'failed') then
      new.status := 'review';
    end if;
  end if;
  if new.campaign_code <> old.campaign_code or new.created_at <> old.created_at then
    raise exception 'content_pieces: the campaign code and creation date never change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.content_pieces_guard() from public;

create trigger content_pieces_guard
  before update or delete on public.content_pieces
  for each row execute function public.content_pieces_guard();

-- A file added, changed (alt text) or removed changes what would be published:
-- an approval of the piece is dropped (the server then stores the new hash).
create function public.content_assets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'content_assets: a file is marked removed, never deleted';
  end if;
  if tg_op = 'UPDATE' and (new.piece_id, new.kind, new.ref, new.media_type, new.bytes, new.added_at)
     is distinct from (old.piece_id, old.kind, old.ref, old.media_type, old.bytes, old.added_at) then
    raise exception 'content_assets: only the alt text and the removal can change';
  end if;
  if exists (select 1 from public.content_pieces where id = new.piece_id and status in ('posted', 'measured')) then
    raise exception 'content_assets: the piece is already posted; its files no longer change';
  end if;
  update public.content_pieces
     set approved_hash = null, approved_at = null, approved_by = null, approved_by_handle = null,
         status = case when status in ('approved', 'scheduled', 'failed') then 'review' else status end
   where id = new.piece_id and approved_hash is not null;
  return new;
end;
$$;

revoke all on function public.content_assets_guard() from public;

create trigger content_assets_guard
  before insert or update or delete on public.content_assets
  for each row execute function public.content_assets_guard();

-- History, results and the publish log are records: never changed or deleted.
create function public.content_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a record cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.content_records_append_only() from public;

create trigger content_events_append_only
  before update or delete on public.content_events
  for each row execute function public.content_records_append_only();
create trigger content_results_append_only
  before update or delete on public.content_results
  for each row execute function public.content_records_append_only();
create trigger content_publish_log_append_only
  before update or delete on public.content_publish_log
  for each row execute function public.content_records_append_only();

create function public.content_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'content_settings: the setting is kept; change it instead';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.content_settings_guard() from public;

create trigger content_settings_guard
  before update or delete on public.content_settings
  for each row execute function public.content_settings_guard();

-- A schedule is accepted only for a piece approved for exactly this content
-- with no blocking issue; it only moves forward, and is never deleted.
create function public.content_schedules_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  piece public.content_pieces%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'content_schedules: a schedule is cancelled, never deleted';
  end if;
  if tg_op = 'INSERT' then
    select * into piece from public.content_pieces where id = new.piece_id;
    if piece.id is null
       or piece.status not in ('approved', 'scheduled', 'posted', 'measured', 'failed')
       or piece.approved_hash is distinct from new.approval_hash
       or piece.blocking_issues > 0
       or not (new.channel = any (piece.channels)) then
      raise exception 'content_schedules: only an approved piece, as approved, on one of its channels, can be scheduled';
    end if;
    if new.status <> 'scheduled' then
      raise exception 'content_schedules: a schedule starts as scheduled';
    end if;
    return new;
  end if;
  if new.piece_id <> old.piece_id or new.channel <> old.channel or new.approval_hash <> old.approval_hash or new.publish_key <> old.publish_key then
    raise exception 'content_schedules: what is scheduled never changes; cancel and schedule again';
  end if;
  if old.status in ('posted', 'failed', 'cancelled') and new.status <> old.status then
    raise exception 'content_schedules: % is final', old.status;
  end if;
  if new.status <> old.status and not (
    (old.status in ('scheduled', 'retry') and new.status in ('publishing', 'cancelled', 'failed'))
    or (old.status = 'publishing' and new.status in ('posted', 'retry', 'failed'))
  ) then
    raise exception 'content_schedules: cannot go from % to %', old.status, new.status;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.content_schedules_guard() from public;

create trigger content_schedules_guard
  before insert or update or delete on public.content_schedules
  for each row execute function public.content_schedules_guard();

-- Files: a private bucket, no policy. Only the server writes, reads and hands
-- out short-lived signed links (an upload link for one file, a view link).
-- On Supabase the bucket also enforces the size and the types allowed.
insert into storage.buckets (id, name, public) values ('content-assets', 'content-assets', false)
  on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $sql$
      update storage.buckets
         set file_size_limit = 524288000,
             allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'video/quicktime', 'video/webm']
       where id = 'content-assets'
    $sql$;
  end if;
end;
$$;

-- ===== 0036_accounting.sql =====
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

-- ===== 0038_video.sql =====
-- The Video Studio (/equipo/video, src/lib/video, docs/VIDEO.md): short
-- social videos and ads, planned, edited in the browser, checked, approved
-- and handed to a Content piece (which posts them through the existing
-- publishing, migration 0035).
--
--   video_projects  One row per video: the brief, the plan (script, shots, the
--                   post's words), the media it uses, the edit decisions (the
--                   timeline, words on screen, captions, logo, cards, music,
--                   Alti's overlay) as JSON so it can be reopened, the
--                   checklist, whether a client appears and the consents on
--                   record, the hash of what it is now (project_hash, computed
--                   by the server) and the approval (approved_hash). Never
--                   deleted: archived.
--   video_exports   Every MP4 rendered (in the browser) and kept in the
--                   private bucket, with the project hash it was rendered
--                   from. A video is ready or approved only with an export of
--                   exactly what it is now. Append-only.
--   video_music     The team's music library: each track with WHO confirmed
--                   the rights to use it, WHEN, and a note (licence, source).
--                   No confirmation, no track. Removed by marking.
--   video_events    The history: created, edited, exported, submitted,
--                   approved, approval reset, changes requested, handed to
--                   Content. Append-only.
--
-- Who reads (row level security): administrators and specialists (the
-- content team: content.view in src/lib/staff/permissions.ts). Sales,
-- clients, partners and anyone signed out read nothing. Every write is the
-- server's (service role) after the caller's capability is checked
-- (content.edit; approval content.approve); the triggers below hold the
-- approval rule and the append-only records again.
--
-- Files: the private bucket "video-studio" (clips, pictures, music, exports).
-- The content team may read and add files there with their own session;
-- nobody else, and nobody changes or deletes a file but the server.

create table public.video_projects (
  id text primary key check (id ~ '^[a-z]{2}_[a-z0-9]{6,40}$'),
  title text not null check (char_length(title) between 2 and 120),
  status text not null default 'planned' check (status in ('planned', 'editing', 'ready', 'approved', 'published', 'archived')),
  language text not null check (language in ('en', 'es')),
  brief jsonb not null default '{}' check (jsonb_typeof(brief) = 'object' and octet_length(brief::text) <= 12000),
  plan jsonb not null default '{}' check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 40000),
  media jsonb not null default '[]' check (jsonb_typeof(media) = 'array' and octet_length(media::text) <= 40000),
  edit jsonb not null default '{}' check (jsonb_typeof(edit) = 'object' and octet_length(edit::text) <= 200000),
  checklist jsonb not null default '{}' check (jsonb_typeof(checklist) = 'object'),
  client_appears boolean,
  consents jsonb not null default '[]' check (jsonb_typeof(consents) = 'array' and octet_length(consents::text) <= 20000),
  project_hash text not null check (project_hash ~ '^[0-9a-f]{64}$'),
  blocking_issues integer not null default 0 check (blocking_issues >= 0),
  approved_hash text check (approved_hash is null or approved_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_handle text check (approved_by_handle is null or char_length(approved_by_handle) between 1 and 40),
  approved_at timestamptz,
  changes_note text check (changes_note is null or char_length(changes_note) <= 600),
  content_piece_id text references public.content_pieces (id) on delete restrict,
  brief_ref text check (brief_ref is null or char_length(brief_ref) <= 80),
  owner text check (owner is null or owner ~ '^[a-z0-9._-]{1,40}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_projects_approval_pair check ((approved_hash is null) = (approved_at is null)),
  -- Approved and published carry an approval of exactly what the video is now, with no blocking issue.
  constraint video_projects_approval_holds check (
    status not in ('approved', 'published')
    or (approved_hash is not null and approved_hash = project_hash and blocking_issues = 0)
  ),
  -- Published means handed to a Content piece.
  constraint video_projects_published_piece check (status <> 'published' or content_piece_id is not null)
);

create index video_projects_status_idx on public.video_projects (status);
-- The same Ads Manager brief is not turned into two live videos.
create unique index video_projects_brief_ref on public.video_projects (brief_ref) where brief_ref is not null and status <> 'archived';

create table public.video_exports (
  id text primary key check (id ~ '^ex_[a-z0-9]{6,40}$'),
  project_id text not null references public.video_projects (id) on delete restrict,
  path text not null check (path ~ '^[a-z0-9_]+/[a-z0-9_.-]+$' and char_length(path) <= 300),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 16 and 4096),
  height integer not null check (height between 16 and 4096),
  duration numeric(8, 3) not null check (duration > 0 and duration <= 600),
  bytes bigint not null check (bytes between 1 and 524288000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  created_at timestamptz not null default now()
);

create index video_exports_project_idx on public.video_exports (project_id, created_at);

create table public.video_music (
  id text primary key check (id ~ '^mu_[a-z0-9]{6,40}$'),
  name text not null check (char_length(name) between 1 and 160),
  path text not null check (path ~ '^[a-z0-9_]+/[a-z0-9_.-]+$' and char_length(path) <= 300),
  media_type text not null check (media_type in ('audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm')),
  bytes bigint not null check (bytes between 1 and 31457280),
  duration numeric(8, 3) check (duration is null or duration > 0),
  -- The rights: who said the team may use it, when, and on what basis. Required.
  rights_confirmed_by uuid references auth.users (id) on delete set null,
  rights_confirmed_by_handle text not null check (char_length(rights_confirmed_by_handle) between 1 and 40),
  rights_confirmed_at timestamptz not null default now(),
  rights_note text not null default '' check (char_length(rights_note) <= 300),
  added_at timestamptz not null default now(),
  removed_at timestamptz
);

create table public.video_events (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.video_projects (id) on delete restrict,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_handle text not null check (char_length(actor_handle) between 1 and 40),
  kind text not null check (kind in (
    'created', 'edited', 'moved', 'exported', 'submitted', 'approved', 'approval_reset', 'changes_requested',
    'linked_piece', 'published', 'archived', 'restored'
  )),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) <= 1000),
  hash text check (hash is null or hash ~ '^[0-9a-f]{64}$')
);

create index video_events_project_idx on public.video_events (project_id, at);

-- ── Who reads ───────────────────────────────────────────────────────────

alter table public.video_projects enable row level security;
alter table public.video_exports enable row level security;
alter table public.video_music enable row level security;
alter table public.video_events enable row level security;

create policy "content team reads videos" on public.video_projects
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads exports" on public.video_exports
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads the music library" on public.video_music
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "content team reads video history" on public.video_events
  for select using (public.staff_role() in ('admin', 'specialist'));
-- No insert, update or delete policy: only the server writes.

-- ── The approval rule, again in the database ────────────────────────────

-- A video is never deleted (archived instead). When its edit, media, plan or
-- language change, its hash must change too; an approval of the old hash is
-- dropped and the video goes back to editing. Ready, approved and published
-- need an export of exactly what it is now. A published video no longer
-- changes, except to be archived.
create function public.video_projects_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'video_projects: a video is archived, never deleted';
  end if;
  if tg_op = 'UPDATE' then
    if (new.edit, new.media, new.plan, new.language) is distinct from (old.edit, old.media, old.plan, old.language)
       and new.project_hash = old.project_hash then
      raise exception 'video_projects: the video changed, so project_hash must change with it';
    end if;
    if old.status = 'published' and (new.project_hash <> old.project_hash or new.content_piece_id is distinct from old.content_piece_id) then
      raise exception 'video_projects: a published video no longer changes; duplicate it';
    end if;
    if new.created_at <> old.created_at or new.created_by_handle <> old.created_by_handle then
      raise exception 'video_projects: who made it and when never change';
    end if;
    new.updated_at := now();
  end if;
  if new.approved_hash is not null and new.approved_hash <> new.project_hash then
    new.approved_hash := null;
    new.approved_at := null;
    new.approved_by := null;
    new.approved_by_handle := null;
    if new.status in ('ready', 'approved') then
      new.status := 'editing';
    end if;
  end if;
  if new.status in ('ready', 'approved', 'published')
     and not exists (select 1 from public.video_exports e where e.project_id = new.id and e.hash = new.project_hash) then
    raise exception 'video_projects: % needs an export of exactly this version', new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.video_projects_guard() from public;

create trigger video_projects_guard
  before insert or update or delete on public.video_projects
  for each row execute function public.video_projects_guard();

-- History and exports are records: never changed or deleted.
create function public.video_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a record cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.video_records_append_only() from public;

create trigger video_events_append_only
  before update or delete on public.video_events
  for each row execute function public.video_records_append_only();
create trigger video_exports_append_only
  before update or delete on public.video_exports
  for each row execute function public.video_records_append_only();

-- A track's file and its rights record never change; it is only marked removed.
create function public.video_music_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'video_music: a track is marked removed, never deleted';
  end if;
  if (new.path, new.media_type, new.bytes, new.rights_confirmed_by, new.rights_confirmed_by_handle, new.rights_confirmed_at, new.rights_note, new.added_at)
     is distinct from (old.path, old.media_type, old.bytes, old.rights_confirmed_by, old.rights_confirmed_by_handle, old.rights_confirmed_at, old.rights_note, old.added_at) then
    raise exception 'video_music: only the name and the removal can change';
  end if;
  return new;
end;
$$;

revoke all on function public.video_music_guard() from public;

create trigger video_music_guard
  before update or delete on public.video_music
  for each row execute function public.video_music_guard();

-- ── Files ───────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values ('video-studio', 'video-studio', false)
  on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $sql$
      update storage.buckets
         set file_size_limit = 262144000,
             allowed_mime_types = array[
               'video/mp4', 'video/quicktime', 'video/webm',
               'image/jpeg', 'image/png', 'image/webp',
               'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm'
             ]
       where id = 'video-studio'
    $sql$;
  end if;
end;
$$;

-- The content team reads the files and may add new ones with their own
-- session; nobody else. No update or delete policy: only the server changes
-- or removes a file.
create policy "content team reads video files" on storage.objects
  for select using (bucket_id = 'video-studio' and public.staff_role() in ('admin', 'specialist'));
create policy "content team adds video files" on storage.objects
  for insert with check (bucket_id = 'video-studio' and public.staff_role() in ('admin', 'specialist'));
