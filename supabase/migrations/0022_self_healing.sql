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
