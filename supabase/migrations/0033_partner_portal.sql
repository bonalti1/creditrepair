-- The partner portal, so a referral partner can see their clients are in good
-- hands (docs/PARTNERS.md, "The partner portal"):
--
--   partners.kind              + car dealers and attorneys (and "other"), so the
--                              program is not realtor-only.
--   partner_referrals()        rebuilt: the pipeline (referred → contacted →
--                              signed → active → finished, and "did not
--                              continue"), when sales first reached out (the
--                              invitation, prospects.invited_at), who on the
--                              team looks after the person (first name and
--                              role only), whether the person has an account
--                              (so they can be asked to share), the client id
--                              only while they share, and when the partner
--                              last asked them to share. Still nothing from
--                              the case.
--   partner_share_requests     "Ask to follow progress": a partner asks a person
--                              they referred to share their progress. The
--                              client gets a card in their app and one message
--                              (WhatsApp or email, never SMS); they decide on
--                              their own sharing screen, with the consent of
--                              migration 0023. At most one request per client
--                              every 14 days; never to a client who already
--                              shares; only from the partner who referred them.
--                              The partner sees only the date they asked.
--   partner_team_notes         Notes between a partner and the team about one
--                              client, both ways, only while the client shares
--                              with that partner. Staff read them under the
--                              client's scope; the partner reads them only
--                              through partner_team_thread(); the client never
--                              does (staff may choose to write to the client
--                              themselves, in the client's conversation).
--   partner_client_care()      who on the team looks after a client who shares.
--   partners.digest_channel    the weekly summary, opt-in (WhatsApp or email,
--   partner_digests            never SMS), once per partner and week.
--
-- As in 0017 and 0023: a partner has NO read policy on any table here; they
-- read only through security-definer functions that return the columns listed,
-- only while approved (partner_id() is null otherwise). Who writes: only the
-- server, with the service role, after checking the request; the triggers
-- below hold the rules whatever the server sends.

-- ── More kinds of partner ───────────────────────────────────────────────

alter table public.partners drop constraint partners_kind_check;
alter table public.partners add constraint partners_kind_check
  check (kind in ('realtor', 'loan_officer', 'tax_preparer', 'car_dealer', 'attorney', 'other'));

-- ── The current sharing level of a pair (internal) ──────────────────────

-- The newest consent record of a client for a partner, or 'none'. Not granted
-- to anyone: the functions below call it as their owner.
create function public.partner_share_level(p_user uuid, p_partner uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.level from public.partner_share_consents c
    where c.user_id = p_user and c.partner_id = p_partner
    order by c.seq desc limit 1
  ), 'none');
$$;

revoke all on function public.partner_share_level(uuid, uuid) from public, anon, authenticated;

-- ── "Ask to follow progress" ────────────────────────────────────────────

create table public.partner_share_requests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The partner's sign-in that asked.
  requested_by uuid references auth.users (id) on delete set null,
  -- "María López, ABC Realty", as the client reads it.
  partner_name_shown text not null check (char_length(partner_name_shown) between 2 and 210),
  created_at timestamptz not null default now(),
  -- The client tapped "Not now" on the card.
  dismissed_at timestamptz,
  -- The one message to the client: WhatsApp or email, never SMS.
  message_status text not null default 'queued' check (message_status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  message_channel text check (message_channel is null or message_channel in ('whatsapp', 'email')),
  message_note text check (message_note is null or char_length(message_note) <= 200),
  message_sent_at timestamptz,
  constraint partner_share_requests_channel_when_sent check (message_status in ('queued', 'skipped') or message_channel is not null)
);

create index partner_share_requests_user_idx on public.partner_share_requests (user_id, created_at desc);
create index partner_share_requests_queued_idx on public.partner_share_requests (created_at) where message_status = 'queued';

alter table public.partner_share_requests enable row level security;

