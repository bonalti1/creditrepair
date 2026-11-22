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
