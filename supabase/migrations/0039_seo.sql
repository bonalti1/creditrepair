-- The SEO department (/equipo/seo, src/lib/seo, docs/SEO.md): the guides
-- published at /guias/<slug>, the phrases the site wants to be found for,
-- Search Console numbers, the site-health result and the local checklist.
--
--   seo_guides        One row per guide: the working copy (both languages'
--                     words, the sources, the person's ticks, the hash of what
--                     it says now) and, once published, the published version
--                     (`published`, a snapshot of exactly what was approved).
--                     The site shows only `published`. Never deleted: archived.
--   seo_guide_events  The guide's history. Append-only.
--   seo_keywords      Tracked phrases, English or Spanish, statewide or for a
--                     Texas city, each with the page meant to answer it.
--                     Removed by marking.
--   seo_search_rows   Search Console's numbers, one row per day, page and
--                     query (read-only from Google; the cron writes them).
--   seo_settings      One row: the last site-health result, the last Search
--                     Console sync and the local checklist's ticks.
--
-- Who reads (row level security): administrators and specialists
-- (seo.view in src/lib/staff/permissions.ts). Sales, clients, partners and
-- anyone signed out read none of these tables. Every write is the server's
-- (service role), after the caller's capability is checked.
--
-- The public website reads published guides only through two functions
-- (seo_published_guides, seo_published_guide): security definer, returning
-- the published snapshot and nothing else (no drafts, no notes, no handles).

