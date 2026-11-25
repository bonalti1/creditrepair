-- 0041 Fulfillment: the client's notification settings, credit monitoring
-- tracking and its referral commissions, documents (more kinds, a person's
-- review with a reason the client sees, no Social Security card), and the
-- import from Credit Repair Cloud. docs/FULFILLMENT.md.
--
-- Row level security on every table. Clients and staff read; only the server
-- (service role, after requireCapability) writes. Records that are history
-- (a check, a review, a settings change, an import row) never change.

-- ── Helpers ─────────────────────────────────────────────────────────────

create function public.fulfillment_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: this record is kept as it was; it cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.fulfillment_append_only() from public;

-- An active administrator (the owner). Same rule as staff_can_see_accounting().
create function public.staff_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.staff_role() = 'admin', false);
$$;

revoke all on function public.staff_is_admin() from public;
grant execute on function public.staff_is_admin() to authenticated, anon;

-- ── 1. The client's notification settings ───────────────────────────────
-- Which channels carry automatic messages, and whether the optional ones
-- (reminders, progress updates) go at all. Required notices (money, and the
-- letters mailed in the client's name) always go on a chosen channel unless
-- the client opted out of every automatic message (message_opt_outs: STOP /
-- BAJA / the email link / "Stop all" here), which still wins over everything.

create table public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  whatsapp boolean not null default true,
  email boolean not null default true,
  reminders boolean not null default true,
  updates boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'client' check (updated_by in ('client', 'staff')),
  -- Required notices need a way to arrive. To stop everything, the client opts out (STOP).
  constraint notification_settings_one_channel check (whatsapp or email)
);

alter table public.notification_settings enable row level security;

create policy "own notification settings" on public.notification_settings
  for select using (auth.uid() = user_id);

create policy "staff read notification settings" on public.notification_settings
  for select using (public.staff_can_see_client(user_id));

-- Every change, as it was saved.
create table public.notification_setting_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  whatsapp boolean not null,
  email boolean not null,
  reminders boolean not null,
  updates boolean not null,
  by_kind text not null check (by_kind in ('client', 'staff')),
  by_user uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);

create index notification_setting_changes_user_idx on public.notification_setting_changes (user_id, at);

alter table public.notification_setting_changes enable row level security;

create policy "own notification changes" on public.notification_setting_changes
  for select using (auth.uid() = user_id);

create policy "staff read notification changes" on public.notification_setting_changes
  for select using (public.staff_can_see_client(user_id));

create trigger notification_setting_changes_append_only
  before update or delete on public.notification_setting_changes
  for each row execute function public.fulfillment_append_only();

-- "Stop all automatic messages" on the settings screen is an opt-out record like BAJA.
alter table public.message_opt_outs drop constraint message_opt_outs_channel_check;
alter table public.message_opt_outs add constraint message_opt_outs_channel_check check (channel in ('whatsapp', 'email', 'staff', 'app'));

-- ── 2. Credit monitoring: what the team checked ─────────────────────────
-- The provider gives us no status call (docs/IDENTITYIQ.md), so a person
-- records what they saw: the provider, whether the client enrolled through
-- our link, active / cancelled / unknown, the day and how it was checked.

