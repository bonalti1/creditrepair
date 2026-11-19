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
