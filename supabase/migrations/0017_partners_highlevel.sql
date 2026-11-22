-- Leads from HighLevel, stage updates back to HighLevel, and referral partners.
--
-- Marketing and the lead CRM run in HighLevel; the app owns the person once
-- sales starts working them. This migration adds what that handoff needs, and
-- the records for referral partners (realtors, loan officers, tax preparers):
--
--   partners             a referral partner: who they are, their status
--                        (pending → approved, or declined / suspended), their
--                        referral code, the salesperson who looks after them,
--                        and the commission terms an administrator set. No
--                        payout is ever made by the app: payments are recorded
--                        by hand in partner_commissions.
--   partner_members      the sign-in (auth user) of an approved partner. A
--                        partner is NOT staff: is_staff() and staff_role() stay
--                        false/null for them, so no "staff read" policy applies.
--   partner_commissions  an administrator's record of commission owed or paid.
--                        Append-only.
--   prospects            + where the person came from (manual, highlevel,
--                        partner), the HighLevel contact id, the campaign and
--                        UTM tags, the partner, the consent the lead gave, when
--                        the invitation went out, and when sales closed them as
--                        lost. A prospect from HighLevel or a partner has no
--                        teammate as its creator (created_by may be null then).
--   profiles             + the partner a client came through, and their
--                        HighLevel contact id. Written by the server only: a
--                        client's own connection cannot set or change either.
--   integration_outbox   stage changes waiting to be sent to HighLevel. Each
--                        event once (dedupe_key), retried with backoff. Rows
--                        are never deleted; only the delivery columns change,
--                        and never after the event was sent or given up.
--   webhook_receipts     one row per HighLevel delivery, keyed by a hash of the
--                        exact body, so a redelivery does nothing twice. Holds
--                        no personal data: never the body, and never the value
--                        of a field that was dropped (only its name).
--
-- Never stored, anywhere here: a Social Security number or a date of birth.
-- There is no column for either; the webhook drops such a field before
-- anything is written and records only that it did.
--
-- Who writes: only the server, with the service role. Nobody (client, staff
-- member or partner) gets an insert, update or delete policy here.
-- Who reads:
--   administrators   everything here;
--   sales            the partner list (to know who referred whom);
--   specialists      nothing new (they see a client's source on the client);
--   a partner        their own partner row, their own commission records, and
--                    their referrals through partner_referrals(): first name,
--                    last initial, date and a coarse status. Never a report,
--                    an item, a letter, a score, an agreement or a payment.

-- ── Partners ────────────────────────────────────────────────────────────

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  company text check (company is null or char_length(company) between 2 and 120),
  kind text not null check (kind in ('realtor', 'loan_officer', 'tax_preparer', 'other')),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'suspended')),
  -- The code in their link (/r/<code>). Given when an administrator approves them.
  referral_code text unique check (referral_code is null or referral_code ~ '^[a-z0-9-]{3,30}$'),
  -- The salesperson who works the people this partner refers (staff_members.handle).
  salesperson text check (salesperson is null or salesperson ~ '^[a-z0-9-]{2,30}$'),
  -- Commission terms, as an administrator set them. Paid per person who signs
  -- or per active client, never per result on a report: there is no such option.
  commission_basis text not null default 'none' check (commission_basis in ('none', 'signed_client', 'active_client')),
  commission_cents integer not null default 0 check (commission_cents between 0 and 100000),
  commission_note text check (commission_note is null or char_length(commission_note) <= 500),
  -- The partner terms they accepted when applying (src/lib/partners/copy.ts PARTNER_TERMS_VERSION).
  terms_version text not null check (char_length(terms_version) between 4 and 40),
  terms_accepted_at timestamptz not null,
  applied_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  constraint partners_code_when_approved check (status <> 'approved' or referral_code is not null),
  constraint partners_commission_pair check ((commission_basis = 'none') = (commission_cents = 0))
);

-- One open application or partnership per phone.
create unique index partners_open_phone on public.partners (phone_e164) where status in ('pending', 'approved');

alter table public.partners enable row level security;

-- A partner is declined or suspended, never deleted: their name stays on their referrals.
create function public.partners_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'partners: a partner is declined or suspended, never deleted';
end;
$$;

revoke all on function public.partners_no_delete() from public;

create trigger partners_no_delete
  before delete on public.partners
  for each row execute function public.partners_no_delete();

create table public.partner_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  partner_id uuid not null unique references public.partners (id) on delete restrict,
  joined_at timestamptz not null default now()
);

alter table public.partner_members enable row level security;

-- Plain ids, no foreign keys to rows that could change: rows here are never edited.
create table public.partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete restrict,
  kind text not null check (kind in ('owed', 'paid')),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  -- The referral it is for, when it is for one (a prospect id).
  referral_id uuid,
  note text check (note is null or char_length(note) <= 300),
  recorded_by uuid,
  recorded_by_name text not null default '' check (char_length(recorded_by_name) <= 80),
  recorded_at timestamptz not null default now()
);

