-- Partner sharing: a client lets the partner who referred them (or one they
-- add by the partner's code) follow their progress. The client's choice, made
-- explicitly, revocable at any time, effective at once.
--
--   partner_share_consents    every grant, change and revocation, append-only,
--                             with the consent text's version and SHA-256 and
--                             the partner's name as it was shown. The CURRENT
--                             level is the newest row: there is no second copy
--                             that could disagree with the record.
--   partner_view_log          every time a partner opened a client's page
--                             (written by the database function that returns
--                             the page, so there is no read without a row).
--   partner_terms_acceptances the partner terms a partner accepted at sign-in.
--   partner_notices           milestone messages sent to a partner (dedupe).
--   partner_program_changes   "Comisiones a socios": the program-wide switch for
--                             referral fees, OFF until an administrator records
--                             the attorney's approval (append-only).
--   partners                  + logo (an image the partner sent, shown only once
--                             an administrator approved it) and the partner's
--                             notification choices.
--
-- The levels:
--   none      nothing beyond the coarse referral status of migration 0017;
--   progress  "Solo el avance": the client's name, stage, milestone dates, goal;
--   summary   "Avance y resumen": the above plus two counts (items disputed in
--             the current round; disputed items the latest report no longer lists).
--
-- What a partner can never read, at any level: scores, report items, creditor
-- names, account numbers, amounts, letters, documents, SSN or date of birth,
-- address, payments, chat, the client's answers or reasons. A partner has no
-- read policy on any table holding them; the two functions below return only
-- the columns listed, and only for a client whose newest record is not "none",
-- only while the partner is approved and has accepted the current terms.
--
-- Who writes: only the server (service role), after checking the request.
-- Nobody gets an insert, update or delete policy here.

-- ── Commissions, program-wide: OFF until the attorney clears them ───────
--
-- "Comisiones a socios". Until an administrator turns it on, confirming the
-- attorney approved paying referral fees (RESPA Section 8, Texas Finance Code
-- ch. 393), the program has no referral fees: no commission terms can be set
-- and no amount can be recorded, whatever the server code does (triggers
-- below), and the screens say so. Append-only; the newest row is the setting.

create table public.partner_program_changes (
  seq bigint generated always as identity primary key,
  commissions_enabled boolean not null,
  -- Turning it on is an approval: who at the attorney's office, which day, and the box ticked.
  attorney_name text check (attorney_name is null or char_length(btrim(attorney_name)) between 3 and 120),
  attorney_approved_on date,
  confirmed boolean not null default false,
  changed_by uuid references auth.users (id) on delete set null,
  changed_by_name text not null default '' check (char_length(changed_by_name) <= 80),
  changed_at timestamptz not null default now(),
  constraint partner_program_on_needs_approval check (
    not commissions_enabled or (confirmed and attorney_name is not null and attorney_approved_on is not null)
  )
);

alter table public.partner_program_changes enable row level security;

create trigger partner_program_changes_append_only
  before update or delete on public.partner_program_changes
  for each row execute function public.partner_records_append_only();

-- Off unless the newest record turned it on. Public: the signup page and the
-- "Cómo funciona" page say whether the program pays referral fees.
create function public.partner_commissions_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.commissions_enabled from public.partner_program_changes c order by c.seq desc limit 1), false);
$$;

revoke all on function public.partner_commissions_enabled() from public;
grant execute on function public.partner_commissions_enabled() to anon, authenticated;

create policy "staff read partner program" on public.partner_program_changes
  for select using (public.staff_role() in ('admin', 'sales'));

-- While off: no amount is recorded...
create function public.partner_commissions_need_program()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.partner_commissions_enabled() then
    raise exception 'partner_commissions: commissions to partners are off (Comisiones a socios)';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_commissions_need_program() from public;

create trigger partner_commissions_need_program
  before insert on public.partner_commissions
  for each row execute function public.partner_commissions_need_program();

-- ...and no commission terms are set or changed (other changes to a partner still save).
create function public.partners_terms_need_program()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.commission_basis <> 'none'
    and (tg_op = 'INSERT' or new.commission_basis is distinct from old.commission_basis or new.commission_cents is distinct from old.commission_cents)
    and not public.partner_commissions_enabled() then
    raise exception 'partners: commissions to partners are off (Comisiones a socios)';
  end if;
  return new;
end;
$$;

revoke all on function public.partners_terms_need_program() from public;

create trigger partners_terms_need_program
  before insert or update on public.partners
  for each row execute function public.partners_terms_need_program();

