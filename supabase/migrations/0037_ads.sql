-- The Ads Manager (/equipo/anuncios; src/lib/ads; docs/ADS.md): Meta ads,
-- READ ONLY, joined to Credalti's own leads and signed clients.
--
--   ads_accounts         The ad account the sync reads (META_AD_ACCOUNT_ID):
--                        its name, currency, time zone and Meta's status.
--   ads_objects          Its campaigns, ad sets and ads, as Meta last
--                        described them: names, delivery status, objective,
--                        the Special Ad Categories a campaign declared, an ad
--                        set's goal (what Meta counts as a "result"), and an
--                        ad's creative (headline, primary text, thumbnail,
--                        video id, button, link). No personal data: Meta's
--                        insights are aggregates.
--   ads_insights_daily   One row per ad per day (the AD ACCOUNT's days):
--                        spend in cents, impressions, link clicks and Meta's
--                        results. Re-pulled for the last days on each sync
--                        (Meta revises recent numbers), so upserted.
--   ads_sync_runs        Every sync: when, which days, how many rows, and the
--                        error when it failed. Append-only.
--   ads_briefs           Video briefs made from an ad copy draft by Alti
--                        (AI), for Video Studio (/equipo/video): the words in
--                        both languages, the checklist's result, who asked.
--
-- And, for crediting leads to ads (docs/ADS.md, "Where each number comes
-- from"):
--   signup_cases.attribution  An ad link's marketing tags (utm_*, the ad,
--                        ad set and campaign ids, and whether a Facebook click
--                        id was present: never its value), sent by the chat
--                        signup's first call and copied into the lead's first
--                        touch when the signup reaches a phone.
--
-- Who reads (row level security): the ad account, the campaigns, the numbers
-- and the sync runs are for administrators only (ads.view in
-- src/lib/staff/permissions.ts: spend is money, and sales never sees money).
-- The briefs are for administrators and specialists (ads.draft: the content
-- team). Clients, partners, sales and anyone signed out read nothing. Who
-- writes: only the server with the service role, after requireCapability
-- (the routes) or the shared secret (the cron); there is no insert, update or
-- delete policy for anyone. Nothing here can change Meta: the token the sync
-- uses only reads (ads_read).

-- ── The ad account and what is in it ────────────────────────────────────

create table public.ads_accounts (
  id text primary key check (id ~ '^act_[0-9]{3,25}$'),
  platform text not null default 'meta' check (platform = 'meta'),
  name text not null check (char_length(name) between 1 and 120),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'America/Chicago' check (char_length(time_zone) between 3 and 60),
  status text not null default 'unknown' check (status in ('active', 'disabled', 'unsettled', 'review', 'grace', 'closing', 'closed', 'unknown')),
  status_code integer,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.ads_objects (
  id text primary key check (id ~ '^[0-9]{3,25}$'),
  account_id text not null references public.ads_accounts (id) on delete restrict,
  level text not null check (level in ('campaign', 'adset', 'ad')),
  campaign_id text check (campaign_id is null or campaign_id ~ '^[0-9]{3,25}$'),
  adset_id text check (adset_id is null or adset_id ~ '^[0-9]{3,25}$'),
  name text not null check (char_length(name) between 1 and 200),
  -- Meta's effective_status (ACTIVE, PAUSED, CAMPAIGN_PAUSED, ARCHIVED, WITH_ISSUES…).
  status text not null check (status ~ '^[A-Z_]{2,40}$'),
  objective text check (objective is null or objective ~ '^[A-Z_]{2,40}$'),
  special_ad_categories text[] not null default '{}',
  optimization_goal text check (optimization_goal is null or optimization_goal ~ '^[A-Z_]{2,40}$'),
  result_action text check (result_action is null or char_length(result_action) <= 80),
  result_kind text check (result_kind is null or result_kind in ('leads_form', 'conversations', 'website_leads', 'website_other', 'link_clicks', 'landing_page_views', 'results')),
  daily_budget_cents bigint check (daily_budget_cents is null or daily_budget_cents > 0),
  lifetime_budget_cents bigint check (lifetime_budget_cents is null or lifetime_budget_cents > 0),
  -- An ad's creative: {title, body, thumbnailUrl, imageUrl, videoId, callToAction, link}. Words and links only.
  creative jsonb not null default '{}' check (jsonb_typeof(creative) = 'object' and octet_length(creative::text) <= 12000),
  preview_url text check (preview_url is null or (preview_url ~ '^https://' and char_length(preview_url) <= 2000)),
  meta_created_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint ads_objects_parents check (
    (level = 'campaign' and campaign_id is null and adset_id is null)
    or (level = 'adset' and campaign_id is not null and adset_id is null)
    or (level = 'ad' and campaign_id is not null and adset_id is not null)
  )
);

create index ads_objects_account_idx on public.ads_objects (account_id, level);

create table public.ads_insights_daily (
  account_id text not null references public.ads_accounts (id) on delete restrict,
  ad_id text not null check (ad_id ~ '^[0-9]{3,25}$'),
  adset_id text not null check (adset_id ~ '^[0-9]{3,25}$'),
  campaign_id text not null check (campaign_id ~ '^[0-9]{3,25}$'),
  -- The ad account's calendar day.
  day date not null,
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  -- Link clicks (Meta's inline_link_clicks).
  clicks bigint not null default 0 check (clicks >= 0),
  -- Meta's results for the ad set's goal; null when Meta reported none we could read.
  results integer check (results is null or results >= 0),
  synced_at timestamptz not null default now(),
  primary key (ad_id, day)
);

create index ads_insights_daily_day_idx on public.ads_insights_daily (account_id, day);

create table public.ads_sync_runs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  account_id text check (account_id is null or account_id ~ '^act_[0-9]{3,25}$'),
  ok boolean not null,
  since date,
  until date,
  rows integer not null default 0 check (rows >= 0),
  -- Meta's message when it failed. Never a token.
  error text check (error is null or char_length(error) <= 500),
  -- Who asked: 'cron', or a member's handle («Sync now»).
  by_handle text not null default 'cron' check (char_length(by_handle) between 1 and 40)
);

create index ads_sync_runs_at_idx on public.ads_sync_runs (at desc);

create function public.ads_sync_runs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ads_sync_runs: a sync run is a record and cannot be changed or deleted';
end;
$$;

revoke all on function public.ads_sync_runs_append_only() from public;

create trigger ads_sync_runs_append_only
  before update or delete on public.ads_sync_runs
  for each row execute function public.ads_sync_runs_append_only();

-- ── Video briefs from Alti's ad copy drafts ─────────────────────────────

create table public.ads_briefs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_by_handle text not null check (char_length(created_by_handle) between 1 and 40),
  title text not null check (char_length(title) between 2 and 120),
  -- The ad it learned from, when there was one.
  source_ad_id text check (source_ad_id is null or source_ad_id ~ '^[0-9]{3,25}$'),
  format text not null check (format in ('video', 'image', 'carousel')),
  goal text not null check (goal in ('whatsapp', 'website', 'form')),
  language text not null check (language in ('en', 'es', 'both')),
  -- {hooks, primaryText, headline, description, script, onScreen, cta}, each in English and Spanish.
  copy jsonb not null check (jsonb_typeof(copy) = 'object' and octet_length(copy::text) <= 20000),
  -- The draft was written by Alti (AI) and had no blocking issue when it was sent.
  ai_draft boolean not null default true,
  blocking_issues integer not null default 0 check (blocking_issues = 0),
  -- Video Studio moves it on; the Ads Manager only creates it.
  status text not null default 'new' check (status in ('new', 'planned', 'in_production', 'done', 'dropped'))
);

create index ads_briefs_created_idx on public.ads_briefs (created_at desc);

-- A brief's words never change after it is sent; only its status moves.
create function public.ads_briefs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ads_briefs: a brief is a record and cannot be deleted (drop it)';
  end if;
  if new.copy <> old.copy or new.title <> old.title or new.created_at <> old.created_at or new.created_by_handle <> old.created_by_handle
     or new.format <> old.format or new.goal <> old.goal or new.language <> old.language or new.source_ad_id is distinct from old.source_ad_id then
    raise exception 'ads_briefs: a brief''s words never change; make a new one';
  end if;
  return new;
end;
$$;

revoke all on function public.ads_briefs_guard() from public;

create trigger ads_briefs_guard
  before update or delete on public.ads_briefs
  for each row execute function public.ads_briefs_guard();

-- ── Who reads ───────────────────────────────────────────────────────────

alter table public.ads_accounts enable row level security;
alter table public.ads_objects enable row level security;
alter table public.ads_insights_daily enable row level security;
alter table public.ads_sync_runs enable row level security;
alter table public.ads_briefs enable row level security;

-- Spend is money: administrators only (ads.view).
create policy "administrators read the ad account" on public.ads_accounts
  for select using (public.staff_role() = 'admin');
create policy "administrators read campaigns, ad sets and ads" on public.ads_objects
  for select using (public.staff_role() = 'admin');
create policy "administrators read ad numbers" on public.ads_insights_daily
  for select using (public.staff_role() = 'admin');
create policy "administrators read ad syncs" on public.ads_sync_runs
  for select using (public.staff_role() = 'admin');
-- The content team makes the videos (ads.draft).
create policy "content team reads video briefs" on public.ads_briefs
  for select using (public.staff_role() in ('admin', 'specialist'));

-- ── Crediting leads to ads ──────────────────────────────────────────────

alter table public.signup_cases
  add column attribution jsonb not null default '{}'
    check (jsonb_typeof(attribution) = 'object' and octet_length(attribution::text) <= 2000);

-- A chat signup (/registro) that reached a verified phone is a lead, with its
-- case reference and (0037) the ad link's tags it started with: the utm tags
-- under "utm", the ad under "ad". First touch still wins (on conflict, the
-- existing lead's first touch is kept, as before).
create or replace function public.leads_from_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  phone text;
  touch jsonb;
begin
  if new.user_id is null or (tg_op = 'UPDATE' and old.user_id is not null) then
    return null;
  end if;
  select p.phone_e164 into phone from public.profiles p where p.id = new.user_id;
  if phone is null then
    select '+' || ltrim(u.phone, '+') into phone from auth.users u where u.id = new.user_id and u.phone is not null and u.phone <> '';
  end if;
  if phone is null or phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  touch := jsonb_build_object('caseRef', new.case_ref);
  if jsonb_typeof(new.attribution -> 'utm') = 'object' then
    touch := touch || jsonb_build_object('utm', new.attribution -> 'utm');
  end if;
  if jsonb_typeof(new.attribution -> 'ad') = 'object' then
    touch := touch || jsonb_build_object('ad', new.attribution -> 'ad');
  end if;
  insert into public.leads (phone_e164, locale, source, first_touch, signup_case_ref, client_user_id, created_at)
  values (phone, new.locale, 'signup_chat', touch, new.case_ref, new.user_id, new.started_at)
  on conflict (phone_e164) do update set
    signup_case_ref = coalesce(public.leads.signup_case_ref, excluded.signup_case_ref),
    client_user_id = coalesce(public.leads.client_user_id, excluded.client_user_id),
    locale = coalesce(public.leads.locale, excluded.locale);
  return null;
end;
$$;

revoke all on function public.leads_from_signup() from public;