create index partner_commissions_partner_idx on public.partner_commissions (partner_id, recorded_at);

alter table public.partner_commissions enable row level security;

create function public.partner_records_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a record cannot be changed or deleted', tg_table_name;
end;
$$;

revoke all on function public.partner_records_append_only() from public;

create trigger partner_commissions_append_only
  before update or delete on public.partner_commissions
  for each row execute function public.partner_records_append_only();

-- ── Where a person came from ────────────────────────────────────────────

alter table public.prospects
  alter column created_by drop not null,
  add column source text not null default 'manual' check (source in ('manual', 'highlevel', 'partner')),
  -- {"campaign": "...", "utm": {"source": "...", ...}, "form": "...", "lastTouchAt": "..."}: marketing tags only.
  add column source_detail jsonb not null default '{}' check (jsonb_typeof(source_detail) = 'object' and octet_length(source_detail::text) <= 4000),
  add column highlevel_contact_id text check (highlevel_contact_id is null or highlevel_contact_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  add column partner_id uuid references public.partners (id) on delete restrict,
  -- The words the lead agreed to (the form's consent text), and when.
  add column consent_text text check (consent_text is null or char_length(consent_text) between 10 and 1000),
  add column consent_at timestamptz,
  add column invited_at timestamptz,
  add column last_touch_at timestamptz,
  add column lost_at timestamptz,
  add constraint prospects_creator check (created_by is not null or source <> 'manual');

-- One open prospect per phone (0012), where "open" now also means sales has not
-- closed them: a lead who comes back long after being closed is a new lead.
drop index public.prospects_open_phone;
create unique index prospects_open_phone on public.prospects (phone_e164) where converted_user_id is null and lost_at is null;

-- A HighLevel contact is one prospect.
create unique index prospects_highlevel_contact on public.prospects (highlevel_contact_id) where highlevel_contact_id is not null;
create index prospects_partner_idx on public.prospects (partner_id) where partner_id is not null;

alter table public.profiles
  add column referred_partner_id uuid references public.partners (id) on delete restrict,
  add column highlevel_contact_id text check (highlevel_contact_id is null or highlevel_contact_id ~ '^[A-Za-z0-9_-]{4,64}$');

-- The client's own connection may write their profile ("own profile", 0001),
-- but never who referred them to a partner or their HighLevel contact: those
-- decide commissions and are the server's to write. auth.uid() is set on a
-- signed-in person's connection and empty for the service role.
create function public.profiles_attribution_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.referred_partner_id is not null or new.highlevel_contact_id is not null) then
    raise exception 'profiles: partner and HighLevel attribution are written by the server only';
  end if;
  if tg_op = 'UPDATE' and (
    new.referred_partner_id is distinct from old.referred_partner_id
    or new.highlevel_contact_id is distinct from old.highlevel_contact_id
  ) then
    raise exception 'profiles: partner and HighLevel attribution are written by the server only';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_attribution_guard() from public;

create trigger profiles_attribution_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_attribution_guard();

-- The round-robin for leads that arrive with no salesperson: the last
-- salesperson who got one (team_settings.last_auto_assigned is the specialists').
alter table public.team_settings
  add column last_sales_assigned uuid references public.staff_members (user_id) on delete set null;

-- New kinds in the team's record.
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  -- Kept from 0015 (the autopilot's switches); this list replaces the whole constraint.
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded'
));

-- ── Stage updates for HighLevel ─────────────────────────────────────────

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  -- "<client or prospect id>:<stage>": the same stage of the same person is sent once.
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 200),
  destination text not null default 'highlevel' check (destination in ('highlevel')),
  stage text not null check (stage in (
    'invited', 'agreement_signed', 'cancelled_in_window', 'documents_complete',
    'first_round_mailed', 'paused_for_payment', 'service_ended'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000),
  created_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 50),
  next_attempt_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  sent_at timestamptz,
  gave_up_at timestamptz
);

create index integration_outbox_due_idx on public.integration_outbox (next_attempt_at) where sent_at is null and gave_up_at is null;

alter table public.integration_outbox enable row level security;

-- What an event may carry: the HighLevel contact, the phone, the stage and its
-- date, and the event's own id. Nothing about the credit file, ever. Checked on
-- the way in, whatever the server code does.
create function public.integration_outbox_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  key text;
begin
  if tg_op = 'DELETE' then
    raise exception 'integration_outbox: an event is never deleted';
  end if;
  if tg_op = 'INSERT' then
    for key in select jsonb_object_keys(new.payload) loop
      if key not in ('event', 'eventId', 'contactId', 'phone', 'stage', 'stageLabel', 'occurredAt', 'source', 'text') then
        raise exception 'integration_outbox: % may not be sent to HighLevel', key;
      end if;
    end loop;
    return new;
  end if;
  if new.id is distinct from old.id
    or new.dedupe_key is distinct from old.dedupe_key
    or new.destination is distinct from old.destination
    or new.stage is distinct from old.stage
    or new.payload is distinct from old.payload
    or new.created_at is distinct from old.created_at
  then
    raise exception 'integration_outbox: an event cannot be changed';
  end if;
  if old.sent_at is not null or old.gave_up_at is not null then
    raise exception 'integration_outbox: a delivered or abandoned event cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.integration_outbox_guard() from public;