-- ── Consent records ─────────────────────────────────────────────────────

create table public.partner_share_consents (
  -- An identity, so "newest" is exact even for two records in the same instant.
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete restrict,
  level text not null check (level in ('none', 'progress', 'summary')),
  -- Filled in by the trigger from the newest earlier record: never trusted from the caller.
  previous_level text not null default 'none' check (previous_level in ('none', 'progress', 'summary')),
  action text not null default 'grant' check (action in ('grant', 'change', 'revoke')),
  -- How the partner is connected to the client.
  how text not null check (how in ('referred', 'added_by_code')),
  -- What the client was shown (src/lib/partners/sharing.ts SHARING_CONSENT_VERSION and its hash).
  text_version text not null check (char_length(text_version) between 4 and 40),
  locale text not null check (locale in ('es', 'en')),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  partner_name_shown text not null check (char_length(partner_name_shown) between 2 and 210),
  created_at timestamptz not null default now()
);

create index partner_share_consents_pair_idx on public.partner_share_consents (user_id, partner_id, seq desc);
create index partner_share_consents_partner_idx on public.partner_share_consents (partner_id, user_id, seq desc);

alter table public.partner_share_consents enable row level security;

create function public.partner_share_consents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prior text;
  partner_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'partner_share_consents: a consent record cannot be changed or deleted';
  end if;
  select c.level into prior from public.partner_share_consents c
    where c.user_id = new.user_id and c.partner_id = new.partner_id
    order by c.seq desc limit 1;
  new.previous_level := coalesce(prior, 'none');
  if new.level = new.previous_level then
    raise exception 'partner_share_consents: the level is already %', new.level;
  end if;
  new.action := case
    when new.previous_level = 'none' then 'grant'
    when new.level = 'none' then 'revoke'
    else 'change'
  end;
  new.created_at := now();
  if new.level <> 'none' then
    select p.status into partner_status from public.partners p where p.id = new.partner_id;
    if partner_status is distinct from 'approved' then
      raise exception 'partner_share_consents: sharing can be granted only to an approved partner';
    end if;
  end if;
  -- "Referred" must be true: the partner on the client's profile (0017, server-written).
  if new.how = 'referred' and not exists (
    select 1 from public.profiles pr where pr.id = new.user_id and pr.referred_partner_id = new.partner_id
  ) then
    raise exception 'partner_share_consents: this partner did not refer this client';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_share_consents_guard() from public;

create trigger partner_share_consents_guard
  before insert or update or delete on public.partner_share_consents
  for each row execute function public.partner_share_consents_guard();

-- ── Views of a client's page ────────────────────────────────────────────

create table public.partner_view_log (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- The partner's sign-in that looked.
  viewer uuid references auth.users (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create index partner_view_log_user_idx on public.partner_view_log (user_id, viewed_at desc);
create index partner_view_log_partner_idx on public.partner_view_log (partner_id, viewed_at desc);

alter table public.partner_view_log enable row level security;

create trigger partner_view_log_append_only
  before update or delete on public.partner_view_log
  for each row execute function public.partner_records_append_only();

-- ── Partner terms ───────────────────────────────────────────────────────

create table public.partner_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  version text not null check (char_length(version) between 4 and 40),
  locale text not null check (locale in ('es', 'en')),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now()
);

create index partner_terms_acceptances_partner_idx on public.partner_terms_acceptances (partner_id, accepted_at desc);

alter table public.partner_terms_acceptances enable row level security;

create trigger partner_terms_acceptances_append_only
  before update or delete on public.partner_terms_acceptances
  for each row execute function public.partner_records_append_only();

-- The version a partner must have accepted to see any client. The same value
-- as PARTNER_CLIENT_TERMS_VERSION in src/lib/partners/terms.ts (a test checks).
create function public.partner_terms_current()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-11-socios-terminos-v1'::text;
$$;

-- Has the signed-in partner accepted the current terms?
create function public.partner_terms_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.partner_terms_acceptances t
    where t.partner_id = public.partner_id() and t.version = public.partner_terms_current()
  );
$$;

-- ── Logo and notifications ──────────────────────────────────────────────

