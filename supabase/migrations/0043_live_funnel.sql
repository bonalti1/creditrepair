-- The live funnel (docs/LIVE-FUNNEL.md): webinars and ads → a keyword or a tap
-- → an automatic reply with the link → /live (details, consent, their own
-- credit report) → the team's review overview and a short personal video →
-- they decide, in writing, whether to sign up.
--
-- What it adds:
--   leads.source 'live'     A lead who arrived through the /live form (or a
--                           HighLevel / ManyChat comment hand-off) without
--                           writing on WhatsApp first.
--   live_leads              One row per funnel lead: where they came from
--                           (webinar, ad, comment, bio, the keyword, the
--                           campaign; first touch wins), what they gave on
--                           the form, their consents with the words they
--                           agreed to, and the funnel's stage facts. No
--                           credit data: sales reads it for their leads.
--   live_replies            Every automatic keyword reply (WhatsApp, or SMS
--                           when the owner turns that on): claimed before
--                           sending, then sent or failed. One per inbound
--                           message, ever.
--   live_sms_opt_outs       STOP / START received by SMS (the SMS channel is
--                           off by default). Append-only.
--   live_reviews            A report review before signup: the merged reading
--                           of the uploaded report(s) and the team's overview.
--                           Credit data: administrators and specialists only.
--                           Deleted (files and data) 30 days after upload if
--                           they do not sign up (/api/cron/live).
--   live_report_files       The uploaded files (1 to 3: one per bureau from
--                           annualcreditreport.com, or one 3-bureau report).
--   live_videos             The personal video, its private expiring link
--                           (only the hash of the token is kept) and what
--                           happened to it: sent, opened, watched, «Get
--                           started».
--   buckets                 live-reports and live-videos, both private.
--
-- Who writes: only the server (service role), after the route checked the
-- caller (a secret for the webhooks, a short-lived upload token for /live,
-- the member's capability for the console). Nobody gets an insert, update or
-- delete policy.
-- Who reads: the funnel facts (live_leads, live_replies, SMS opt-outs) as the
-- lead itself (staff_can_see_lead: an administrator, sales theirs and
-- nobody's); a specialist also reads the live_leads row of a lead whose
-- report is in review. The reviews, files and videos: administrators and
-- specialists. A client, a partner and anon read nothing here.

-- ── A lead from the /live form ──────────────────────────────────────────

alter table public.leads drop constraint leads_source_check;
alter table public.leads add constraint leads_source_check check (source in ('whatsapp', 'highlevel', 'partner', 'signup_chat', 'manual', 'household', 'crc_import', 'live'));

-- ── The funnel's own facts about a lead ─────────────────────────────────

create table public.live_leads (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  -- Where they came from (first touch wins: set once, never changed).
  tag text not null check (tag in ('webinar', 'ad', 'comment', 'bio', 'link', 'other')),
  platform text check (platform is null or platform in ('zoom', 'facebook', 'youtube', 'instagram', 'tiktok', 'whatsapp', 'sms', 'web')),
  keyword text check (keyword is null or keyword ~ '^[A-Z0-9]{2,20}$'),
  campaign text check (campaign is null or campaign ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  src text check (src is null or src ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  -- What they gave on the form.
  first_name text check (first_name is null or char_length(btrim(first_name)) between 1 and 40),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$')),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  goal text check (goal is null or goal in ('mortgage', 'auto', 'card', 'general')),
  locale text check (locale is null or locale in ('en', 'es')),
  -- Their consents, with the exact words shown and when.
  consent_messages_at timestamptz,
  consent_messages_text text check (consent_messages_text is null or char_length(consent_messages_text) between 10 and 800),
  consent_report_at timestamptz,
  consent_report_text text check (consent_report_text is null or char_length(consent_report_text) between 10 and 800),
  consent_sms_at timestamptz,
  consent_sms_text text check (consent_sms_text is null or char_length(consent_sms_text) between 10 and 800),
  -- They texted the keyword to our SMS number themselves.
  sms_keyword_at timestamptz,
  -- The stage facts (no credit data): the form, the report, the review ready, the video.
  form_at timestamptz,
  report_at timestamptz,
  ready_at timestamptz,
  video_sent_at timestamptz,
  video_opened_at timestamptz,
  video_watched_at timestamptz,
  started_at timestamptz,
  report_deleted_at timestamptz,
  -- The /live upload step's short-lived token (its SHA-256 only).
  upload_token_hash text check (upload_token_hash is null or upload_token_hash ~ '^[0-9a-f]{64}$'),
  upload_token_expires_at timestamptz,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  constraint live_leads_consent_pairs check (
    (consent_messages_at is null) = (consent_messages_text is null)
    and (consent_report_at is null) = (consent_report_text is null)
    and (consent_sms_at is null) = (consent_sms_text is null)
  )
);

create index live_leads_campaign_idx on public.live_leads (campaign) where campaign is not null;

alter table public.live_leads enable row level security;

create policy "staff read live leads" on public.live_leads
  for select using (
    public.staff_can_see_lead_id(lead_id)
    or (coalesce(public.staff_role() = 'specialist', false) and report_at is not null)
  );

-- First touch wins: where they came from is set once. Facts only move forward.
create function public.live_leads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'live_leads: a funnel record goes with its lead, never alone';
  end if;
  if new.lead_id <> old.lead_id or new.first_at <> old.first_at then
    raise exception 'live_leads: the lead and the first touch never change';
  end if;
  new.tag := old.tag;
  new.platform := coalesce(old.platform, new.platform);
  new.keyword := coalesce(old.keyword, new.keyword);
  new.campaign := coalesce(old.campaign, new.campaign);
  new.src := coalesce(old.src, new.src);
  if old.consent_messages_at is not null then new.consent_messages_at := old.consent_messages_at; new.consent_messages_text := old.consent_messages_text; end if;
  if old.consent_report_at is not null then new.consent_report_at := old.consent_report_at; new.consent_report_text := old.consent_report_text; end if;
  if old.form_at is not null then new.form_at := old.form_at; end if;
  if old.video_sent_at is not null then new.video_sent_at := old.video_sent_at; end if;
  if old.video_opened_at is not null then new.video_opened_at := old.video_opened_at; end if;
  if old.video_watched_at is not null then new.video_watched_at := old.video_watched_at; end if;
  if old.started_at is not null then new.started_at := old.started_at; end if;
  return new;
end;
$$;

create trigger live_leads_guard
  before update or delete on public.live_leads
  for each row execute function public.live_leads_guard();

-- ── Automatic keyword replies ───────────────────────────────────────────

create table public.live_replies (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- WhatsApp, or SMS only while the owner turned SMS_FUNNEL_ENABLED on.
  channel text not null check (channel in ('whatsapp', 'sms')),
  keyword text not null check (keyword ~ '^[A-Z0-9]{2,20}$'),
  campaign text check (campaign is null or campaign ~ '^[a-z0-9][a-z0-9._-]{0,59}$'),
  -- The inbound message it answers: one reply per message, ever.
  inbound_ref text not null unique check (char_length(inbound_ref) between 4 and 200),
  status text not null check (status in ('claimed', 'sent', 'failed')),
  reason text check (reason is null or char_length(reason) <= 200),
  -- The exact words, with the AI label.
  body text not null check (char_length(body) between 1 and 1200),
  created_at timestamptz not null default now()
);

create index live_replies_dedupe_idx on public.live_replies (phone_e164, keyword, created_at desc);
create index live_replies_lead_idx on public.live_replies (lead_id, created_at);

alter table public.live_replies enable row level security;

create policy "staff read live replies" on public.live_replies
  for select using (lead_id is not null and public.staff_can_see_lead_id(lead_id));

create function public.live_replies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'live_replies: the record of automatic replies is kept';
  end if;
  if new.phone_e164 <> old.phone_e164 or new.channel <> old.channel or new.keyword <> old.keyword or new.body <> old.body
     or new.inbound_ref <> old.inbound_ref or new.created_at <> old.created_at then
    raise exception 'live_replies: what was sent and to whom never changes';
  end if;
  if new.status <> old.status and not (old.status = 'claimed' and new.status in ('sent', 'failed')) then
    raise exception 'live_replies: the status only moves from claimed to sent or failed';
  end if;
  return new;
end;
$$;

create trigger live_replies_guard
  before update or delete on public.live_replies
  for each row execute function public.live_replies_guard();

-- ── STOP / START by SMS (the SMS channel is off by default) ─────────────

create table public.live_sms_opt_outs (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('opt_out', 'opt_in')),
  keyword text not null check (char_length(keyword) between 2 and 20),
  at timestamptz not null default now()
);

create index live_sms_opt_outs_phone_idx on public.live_sms_opt_outs (phone_e164, at desc);

alter table public.live_sms_opt_outs enable row level security;

create policy "staff read live sms opt-outs" on public.live_sms_opt_outs
  for select using (public.staff_can_see_lead_phone(phone_e164));

create trigger live_sms_opt_outs_append_only
  before update or delete on public.live_sms_opt_outs
  for each row execute function public.control_append_only();

-- ── The report review before signup (credit data) ───────────────────────

create table public.live_reviews (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null default 'receiving' check (status in ('receiving', 'reading', 'ready', 'failed', 'deleted', 'imported')),
  -- A reading made without the AI (no key on the server, or the demo): never imported into a case.
  simulated boolean not null default false,
  -- The reading of every file, merged (the app's report format), and the team's overview.
  raw jsonb check (raw is null or (jsonb_typeof(raw) = 'object' and octet_length(raw::text) <= 3000000)),
  overview jsonb check (overview is null or (jsonb_typeof(overview) = 'object' and octet_length(overview::text) <= 400000)),
  problems text[] not null default '{}' check (cardinality(problems) <= 40),
  file_count integer not null default 0 check (file_count between 0 and 3),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  ready_at timestamptz,
  -- 30 days after the upload, unless they sign up and it is imported first.
  delete_after timestamptz not null,
  deleted_at timestamptz,
  imported_at timestamptz,
  imported_user_id uuid references auth.users (id) on delete set null,
  imported_pull_id uuid,
  constraint live_reviews_deleted_is_empty check (deleted_at is null or (raw is null and overview is null))
);

-- One open review per lead.
create unique index live_reviews_one_open on public.live_reviews (lead_id) where deleted_at is null and imported_at is null;
create index live_reviews_due_idx on public.live_reviews (delete_after) where deleted_at is null;

alter table public.live_reviews enable row level security;

create policy "reviewers read live reviews" on public.live_reviews
  for select using (coalesce(public.staff_role() in ('admin', 'specialist'), false));

create table public.live_report_files (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.live_reviews (id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|html|txt)$'),
  file_kind text not null check (file_kind in ('pdf', 'html', 'text')),
  file_bytes integer not null check (file_bytes > 0 and file_bytes <= 20971520),
  status text not null default 'received' check (status in ('received', 'read', 'failed', 'deleted')),
  envelope jsonb check (envelope is null or (jsonb_typeof(envelope) = 'object' and octet_length(envelope::text) <= 3000000)),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 40),
  simulated boolean not null default false,
  model text check (model is null or char_length(model) <= 80),
  cost_usd numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz,
  constraint live_report_files_deleted_is_empty check (deleted_at is null or envelope is null)
);

create index live_report_files_review_idx on public.live_report_files (review_id, created_at);

alter table public.live_report_files enable row level security;

create policy "reviewers read live report files" on public.live_report_files
  for select using (coalesce(public.staff_role() in ('admin', 'specialist'), false));

-- ── The personal video and its private link ─────────────────────────────

create table public.live_videos (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.live_reviews (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|mp4)$'),
  media_type text not null check (media_type in ('video/webm', 'video/mp4')),
  file_bytes bigint not null check (file_bytes > 0 and file_bytes <= 209715200),
  duration_seconds integer not null check (duration_seconds between 5 and 330),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text check (recorded_by_name is null or char_length(recorded_by_name) between 1 and 80),
  created_at timestamptz not null default now(),
  -- The link is /v/<token>; only its SHA-256 is kept.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  sent_at timestamptz,
  sent_via text[] not null default '{}' check (sent_via <@ array['whatsapp', 'sms', 'email', 'copy']::text[]),
  opened_at timestamptz,
  watched_at timestamptz,
  started_at timestamptz,
  chat_at timestamptz,
  deleted_at timestamptz
);

create index live_videos_review_idx on public.live_videos (review_id, created_at desc);

alter table public.live_videos enable row level security;

create policy "reviewers read live videos" on public.live_videos
  for select using (coalesce(public.staff_role() in ('admin', 'specialist'), false));

-- What happened to a video only moves forward; the file and the lead never
-- change. The link is replaced each time it is sent (the earlier one stops
-- working), never once the video is deleted.
create function public.live_videos_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'live_videos: a video is marked deleted, never removed';
  end if;
  if new.storage_path <> old.storage_path or new.lead_id <> old.lead_id
     or new.review_id <> old.review_id or new.created_at <> old.created_at then
    raise exception 'live_videos: the file and the lead never change';
  end if;
  if old.deleted_at is not null and (new.token_hash <> old.token_hash or new.expires_at <> old.expires_at) then
    raise exception 'live_videos: a deleted video has no link';
  end if;
  if old.sent_at is not null then new.sent_at := old.sent_at; end if;
  if old.opened_at is not null then new.opened_at := old.opened_at; end if;
  if old.watched_at is not null then new.watched_at := old.watched_at; end if;
  if old.started_at is not null then new.started_at := old.started_at; end if;
  if old.chat_at is not null then new.chat_at := old.chat_at; end if;
  if old.deleted_at is not null then new.deleted_at := old.deleted_at; end if;
  return new;
end;
$$;

create trigger live_videos_guard
  before update or delete on public.live_videos
  for each row execute function public.live_videos_guard();

-- ── Files: two private buckets ──────────────────────────────────────────

insert into storage.buckets (id, name, public) values ('live-reports', 'live-reports', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('live-videos', 'live-videos', false)
  on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $sql$
      update storage.buckets set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf', 'text/html', 'text/plain'] where id = 'live-reports'
    $sql$;
    execute $sql$
      update storage.buckets set public = false, file_size_limit = 209715200, allowed_mime_types = array['video/webm', 'video/mp4'] where id = 'live-videos'
    $sql$;
  end if;
end;
$$;

-- Only administrators and specialists may read the files with their own
-- session; nobody writes them except the server. The person watching their
-- video gets a short-lived signed link from the server, never the bucket.
create policy "reviewers read live report files in storage" on storage.objects
  for select using (bucket_id = 'live-reports' and coalesce(public.staff_role() in ('admin', 'specialist'), false));
create policy "reviewers read live videos in storage" on storage.objects
  for select using (bucket_id = 'live-videos' and coalesce(public.staff_role() in ('admin', 'specialist'), false));