create table public.seo_guides (
  id text primary key check (id ~ '^gd_[a-z0-9_]{3,60}$'),
  slug text not null unique check (char_length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'draft' check (status in ('draft', 'review', 'changes', 'approved', 'published', 'archived')),
  topic text not null check (char_length(topic) between 3 and 160),
  brief text not null default '' check (char_length(brief) <= 1200),
  phrase jsonb not null default '{"en": "", "es": ""}' check (jsonb_typeof(phrase) = 'object'),
  body jsonb not null check (jsonb_typeof(body) = 'object' and body ? 'en' and body ? 'es' and octet_length(body::text) <= 200000),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array' and octet_length(sources::text) <= 20000),
  checklist jsonb not null default '{}' check (jsonb_typeof(checklist) = 'object'),
  ai_draft boolean not null default false,
  sample boolean not null default false,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  blocking_issues integer not null default 0 check (blocking_issues >= 0),
  approved_hash text check (approved_hash is null or approved_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_handle text check (approved_by_handle is null or char_length(approved_by_handle) between 1 and 40),
  approved_at timestamptz,
  published jsonb check (published is null or (jsonb_typeof(published) = 'object' and octet_length(published::text) <= 220000)),
  published_hash text check (published_hash is null or published_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  first_published_at timestamptz,
  changes_note text check (changes_note is null or char_length(changes_note) <= 600),
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_guides_approval_pair check ((approved_hash is null) = (approved_at is null)),
  constraint seo_guides_published_fields check ((published is null) = (published_hash is null) and (published is null) = (published_at is null)),
  -- "Live on the site" is the working copy published exactly as approved, with no blocking issue.
  constraint seo_guides_published_holds check (
    status <> 'published'
    or (published is not null and published_hash = content_hash and approved_hash = content_hash and blocking_issues = 0)
  ),
  constraint seo_guides_archived_offline check (status <> 'archived' or published is null),
  constraint seo_guides_published_slug check (published is null or published ->> 'slug' = slug)
);

create index seo_guides_status_idx on public.seo_guides (status);

create table public.seo_guide_events (
  id uuid primary key default gen_random_uuid(),
  guide_id text not null references public.seo_guides (id) on delete restrict,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_handle text not null check (char_length(actor_handle) between 1 and 40),
  kind text not null check (kind in ('created', 'edited', 'drafted', 'submitted', 'changes_requested', 'approved', 'published', 'unpublished', 'archived', 'restored', 'approval_reset')),
  note text check (note is null or char_length(note) <= 1000),
  hash text check (hash is null or hash ~ '^[0-9a-f]{64}$')
);

create index seo_guide_events_guide_idx on public.seo_guide_events (guide_id, at);

create table public.seo_keywords (
  id text primary key check (id ~ '^kw_[a-z0-9_]{3,60}$'),
  phrase text not null check (char_length(phrase) between 3 and 100),
  lang text not null check (lang in ('en', 'es')),
  -- Texas only (src/lib/seo/keywords.ts TEXAS_CITIES): a city elsewhere is refused.
  city text check (city is null or city in (
    'Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo',
    'Lubbock', 'Irving', 'Garland', 'Frisco', 'McKinney', 'Amarillo', 'Grand Prairie', 'Brownsville', 'Killeen', 'Pasadena',
    'McAllen', 'Mesquite', 'Denton', 'Waco', 'Midland', 'Odessa', 'Beaumont', 'Round Rock', 'Edinburg', 'Harlingen',
    'Mission', 'Pharr', 'Tyler', 'College Station', 'Abilene', 'San Angelo', 'Wichita Falls', 'Sugar Land', 'Pearland', 'Conroe',
    'Katy', 'Baytown', 'Richardson', 'Carrollton', 'Lewisville', 'Allen'
  )),
  -- Georgia never, in any phrase.
  constraint seo_keywords_not_georgia check (phrase !~* '\mgeorgia\M|\matlanta\M'),
  target_path text check (target_path is null or (target_path ~ '^/[a-z0-9/-]*$' and char_length(target_path) <= 120)),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

create unique index seo_keywords_live_phrase on public.seo_keywords (lower(phrase), lang, coalesce(city, '')) where removed_at is null;

create table public.seo_search_rows (
  day date not null,
  page text not null check (char_length(page) <= 600),
  query text not null check (char_length(query) <= 300),
  clicks integer not null default 0 check (clicks >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  position numeric(7, 2) not null check (position >= 0),
  synced_at timestamptz not null default now(),
  primary key (day, page, query)
);

create index seo_search_rows_day_idx on public.seo_search_rows (day);

create table public.seo_settings (
  id boolean primary key default true check (id),
  health jsonb check (health is null or (jsonb_typeof(health) = 'object' and octet_length(health::text) <= 400000)),
  health_checked_at timestamptz,
  search_synced_at timestamptz,
  search_sync_error text check (search_sync_error is null or char_length(search_sync_error) <= 500),
  search_rows_synced integer check (search_rows_synced is null or search_rows_synced >= 0),
  local_ticks jsonb not null default '{}' check (jsonb_typeof(local_ticks) = 'object' and octet_length(local_ticks::text) <= 20000),
  updated_at timestamptz not null default now()
);

insert into public.seo_settings (id) values (true) on conflict do nothing;

-- ── Who reads ───────────────────────────────────────────────────────────

alter table public.seo_guides enable row level security;
alter table public.seo_guide_events enable row level security;
alter table public.seo_keywords enable row level security;
alter table public.seo_search_rows enable row level security;
alter table public.seo_settings enable row level security;

create policy "seo team reads guides" on public.seo_guides
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "seo team reads guide history" on public.seo_guide_events
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "seo team reads phrases" on public.seo_keywords
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "seo team reads search numbers" on public.seo_search_rows
  for select using (public.staff_role() in ('admin', 'specialist'));
create policy "seo team reads settings" on public.seo_settings
  for select using (public.staff_role() in ('admin', 'specialist'));

-- ── The public path: published guides only ──────────────────────────────

-- Every live guide's published version (what the site and the sitemap show).
create function public.seo_published_guides()
returns table (slug text, published jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug, g.published
    from public.seo_guides g
   where g.published is not null and g.status <> 'archived'
   order by g.first_published_at desc nulls last;
$$;

-- One live guide by its address, or null.
create function public.seo_published_guide(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select g.published
    from public.seo_guides g
   where g.slug = p_slug and g.published is not null and g.status <> 'archived';
$$;

revoke all on function public.seo_published_guides() from public;
revoke all on function public.seo_published_guide(text) from public;
grant execute on function public.seo_published_guides() to anon, authenticated;
grant execute on function public.seo_published_guide(text) to anon, authenticated;

-- ── The approval rule, again in the database ────────────────────────────

-- A guide is archived, never deleted. When its words, sources or address
-- change, its hash must change too; an approval of the old hash is dropped
-- and the working copy goes back to draft (the published version stays live
-- until a newer approved one replaces it). A new published version must be
-- the approved one, and a live guide's address never changes.
create function public.seo_guides_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'seo_guides: a guide is archived, never deleted';
  end if;
  if (new.body, new.sources, new.slug) is distinct from (old.body, old.sources, old.slug) and new.content_hash = old.content_hash then
    raise exception 'seo_guides: the content changed, so content_hash must change with it';
  end if;
  if new.slug <> old.slug and old.published is not null then
    raise exception 'seo_guides: the address of a live guide never changes';
  end if;
  if new.approved_hash is not null and new.approved_hash <> new.content_hash then
    new.approved_hash := null;
    new.approved_at := null;
    new.approved_by := null;
    new.approved_by_handle := null;
    if new.status in ('approved', 'published', 'changes') then
      new.status := 'draft';
    end if;
  end if;
  if new.published_hash is distinct from old.published_hash and new.published_hash is not null
     and (new.approved_hash is null or new.published_hash <> new.approved_hash) then
    raise exception 'seo_guides: only the approved version can be published';
  end if;
  if new.created_at <> old.created_at or (old.first_published_at is not null and new.first_published_at is distinct from old.first_published_at) then
    raise exception 'seo_guides: the creation and first publication dates never change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.seo_guides_guard() from public;

create trigger seo_guides_guard
  before update or delete on public.seo_guides
  for each row execute function public.seo_guides_guard();

-- A new guide starts unapproved and unpublished.
create function public.seo_guides_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.published is not null or new.approved_hash is not null or new.status in ('approved', 'published') then
    raise exception 'seo_guides: a new guide starts as a draft, unpublished';
  end if;
  return new;
end;
$$;

revoke all on function public.seo_guides_insert_guard() from public;

create trigger seo_guides_insert_guard
  before insert on public.seo_guides
  for each row execute function public.seo_guides_insert_guard();

create function public.seo_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: append-only', tg_table_name;
end;
$$;

revoke all on function public.seo_records_append_only() from public;

create trigger seo_guide_events_append_only
  before update or delete on public.seo_guide_events
  for each row execute function public.seo_records_append_only();