alter table public.partners
  -- A small image (PNG, JPEG or WebP), as a data URL. Shown to referred clients only once approved.
  add column logo_data text check (
    logo_data is null or (octet_length(logo_data) <= 200000 and logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$')
  ),
  add column logo_status text not null default 'none' check (logo_status in ('none', 'pending', 'approved', 'rejected')),
  add column logo_decided_at timestamptz,
  add column logo_decided_by uuid references auth.users (id) on delete set null,
  -- The partner chose to be told of their clients' milestones (never SMS).
  add column notify_email boolean not null default false,
  add column notify_whatsapp boolean not null default false,
  add constraint partners_logo_pair check ((logo_status = 'none') = (logo_data is null));

create table public.partner_notices (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "<partner>:<client>:<milestone>": each milestone of each client once per partner.
  dedupe_key text not null unique check (char_length(dedupe_key) between 10 and 200),
  milestone text not null check (char_length(milestone) between 3 and 60),
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  note text check (note is null or char_length(note) <= 200)
);

create index partner_notices_partner_idx on public.partner_notices (partner_id, created_at desc);

alter table public.partner_notices enable row level security;

create function public.partner_notices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'partner_notices: a notice is never deleted';
  end if;
  if new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.user_id is distinct from old.user_id
    or new.dedupe_key is distinct from old.dedupe_key or new.milestone is distinct from old.milestone
    or new.channel is distinct from old.channel or new.created_at is distinct from old.created_at
    or old.status <> 'sending' then
    raise exception 'partner_notices: only the delivery of a notice being sent can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_notices_guard() from public;

create trigger partner_notices_guard
  before update or delete on public.partner_notices
  for each row execute function public.partner_notices_guard();

-- ── What a partner may see of a consenting client ───────────────────────

-- The newest consent record of each client for a partner, its level, and the
-- limited progress columns. INTERNAL: not granted to anyone; the server's
-- service role calls it for notifications. A signed-in caller (if a platform
-- default ever granted it) gets only what partner_clients() would give them.
create function public.partner_progress_rows(p_partner uuid, p_client uuid)
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (c.user_id) c.user_id, c.level, c.how, c.seq
    from public.partner_share_consents c
    where c.partner_id = p_partner and (p_client is null or c.user_id = p_client)
      and (auth.uid() is null or (p_partner = public.partner_id() and public.partner_terms_ok()))
    order by c.user_id, c.seq desc
  ),
  sharing as (
    select l.*,
      (select min(c2.created_at) from public.partner_share_consents c2
        where c2.user_id = l.user_id and c2.partner_id = p_partner
          and c2.seq > coalesce((select max(c3.seq) from public.partner_share_consents c3
                                 where c3.user_id = l.user_id and c3.partner_id = p_partner and c3.level = 'none'), 0)
      ) as since
    from latest l
    join public.partners p on p.id = p_partner and p.status = 'approved'
    where l.level <> 'none'
  )
  select
    s.user_id,
    btrim(pr.full_name),
    s.level,
    s.how,
    s.since,
    case when pr.goal in ('mortgage', 'auto', 'card', 'general') then pr.goal else null end,
    a.signed_at,
    case when a.signed_at is not null and a.cancelled_at is null then a.cancellation_deadline else null end,
    coalesce(a.cancelled_at, a.service_end_requested_at),
    (select max(d.first_at) from (
        select min(i.uploaded_at) as first_at from public.identity_documents i
        where i.user_id = s.user_id and i.kind in ('government_id', 'proof_of_address') group by i.kind
      ) d having count(*) = 2),
    (select case when count(*) > 0 and count(f.item_id) = count(*) then max(coalesce(f.attested_at, f.created_at)) else null end
       from public.report_items ri
       left join lateral (
         select fl.item_id, fl.attested_at, fl.created_at from public.item_flags fl
         where fl.item_id = ri.id order by fl.created_at desc limit 1
       ) f on true
       where ri.user_id = s.user_id and ri.status = 'active'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', r.round_number,
        'mailed_at', r.mailed_at,
        'answer_due_at', w.window_start + interval '30 days',
        'next_round_at', r.mailed_at + interval '40 days'
      ) order by r.round_number)
      from public.attack_rounds r
      cross join lateral (
        select greatest(r.mailed_at, coalesce(max(lt.delivered_at) filter (
          where lt.mail_class in ('certified', 'certified_return_receipt') and lt.mail_status = 'delivered'
        ), r.mailed_at)) as window_start
        from public.letters lt where lt.round_id = r.id
      ) w
      where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
    ), '[]'::jsonb),
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      where lt.round_id = (
        select r.id from public.attack_rounds r
        where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
        order by r.round_number desc limit 1
      )
    ) else null end,
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      join public.attack_rounds r on r.id = lt.round_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
      join public.report_items ri on ri.id = li.item_id
      where lt.user_id = s.user_id and ri.status = 'deleted'
    ) else null end
  from sharing s
  join public.profiles pr on pr.id = s.user_id
  left join lateral (
    select sa.signed_at, sa.cancellation_deadline, sa.cancelled_at, sa.service_end_requested_at
    from public.service_agreements sa where sa.user_id = s.user_id
    order by sa.created_at desc limit 1
  ) a on true
  order by s.since desc;