create table public.monitoring_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('identityiq', 'other')),
  provider_name text check (provider_name is null or char_length(btrim(provider_name)) between 2 and 60),
  enrolled_via_link text not null check (enrolled_via_link in ('yes', 'no', 'unknown')),
  status text not null check (status in ('active', 'cancelled', 'unknown')),
  checked_on date not null,
  method text not null check (method in ('client_said', 'provider_portal', 'partner_statement', 'report_arrived', 'other')),
  note text not null default '' check (char_length(note) <= 300 and note !~ '[0-9]{3}-?[0-9]{2}-?[0-9]{4}'),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text not null default '' check (char_length(recorded_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint monitoring_checks_other_named check (provider <> 'other' or provider_name is not null),
  constraint monitoring_checks_not_future check (checked_on <= (created_at at time zone 'America/Chicago')::date)
);

create index monitoring_checks_user_idx on public.monitoring_checks (user_id, checked_on);

alter table public.monitoring_checks enable row level security;

create policy "staff read monitoring checks" on public.monitoring_checks
  for select using (public.staff_can_see_client(user_id));

create trigger monitoring_checks_append_only
  before update or delete on public.monitoring_checks
  for each row execute function public.fulfillment_append_only();

-- ── 3. Monitoring referral commissions ──────────────────────────────────
-- What the provider pays Credalti for a client who enrolled through our link,
-- by hand or from the partner statement's CSV. Administrators only; a client
-- or a partner never reads an amount. Posting to the books is a separate,
-- explicit step that adds ONE other_income row (kind monitoring_commission)
-- for the lines it covers: the books' money rule is read from there.

create table public.monitoring_commission_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_sha256 text not null unique check (file_sha256 ~ '^[0-9a-f]{64}$'),
  line_count integer not null check (line_count between 0 and 5000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now()
);

alter table public.monitoring_commission_imports enable row level security;

create policy "admins read commission imports" on public.monitoring_commission_imports
  for select using (public.staff_is_admin());

create trigger monitoring_commission_imports_append_only
  before update or delete on public.monitoring_commission_imports
  for each row execute function public.fulfillment_append_only();

create table public.monitoring_commissions (
  id uuid primary key default gen_random_uuid(),
  -- The client it was matched to; null while unmatched.
  user_id uuid references auth.users (id) on delete set null,
  provider text not null default 'identityiq' check (char_length(provider) between 2 and 60),
  -- The month the commission is for (the statement's period).
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_cents integer not null check (amount_cents between -10000000 and 10000000 and amount_cents <> 0),
  kind text not null check (kind in ('commission', 'reversal')),
  -- How the statement names the member (its member id or name), as written. Never an SSN.
  member_ref text not null default '' check (char_length(member_ref) <= 120 and member_ref !~ '[0-9]{3}-?[0-9]{2}-?[0-9]{4}'),
  -- The day the provider paid it, when known (cash basis: the books use this day).
  paid_on date,
  source text not null check (source in ('manual', 'csv')),
  import_id uuid references public.monitoring_commission_imports (id) on delete restrict,
  line_fingerprint text unique check (line_fingerprint is null or line_fingerprint ~ '^[0-9a-f]{64}$'),
  note text not null default '' check (char_length(note) <= 300),
  -- The books' row this line was posted with (one other_income row can carry many lines).
  posted_income_id uuid references public.other_income (id) on delete restrict,
  posted_at timestamptz,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 5 and 300),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  constraint monitoring_commissions_sign check ((kind = 'reversal') = (amount_cents < 0)),
  constraint monitoring_commissions_csv_import check ((source = 'csv') = (import_id is not null)),
  constraint monitoring_commissions_posted_pair check ((posted_income_id is null) = (posted_at is null)),
  constraint monitoring_commissions_void_pair check ((voided_at is null) = (void_reason is null)),
  constraint monitoring_commissions_not_posted_and_void check (posted_income_id is null or voided_at is null)
);

create index monitoring_commissions_month_idx on public.monitoring_commissions (month);
create index monitoring_commissions_user_idx on public.monitoring_commissions (user_id) where user_id is not null;

alter table public.monitoring_commissions enable row level security;

create policy "admins read monitoring commissions" on public.monitoring_commissions
  for select using (public.staff_is_admin());

-- Only three changes, each once: matching to a client (while not posted),
-- posting to the books, and voiding (while not posted). Amounts, months and
-- sources never change; nothing is deleted.
create function public.monitoring_commissions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'monitoring_commissions: a commission line is never deleted; void it with a reason';
  end if;
  if new.provider is distinct from old.provider or new.month is distinct from old.month or new.amount_cents is distinct from old.amount_cents
     or new.kind is distinct from old.kind or new.member_ref is distinct from old.member_ref or new.paid_on is distinct from old.paid_on
     or new.source is distinct from old.source or new.import_id is distinct from old.import_id or new.line_fingerprint is distinct from old.line_fingerprint
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'monitoring_commissions: the line is kept as recorded; void it and record it again';
  end if;
  if old.posted_income_id is not null and (new.posted_income_id is distinct from old.posted_income_id or new.user_id is distinct from old.user_id or new.voided_at is not null) then
    raise exception 'monitoring_commissions: this line is in the books already; correct it with an adjustment in Accounting';
  end if;
  if old.voided_at is not null and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason or new.posted_income_id is not null or new.user_id is distinct from old.user_id) then
    raise exception 'monitoring_commissions: a voided line stays voided';
  end if;
  return new;
end;
$$;

revoke all on function public.monitoring_commissions_guard() from public;

create trigger monitoring_commissions_guard
  before update or delete on public.monitoring_commissions
  for each row execute function public.monitoring_commissions_guard();