create function public.partner_share_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only together with the client's account.
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'partner_share_requests: a request is never deleted';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if new.dismissed_at is not null or new.message_status <> 'queued' or new.message_channel is not null or new.message_sent_at is not null then
      raise exception 'partner_share_requests: a request starts queued and not dismissed';
    end if;
    if not exists (select 1 from public.partners p where p.id = new.partner_id and p.status = 'approved') then
      raise exception 'partner_share_requests: only an approved partner can ask';
    end if;
    if not exists (select 1 from public.profiles pr where pr.id = new.user_id and pr.referred_partner_id = new.partner_id) then
      raise exception 'partner_share_requests: only the partner who referred this client can ask';
    end if;
    if public.partner_share_level(new.user_id, new.partner_id) <> 'none' then
      raise exception 'partner_share_requests: this client already shares with this partner';
    end if;
    if exists (
      select 1 from public.partner_share_requests q
      where q.user_id = new.user_id and q.created_at > now() - interval '14 days'
    ) then
      raise exception 'partner_share_requests: at most one request every 14 days';
    end if;
    return new;
  end if;
  -- UPDATE: the client's "Not now", once; and the message's delivery, forward only.
  if new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.user_id is distinct from old.user_id
    or new.requested_by is distinct from old.requested_by or new.partner_name_shown is distinct from old.partner_name_shown
    or new.created_at is distinct from old.created_at then
    raise exception 'partner_share_requests: a request cannot be changed';
  end if;
  if old.dismissed_at is not null and new.dismissed_at is distinct from old.dismissed_at then
    raise exception 'partner_share_requests: a dismissal cannot be changed';
  end if;
  if new.message_status is distinct from old.message_status then
    if not (
      (old.message_status = 'queued' and new.message_status in ('sending', 'skipped'))
      or (old.message_status = 'sending' and new.message_status in ('sent', 'failed'))
    ) then
      raise exception 'partner_share_requests: the message can only move forward, once';
    end if;
  elsif old.message_status in ('sent', 'failed', 'skipped') and (
    new.message_channel is distinct from old.message_channel or new.message_note is distinct from old.message_note
    or new.message_sent_at is distinct from old.message_sent_at
  ) then
    raise exception 'partner_share_requests: a delivered message cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_share_requests_guard() from public;

create trigger partner_share_requests_guard
  before insert or update or delete on public.partner_share_requests
  for each row execute function public.partner_share_requests_guard();

-- The client sees their own requests (the card on their home and the note on
-- their sharing screen). Staff, under the client's scope. Never a partner.
create policy "own share requests read" on public.partner_share_requests
  for select using (auth.uid() = user_id);

create policy "staff read share requests" on public.partner_share_requests
  for select using (public.staff_can_see_client(user_id));

-- ── Notes between a partner and the team ────────────────────────────────

create table public.partner_team_notes (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- The client the note is about.
  user_id uuid not null references auth.users (id) on delete cascade,
  author_kind text not null check (author_kind in ('partner', 'staff')),
  author uuid references auth.users (id) on delete set null,
  -- First name only, as the other side reads it ("Ana").
  author_first_name text not null check (char_length(btrim(author_first_name)) between 1 and 40),
  -- A teammate's role ("Credit specialist"); null for the partner.
  author_role text check (author_role is null or author_role in ('admin', 'specialist', 'sales')),
  body text not null check (char_length(btrim(body)) between 2 and 1500),
  created_at timestamptz not null default now(),
  constraint partner_team_notes_role check ((author_kind = 'staff') = (author_role is not null))
);

create index partner_team_notes_thread_idx on public.partner_team_notes (user_id, partner_id, created_at);

alter table public.partner_team_notes enable row level security;

create function public.partner_team_notes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'partner_team_notes: a note cannot be changed';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users u where u.id = old.user_id) then
      raise exception 'partner_team_notes: a note cannot be deleted';
    end if;
    return old;
  end if;
  new.created_at := now();
  if not exists (select 1 from public.partners p where p.id = new.partner_id and p.status = 'approved') then
    raise exception 'partner_team_notes: the partner is not approved';
  end if;
  -- Only while the client shares with this partner.
  if public.partner_share_level(new.user_id, new.partner_id) = 'none' then
    raise exception 'partner_team_notes: this client does not share with this partner';
  end if;
  if new.author_kind = 'partner' and not exists (
    select 1 from public.partner_members m where m.user_id = new.author and m.partner_id = new.partner_id
  ) then
    raise exception 'partner_team_notes: the author is not this partner';
  end if;
  if new.author_kind = 'staff' and not exists (
    select 1 from public.staff_members s where s.user_id = new.author and s.active and s.role = new.author_role
  ) then
    raise exception 'partner_team_notes: the author is not an active member of staff in that role';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_team_notes_guard() from public;

