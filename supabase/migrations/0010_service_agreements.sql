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