$$;

-- The signed-in partner's consenting clients, for "Mis clientes". Nothing for
-- a partner who is not approved or has not accepted the current terms.
create function public.partner_clients()
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.partner_progress_rows(public.partner_id(), null) r
  where public.partner_id() is not null and public.partner_terms_ok();
$$;

-- One client's page for the signed-in partner. Writes the view to the log in
-- the same statement: a page that is returned is a page that is logged.
create function public.partner_client_view(p_client uuid)
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  pid uuid := public.partner_id();
begin
  if pid is null or p_client is null or not public.partner_terms_ok() then
    return;
  end if;
  if exists (select 1 from public.partner_progress_rows(pid, p_client)) then
    insert into public.partner_view_log (partner_id, viewer, user_id) values (pid, auth.uid(), p_client);
    return query select * from public.partner_progress_rows(pid, p_client);
  end if;
end;
$$;

-- ── What a client sees about partners ───────────────────────────────────

-- The partners connected to the signed-in client: the one who referred them,
-- and any they added. Public facts only (name, company, kind, approved logo),
-- and the client's current choice for each.
create function public.client_sharing()
returns table (
  partner_id uuid,
  name text,
  company text,
  kind text,
  status text,
  referred boolean,
  level text,
  how text,
  changed_at timestamptz,
  logo_data text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
  linked as (
    select pr.referred_partner_id as pid from public.profiles pr, me where pr.id = me.uid and pr.referred_partner_id is not null
    union
    select c.partner_id from public.partner_share_consents c, me where c.user_id = me.uid
  )
  select p.id, p.name, p.company, p.kind, p.status,
    exists (select 1 from public.profiles pr, me where pr.id = me.uid and pr.referred_partner_id = p.id),
    coalesce(c.level, 'none'), c.how, c.created_at,
    case when p.logo_status = 'approved' then p.logo_data else null end
  from linked x
  join public.partners p on p.id = x.pid
  left join lateral (
    select c.level, c.how, c.created_at from public.partner_share_consents c, me
    where c.user_id = me.uid and c.partner_id = p.id order by c.seq desc limit 1
  ) c on true
  where (select uid from me) is not null
  order by p.name;
$$;

-- An approved partner's public face, by code: for the referred client's
-- welcome, the "Cómo funciona" page and adding a partner by code.
create function public.partner_public(p_code text)
returns table (partner_id uuid, name text, company text, kind text, logo_data text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.company, p.kind, case when p.logo_status = 'approved' then p.logo_data else null end
  from public.partners p
  where p.status = 'approved' and p.referral_code = lower(p_code);
$$;

revoke all on function public.partner_progress_rows(uuid, uuid) from public, anon, authenticated;
revoke all on function public.partner_terms_current() from public, anon;
revoke all on function public.partner_terms_ok() from public, anon;
revoke all on function public.partner_clients() from public, anon;
revoke all on function public.partner_client_view(uuid) from public, anon;
revoke all on function public.client_sharing() from public, anon;
revoke all on function public.partner_public(text) from public;
grant execute on function public.partner_terms_current() to authenticated;
grant execute on function public.partner_terms_ok() to authenticated;
grant execute on function public.partner_clients() to authenticated;
grant execute on function public.partner_client_view(uuid) to authenticated;
grant execute on function public.client_sharing() to authenticated;
grant execute on function public.partner_public(text) to anon, authenticated;

-- ── Read policies ───────────────────────────────────────────────────────

create policy "own share consents read" on public.partner_share_consents
  for select using (auth.uid() = user_id);

create policy "staff read share consents" on public.partner_share_consents
  for select using (public.staff_role() in ('admin', 'sales'));

create policy "own partner views read" on public.partner_view_log
  for select using (auth.uid() = user_id);

create policy "admin read partner views" on public.partner_view_log
  for select using (public.staff_role() = 'admin');

create policy "partner reads own terms acceptances" on public.partner_terms_acceptances
  for select using (partner_id = public.partner_id());

create policy "admin read partner terms acceptances" on public.partner_terms_acceptances
  for select using (public.staff_role() = 'admin');

create policy "admin read partner notices" on public.partner_notices
  for select using (public.staff_role() = 'admin');