-- ── 4. Documents ────────────────────────────────────────────────────────
-- A Social Security card is never stored (attorney question: a "proof of
-- SSN seen" note is off too). The old kind stays in the check for history
-- only; nothing new may use it.

create function public.identity_documents_no_ssn_card()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'ssn_card' then
    raise exception 'identity_documents: Credalti does not keep a Social Security card';
  end if;
  return new;
end;
$$;

revoke all on function public.identity_documents_no_ssn_card() from public;

create trigger identity_documents_no_ssn_card
  before insert or update on public.identity_documents
  for each row execute function public.identity_documents_no_ssn_card();

-- The other documents a client may give the team (several of each): proof for
-- an item they disputed, a letter from a creditor or collector, court papers,
-- and the power of attorney / authorization (a slot that stays off until the
-- attorney approves its text: the route refuses it while
-- NEXT_PUBLIC_POA_APPROVED_VERSION is not POA_VERSION).
create table public.client_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('supporting_document', 'creditor_letter', 'court_record', 'power_of_attorney')),
  -- In the private bucket client-files, at {user_id}/{id}.{ext}. Only the server reads it (a 2-minute link for staff).
  storage_path text not null check (char_length(storage_path) between 10 and 200),
  file_name text not null default '' check (char_length(file_name) <= 120),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  bytes integer not null check (bytes between 1 and 20971520),
  -- The client's few words about it ("Letter from Midland saying it was paid").
  description text not null default '' check (char_length(description) <= 200 and description !~ '[0-9]{3}-?[0-9]{2}-?[0-9]{4}'),
  -- For the power of attorney: the version of the text the client signed with it.
  poa_version text check (poa_version is null or char_length(poa_version) between 4 and 40),
  uploaded_by text not null default 'client' check (uploaded_by in ('client', 'staff')),
  uploaded_at timestamptz not null default now(),
  -- The client can take one back (the file is then removed by the server).
  withdrawn_at timestamptz,
  constraint client_files_poa_version check ((kind = 'power_of_attorney') = (poa_version is not null))
);

create index client_files_user_idx on public.client_files (user_id, uploaded_at);

alter table public.client_files enable row level security;

create policy "own client files" on public.client_files
  for select using (auth.uid() = user_id);

create policy "staff read client files" on public.client_files
  for select using (public.staff_can_see_case(user_id));

create function public.client_files_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'client_files: a record stays; withdraw it instead';
  end if;
  if new.user_id is distinct from old.user_id or new.kind is distinct from old.kind or new.storage_path is distinct from old.storage_path
     or new.uploaded_at is distinct from old.uploaded_at or new.bytes is distinct from old.bytes or new.poa_version is distinct from old.poa_version
     or (old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at) then
    raise exception 'client_files: only a withdrawal can be recorded, once';
  end if;
  return new;
end;
$$;

revoke all on function public.client_files_guard() from public;

create trigger client_files_guard
  before update or delete on public.client_files
  for each row execute function public.client_files_guard();

insert into storage.buckets (id, name, public) values ('client-files', 'client-files', false)
  on conflict (id) do nothing;
-- No storage policy on purpose: only the server (service role) reads and writes the bucket.

-- A person's review of a document: accepted, or not accepted with a reason
-- the client sees (in their language) and a request to upload it again.
create table public.document_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('government_id', 'proof_of_address', 'identity_theft_report', 'supporting_document', 'creditor_letter', 'court_record', 'power_of_attorney')),
  -- client_files.id for those; null for identity_documents (one per kind: the upload as of uploaded_at).
  file_id uuid references public.client_files (id) on delete cascade,
  -- The upload this review is about (identity_documents.uploaded_at, or the file's).
  document_uploaded_at timestamptz not null,
  decision text not null check (decision in ('accepted', 'rejected')),
  reason_code text check (reason_code is null or reason_code in ('blurry', 'cut_off', 'expired', 'name_mismatch', 'address_mismatch', 'too_old', 'wrong_document', 'unreadable', 'other')),
  -- Extra words the client reads, already checked for promises and numbers by the server.
  note text not null default '' check (char_length(note) <= 300 and note !~ '[0-9]{3}-?[0-9]{2}-?[0-9]{4}'),
  ask_again boolean not null default false,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_by_name text not null default '' check (char_length(reviewed_by_name) <= 80),
  at timestamptz not null default now(),
  constraint document_reviews_reason check ((decision = 'rejected') = (reason_code is not null)),
  constraint document_reviews_other_has_words check (reason_code is distinct from 'other' or char_length(btrim(note)) >= 5),
  constraint document_reviews_ask_only_rejected check (not ask_again or decision = 'rejected')
);

