-- The review engine (src/lib/reviews, docs/REVIEWS.md): asking every client,
-- once, to leave a public review on the sites the owner configures, and the
-- team's view of it.
--
--   review_settings   One row. Asking by WhatsApp / email at the milestones
--                     starts OFF; an administrator turns it on (/equipo/resenas).
--                     Each milestone can be turned off; that only moves the
--                     ask to the next milestone, it never excludes anyone.
--   review_platforms  Google Business Profile, Trustpilot, BBB: the link a
--                     client writes the review at (https, on the platform's
--                     own host: checked by the server and here), on or off,
--                     and the rating a person typed in from the platform's own
--                     page (we do not read their APIs), with who and when.
--   review_requests   One row per client, ever (unique user_id): the milestone
--                     and the channel ('whatsapp_or_email': the outbound
--                     message, under the autopilot's rules; 'in_app': the
--                     links shown after the pulse). Append-only. It records
--                     NO sentiment: who is asked never depends on how they
--                     feel (no review gating), so there is nothing to keep.
--
-- What is deliberately missing: any per-client "do not ask" flag, any
-- incentive or reward column, any link between a review and the referral
-- credit (migration 0026). Written only by the server (service role) after
-- the caller's role is checked; staff read.

create table public.review_settings (
  id boolean primary key default true check (id),
  requests_enabled boolean not null default false,
  -- {"first_results": true, ...}: a missing key is on.
  milestones jsonb not null default '{}' check (jsonb_typeof(milestones) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80)
);

insert into public.review_settings (id) values (true);

create table public.review_platforms (
  key text primary key check (key in ('google', 'trustpilot', 'bbb')),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  enabled boolean not null default false,
  rating numeric(2, 1) check (rating is null or (rating >= 1 and rating <= 5)),
  review_count integer check (review_count is null or review_count >= 0),
  rating_updated_at timestamptz,
  rating_updated_by_name text check (rating_updated_by_name is null or char_length(rating_updated_by_name) between 1 and 80),
  updated_at timestamptz not null default now(),
  constraint review_platforms_enabled_needs_url check (not enabled or url is not null),
  constraint review_platforms_host check (
    url is null
    or (key = 'google' and url ~* '^https://([a-z0-9-]+\.)*(g\.page|google\.com|goo\.gl)(/|$)')
    or (key = 'trustpilot' and url ~* '^https://([a-z0-9-]+\.)*trustpilot\.com(/|$)')
    or (key = 'bbb' and url ~* '^https://([a-z0-9-]+\.)*bbb\.org(/|$)')
  )
);

insert into public.review_platforms (key) values ('google'), ('trustpilot'), ('bbb');

create table public.review_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  milestone text not null check (milestone in ('pulse_answered', 'first_results', 'referral_signed', 'program_finished')),
  channel text not null check (channel in ('whatsapp_or_email', 'in_app')),
  created_at timestamptz not null default now()
);

alter table public.review_settings enable row level security;
alter table public.review_platforms enable row level security;
alter table public.review_requests enable row level security;

create policy "staff read review settings" on public.review_settings for select using (public.is_staff());
create policy "staff read review platforms" on public.review_platforms for select using (public.is_staff());
create policy "staff read review requests" on public.review_requests for select using (public.staff_can_see_client(user_id));

create function public.review_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '%: the setting is kept; change it instead', tg_table_name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.review_settings_guard() from public;

create trigger review_settings_guard
  before update or delete on public.review_settings
  for each row execute function public.review_settings_guard();

create trigger review_platforms_guard
  before update or delete on public.review_platforms
  for each row execute function public.review_settings_guard();

-- A request is a record: never changed, deleted only with the account.
create function public.review_requests_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'review_requests: a record cannot be changed';
  end if;
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'review_requests: a record cannot be deleted';
  end if;
  return old;
end;
$$;

revoke all on function public.review_requests_append_only() from public;

create trigger review_requests_append_only
  before update or delete on public.review_requests
  for each row execute function public.review_requests_append_only();

-- Who changed the review settings (team_audit, append-only).
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded',
  'household_member_added', 'card_brands_changed',
  -- Added here; this list replaces the whole constraint.
  'reviews_changed'
));
