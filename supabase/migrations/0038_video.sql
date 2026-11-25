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