create index document_reviews_user_idx on public.document_reviews (user_id, at);

alter table public.document_reviews enable row level security;

create policy "own document reviews" on public.document_reviews
  for select using (auth.uid() = user_id);

create policy "staff read document reviews" on public.document_reviews
  for select using (public.staff_can_see_client(user_id));

create trigger document_reviews_append_only
  before update or delete on public.document_reviews
  for each row execute function public.fulfillment_append_only();

-- ── 5. Importing from Credit Repair Cloud ───────────────────────────────
-- An administrator uploads CRC's export. SSN and date-of-birth columns are
-- dropped in the browser and again on the server, before anything is stored;
-- no table here has a column that could hold them. Imported people become
-- prospects with an invitation to finish onboarding in Credalti (they sign
-- Credalti's agreement; nothing is charged). One batch can be undone.

create table public.crc_import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('clients', 'leads', 'affiliates')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The column names that were dropped (names only, never a value).
  dropped_columns text[] not null default '{}',
  -- Which column fed which field (column names only).
  mapping jsonb not null default '{}' check (jsonb_typeof(mapping) = 'object' and octet_length(mapping::text) <= 8000),
  row_count integer not null check (row_count between 0 and 5000),
  created_count integer not null default 0 check (created_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_name text check (undone_by_name is null or char_length(undone_by_name) <= 80),
  -- What the undo could not remove (people who already have an account or were invited).
  undo_kept integer check (undo_kept is null or undo_kept >= 0),
  constraint crc_import_batches_undo_pair check ((undone_at is null) = (undo_kept is null))
);

-- The same file is imported once (an undone batch frees it).
create unique index crc_import_batches_one_file on public.crc_import_batches (kind, file_sha256) where undone_at is null;

alter table public.crc_import_batches enable row level security;

create policy "admins read crc imports" on public.crc_import_batches
  for select using (public.staff_is_admin());

create function public.crc_import_batches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'crc_import_batches: the import log is kept';
  end if;
  if old.undone_at is not null then
    raise exception 'crc_import_batches: this batch was already undone';
  end if;
  if new.kind is distinct from old.kind or new.file_sha256 is distinct from old.file_sha256 or new.row_count is distinct from old.row_count
     or new.created_at is distinct from old.created_at or new.dropped_columns is distinct from old.dropped_columns or new.mapping is distinct from old.mapping then
    raise exception 'crc_import_batches: only the counts and the undo are recorded after the import';
  end if;
  return new;
end;
$$;

revoke all on function public.crc_import_batches_guard() from public;

create trigger crc_import_batches_guard
  before update or delete on public.crc_import_batches
  for each row execute function public.crc_import_batches_guard();

-- One line per row of the file: what happened to it. A short name only
-- (first name and last initial), so the log is readable without copying the file.
create table public.crc_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.crc_import_batches (id) on delete cascade,
  line integer not null check (line between 1 and 5001),
  outcome text not null check (outcome in ('created', 'duplicate', 'problem', 'skipped', 'undone', 'kept')),
  short_name text not null default '' check (char_length(short_name) <= 60),
  crc_status text check (crc_status is null or char_length(crc_status) <= 40),
  reasons text[] not null default '{}',
  prospect_id uuid references public.prospects (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, line)
);

alter table public.crc_import_rows enable row level security;

create policy "admins read crc import rows" on public.crc_import_rows
  for select using (public.staff_is_admin());

-- Affiliates from CRC become an invitation to apply as a Credalti partner:
-- they still accept Credalti's partner rules themselves (partners needs that).
create table public.crc_affiliate_invites (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.crc_import_batches (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  company text check (company is null or char_length(company) <= 120),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  constraint crc_affiliate_invites_contact check (phone_e164 is not null or email is not null)
);

alter table public.crc_affiliate_invites enable row level security;

create policy "admins read crc affiliate invites" on public.crc_affiliate_invites
  for select using (public.staff_is_admin());

alter table public.prospects drop constraint prospects_source_check;
alter table public.prospects add constraint prospects_source_check check (source in ('manual', 'highlevel', 'partner', 'household', 'crc_import'));
alter table public.prospects add column import_batch_id uuid references public.crc_import_batches (id) on delete set null;
create index prospects_import_batch_idx on public.prospects (import_batch_id) where import_batch_id is not null;

-- The lead inbox (0034) copies the prospect's source.
alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check check (source in ('whatsapp', 'highlevel', 'partner', 'signup_chat', 'manual', 'household', 'crc_import'));