create trigger partner_team_notes_guard
  before insert or update or delete on public.partner_team_notes
  for each row execute function public.partner_team_notes_guard();

create policy "staff read partner team notes" on public.partner_team_notes
  for select using (public.staff_can_see_client(user_id));

-- The thread of one client, for the signed-in partner: only while the client
-- shares with them, only approved with the current terms. The notes' words,
-- the authors' first names and roles, and the dates; nothing else.
create function public.partner_team_thread(p_client uuid)
returns table (note_id uuid, author_kind text, author_first_name text, author_role text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.author_kind, n.author_first_name, n.author_role, n.body, n.created_at
  from public.partner_team_notes n
  where public.partner_id() is not null and p_client is not null and public.partner_terms_ok()
    and n.partner_id = public.partner_id() and n.user_id = p_client
    and public.partner_share_level(p_client, public.partner_id()) <> 'none'
  order by n.created_at, n.id;
$$;

-- Who on the team looks after a client who shares with the signed-in partner:
-- the assigned teammate, else the one their lead was given to, else their
-- salesperson (the same order as partner_referrals()); first name and role
-- only. Nothing for anyone else.
create function public.partner_client_care(p_client uuid)
returns table (care_first_name text, care_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(btrim(s.display_name), ' ', 1), s.role
  from public.staff_members s
  where public.partner_id() is not null and p_client is not null and public.partner_terms_ok()
    and public.partner_share_level(p_client, public.partner_id()) <> 'none'
    and s.active and s.user_id = coalesce(
      (select a.staff_user_id from public.client_assignments a where a.user_id = p_client),
      (select p.assigned_to from public.prospects p where p.converted_user_id = p_client order by p.created_at desc limit 1),
      (select s2.user_id from public.staff_members s2 where s2.active and s2.handle = coalesce(
        (select p.salesperson from public.prospects p where p.converted_user_id = p_client order by p.created_at desc limit 1),
        (select pr.referred_by from public.profiles pr where pr.id = p_client)
      ) limit 1)
    )
  limit 1;
$$;

revoke all on function public.partner_team_thread(uuid) from public, anon;
revoke all on function public.partner_client_care(uuid) from public, anon;
grant execute on function public.partner_team_thread(uuid) to authenticated;
grant execute on function public.partner_client_care(uuid) to authenticated;

-- ── The partner's referrals, as a pipeline ──────────────────────────────

drop function public.partner_referrals();

-- The signed-in partner's referrals:
--   referred       a lead the team has not reached yet (no invitation sent, no account);
--   contacted      sales sent the invitation, or they have an account without a signed agreement;
--   signed         signed the service agreement; no round mailed yet;
--   active         at least one round mailed and the service goes on;
--   finished       finished the program (graduation: after-care goes on);
--   not_continued  cancelled, asked to end the service, or sales closed them.
-- First name and last initial only; when sales reached out; who looks after
-- them (first name and role). The client id only while they share. Nothing
-- from the credit file, the letters, the agreement's terms or the payments.
-- The same rules as referralStatus() in src/lib/partners/rules.ts.
create function public.partner_referrals()
returns table (
  referral_id uuid,
  first_name text,
  last_initial text,
  referred_at timestamptz,
  status text,
  contacted_at timestamptz,
  care_first_name text,
  care_role text,
  has_account boolean,
  shared_client_id uuid,
  share_requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.partner_id() as pid),
  people as (
    -- Referred as a prospect (the partner's form, or a HighLevel lead carrying their code).
    select p.id as referral_id, p.first_name, left(p.last_name, 1) as last_initial, p.created_at as referred_at,
           p.converted_user_id as user_id, p.lost_at, p.invited_at, p.assigned_to, p.salesperson
    from public.prospects p, me
    where me.pid is not null and p.partner_id = me.pid
    union all
    -- Came by the partner's link and signed up by themselves (no prospect row of this partner).
    select pr.id, split_part(btrim(pr.full_name), ' ', 1), left(split_part(btrim(pr.full_name), ' ', 2), 1), pr.created_at,
           pr.id, null::timestamptz, null::timestamptz, null::uuid, pr.referred_by
    from public.profiles pr, me
    where me.pid is not null and pr.referred_partner_id = me.pid
      and not exists (select 1 from public.prospects p2 where p2.converted_user_id = pr.id and p2.partner_id = me.pid)
  )
  select x.referral_id, x.first_name, x.last_initial, x.referred_at,
    case
      when x.lost_at is not null then 'not_continued'
      when x.user_id is not null and exists (select 1 from public.program_completions pc where pc.user_id = x.user_id) then 'finished'
      when a.cancelled_at is not null or a.service_end_requested_at is not null then 'not_continued'
      when a.signed_at is not null and exists (
        select 1 from public.attack_rounds r where r.user_id = x.user_id and r.mailed_at is not null
      ) then 'active'
      when a.signed_at is not null then 'signed'
      when x.user_id is null and x.invited_at is null then 'referred'
      else 'contacted'
    end as status,
    x.invited_at,
    split_part(btrim(care.display_name), ' ', 1),
    care.role,
    x.user_id is not null,
    case
      when x.user_id is not null and public.partner_terms_ok()
        and public.partner_share_level(x.user_id, (select pid from me)) <> 'none' then x.user_id
      else null
    end,
    (select max(q.created_at) from public.partner_share_requests q
      where x.user_id is not null and q.user_id = x.user_id and q.partner_id = (select pid from me))
  from people x
  left join lateral (
    select s.signed_at, s.cancelled_at, s.service_end_requested_at
    from public.service_agreements s
    where x.user_id is not null and s.user_id = x.user_id
    order by s.created_at desc
    limit 1
  ) a on true
  left join lateral (
    -- The teammate who looks after them: the assigned specialist once they are a
    -- client, else the one the lead was given to, else their salesperson.
    select st.display_name, st.role
    from public.staff_members st
    where st.active and st.user_id = coalesce(
      (select ca.staff_user_id from public.client_assignments ca where x.user_id is not null and ca.user_id = x.user_id),
      x.assigned_to,
      (select s2.user_id from public.staff_members s2 where s2.handle = x.salesperson and s2.active limit 1)
    )
    limit 1
  ) care on true
  order by x.referred_at desc;
$$;

revoke all on function public.partner_referrals() from public, anon;
grant execute on function public.partner_referrals() to authenticated;

-- ── The weekly summary ──────────────────────────────────────────────────

alter table public.partners
  -- Off (null) unless the partner chose a channel. Never SMS.
  add column digest_channel text check (digest_channel is null or digest_channel in ('whatsapp', 'email'));

create table public.partner_digests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  -- The partner's local ISO week: "2026-W48". Once per partner and week.
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  channel text not null check (channel in ('email', 'whatsapp')),
  -- How many milestones it carried (the words are only what the partner may see anyway).
  items integer not null check (items between 1 and 200),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  unique (partner_id, week_key)
);

alter table public.partner_digests enable row level security;

create function public.partner_digests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'partner_digests: a summary is never deleted';
  end if;
  if new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.week_key is distinct from old.week_key
    or new.channel is distinct from old.channel or new.items is distinct from old.items or new.created_at is distinct from old.created_at
    or old.status <> 'sending' then
    raise exception 'partner_digests: only the delivery of a summary being sent can be recorded';
  end if;
  return new;
end;
$$;

revoke all on function public.partner_digests_guard() from public;

create trigger partner_digests_guard
  before update or delete on public.partner_digests
  for each row execute function public.partner_digests_guard();

create policy "admin read partner digests" on public.partner_digests
  for select using (public.staff_role() = 'admin');
