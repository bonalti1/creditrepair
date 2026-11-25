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
