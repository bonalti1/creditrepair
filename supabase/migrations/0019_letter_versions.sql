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