create trigger integration_outbox_guard
  before insert or update or delete on public.integration_outbox
  for each row execute function public.integration_outbox_guard();

create table public.webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('highlevel')),
  -- sha256 of the exact body received.
  delivery_key text not null check (delivery_key ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  outcome text not null check (outcome in ('created', 'updated', 'existing_client', 'rejected')),
  prospect_id uuid,
  -- The names of fields that were dropped without being stored (an SSN, a date of birth). Never their values.
  dropped_fields text[] not null default '{}',
  unique (source, delivery_key)
);

alter table public.webhook_receipts enable row level security;

create trigger webhook_receipts_append_only
  before update or delete on public.webhook_receipts
  for each row execute function public.partner_records_append_only();

-- ── Who is a partner ────────────────────────────────────────────────────

-- The approved partner the signed-in person signs in for, or null.
create function public.partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.partner_id from public.partner_members m
  join public.partners p on p.id = m.partner_id
  where m.user_id = auth.uid() and p.status = 'approved';
$$;

-- The signed-in partner's referrals, with only a coarse status:
--   contacted      sales is talking with them, or they have an account but no signed agreement;
--   signed         they signed the service agreement and no round has been mailed yet;
--   active         at least one round of letters has been mailed and the service goes on;
--   not_continued  they cancelled, asked to end the service, or sales closed them.
-- First name and last initial only. Nothing from the credit file, the letters,
-- the agreement's terms or the payments.
create function public.partner_referrals()
returns table (referral_id uuid, first_name text, last_initial text, referred_at timestamptz, status text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.partner_id() as pid),
  people as (
    -- Referred as a prospect (the partner's form, or a HighLevel lead carrying their code).
    select p.id as referral_id, p.first_name, left(p.last_name, 1) as last_initial, p.created_at as referred_at,
           p.converted_user_id as user_id, p.lost_at
    from public.prospects p, me
    where me.pid is not null and p.partner_id = me.pid
    union all
    -- Came by the partner's link and signed up by themselves (no prospect row of this partner).
    select pr.id, split_part(btrim(pr.full_name), ' ', 1), left(split_part(btrim(pr.full_name), ' ', 2), 1), pr.created_at,
           pr.id, null::timestamptz
    from public.profiles pr, me
    where me.pid is not null and pr.referred_partner_id = me.pid
      and not exists (select 1 from public.prospects p2 where p2.converted_user_id = pr.id and p2.partner_id = me.pid)
  )
  select x.referral_id, x.first_name, x.last_initial, x.referred_at,
    case
      when x.lost_at is not null then 'not_continued'
      when a.cancelled_at is not null or a.service_end_requested_at is not null then 'not_continued'
      when a.signed_at is not null and exists (
        select 1 from public.attack_rounds r where r.user_id = x.user_id and r.mailed_at is not null
      ) then 'active'
      when a.signed_at is not null then 'signed'
      else 'contacted'
    end as status
  from people x
  left join lateral (
    select s.signed_at, s.cancelled_at, s.service_end_requested_at
    from public.service_agreements s
    where x.user_id is not null and s.user_id = x.user_id
    order by s.created_at desc
    limit 1
  ) a on true
  order by x.referred_at desc;
$$;

revoke all on function public.partner_id() from public;
revoke all on function public.partner_referrals() from public;
grant execute on function public.partner_id() to authenticated;
grant execute on function public.partner_referrals() to authenticated;

-- ── Read policies ───────────────────────────────────────────────────────

create policy "staff read partners" on public.partners
  for select using (public.staff_role() in ('admin', 'sales'));

create policy "partner reads own partner row" on public.partners
  for select using (id = public.partner_id());

create policy "partner reads own membership" on public.partner_members
  for select using (user_id = auth.uid());

create policy "admin read partner members" on public.partner_members
  for select using (public.staff_role() = 'admin');

create policy "admin read partner commissions" on public.partner_commissions
  for select using (public.staff_role() = 'admin');

create policy "partner reads own commissions" on public.partner_commissions
  for select using (partner_id = public.partner_id());

create policy "admin read outbox" on public.integration_outbox
  for select using (public.staff_role() = 'admin');

create policy "admin read webhook receipts" on public.webhook_receipts
  for select using (public.staff_role() = 'admin');
