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
