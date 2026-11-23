-- Accepted card brands, and household signup (Credit Repair Cloud added both
-- in November 2026).
--
--   billing_card_settings  Which card brands the business takes: one row.
--                          Visa and Mastercard on, American Express and
--                          Discover off by default (many merchant accounts
--                          that take credit repair refuse them). At least one
--                          stays on. Read by staff; written by the server for
--                          an administrator. The payment-method route refuses
--                          to put a card of a brand that is off on file
--                          (src/lib/billing/cardBrands.ts). Cards already on
--                          file keep working.
--
--   household_members      A household member added on the invite (staff) or
--                          in the client's onboarding: a person of their own,
--                          a prospect (source 'household') with their own
--                          invitation, and later their own login, agreement and
--                          disputes. The row only links the two people. When
--                          both have accounts, the link becomes a
--                          household_links row (migration 0026) by itself, the
--                          link the plan's household discount reads.
--
-- What a household never does: share data. Every case table keeps its
-- owner-only read policy (a client reads their own rows, nobody else's); a
-- household member has no policy that reaches the other's report, answers,
-- letters, agreement, documents or money, and clients read no row here at
-- all. Staff read households by role, like the people in them. Pausing,
-- cancelling and billing stay per person.

-- ── Accepted card brands ────────────────────────────────────────────────

create table public.billing_card_settings (
  id boolean primary key default true check (id),
  visa boolean not null default true,
  mastercard boolean not null default true,
  amex boolean not null default false,
  discover boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text not null default '' check (char_length(updated_by_name) <= 80),
  constraint billing_card_settings_one_on check (visa or mastercard or amex or discover)
);

insert into public.billing_card_settings (id) values (true);

alter table public.billing_card_settings enable row level security;
create policy "staff read card settings" on public.billing_card_settings for select using (public.is_staff());

create function public.billing_card_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'billing_card_settings: the setting is kept; change it instead';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger billing_card_settings_guard
  before update or delete on public.billing_card_settings
  for each row execute function public.billing_card_settings_guard();

-- ── Household members ───────────────────────────────────────────────────

-- A household member is a prospect like any other, with 'household' as where they came from.
alter table public.prospects drop constraint prospects_source_check;
alter table public.prospects add constraint prospects_source_check check (source in ('manual', 'highlevel', 'partner', 'household'));
-- A household member added by a client who came without a salesperson has none.
alter table public.prospects alter column salesperson drop not null;
alter table public.prospects add constraint prospects_salesperson_present check (salesperson is not null or source = 'household');
-- The language their invitation and app go in.
alter table public.prospects add column locale text check (locale is null or locale in ('en', 'es'));

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  -- The person who added them: a client with an account, or a prospect.
  primary_user_id uuid references auth.users (id) on delete cascade,
  primary_prospect_id uuid references public.prospects (id) on delete cascade,
  -- The household member: always a prospect first (their own invitation).
  member_prospect_id uuid not null references public.prospects (id) on delete cascade,
  -- Names as they were given, so each side can be shown without reading the other's record.
  primary_name text not null check (char_length(primary_name) between 1 and 80),
  member_name text not null check (char_length(member_name) between 2 and 80),
  relationship text not null check (relationship in ('spouse', 'partner', 'family')),
  added_by text not null check (added_by in ('staff', 'client')),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '' check (char_length(created_by_name) <= 80),
  created_at timestamptz not null default now(),
  -- Set when both have accounts and the household link exists.
  link_id uuid references public.household_links (id) on delete restrict,
  ended_at timestamptz,
  constraint household_members_one_primary check (num_nonnulls(primary_user_id, primary_prospect_id) = 1),
  constraint household_members_not_self check (primary_prospect_id is null or primary_prospect_id <> member_prospect_id)
);

-- A person is added as a household member once, and a household is two people.
create unique index household_members_member_once on public.household_members (member_prospect_id);
create unique index household_members_open_user on public.household_members (primary_user_id) where ended_at is null and primary_user_id is not null;
create unique index household_members_open_prospect on public.household_members (primary_prospect_id) where ended_at is null and primary_prospect_id is not null;

alter table public.household_members enable row level security;

-- Staff by role: the people in it decide. A member of staff who may see
-- either person (as a client or as a prospect) sees the household row, and
-- nothing more of the other person than this row says.
create function public.staff_can_see_household(primary_user uuid, primary_prospect uuid, member_prospect uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_role() = 'admin'
    or (primary_user is not null and public.staff_can_see_client(primary_user))
    or exists (
      select 1 from public.prospects p
       where p.id in (primary_prospect, member_prospect)
         and (
           (p.converted_user_id is not null and public.staff_can_see_client(p.converted_user_id))
           or (public.staff_role() = 'specialist' and p.assigned_to = auth.uid())
           or (public.staff_role() = 'sales' and p.salesperson = public.staff_handle())
         )
    );
$$;

create policy "staff read household members" on public.household_members
  for select using (public.staff_can_see_household(primary_user_id, primary_prospect_id, member_prospect_id));

-- Rows are a record: only ending one, or recording its link, changes it.
create function public.household_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'household_members: a household is a record; end it instead';
  end if;
  if new.primary_user_id is distinct from old.primary_user_id or new.primary_prospect_id is distinct from old.primary_prospect_id
     or new.member_prospect_id <> old.member_prospect_id or new.relationship <> old.relationship or new.created_at <> old.created_at
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.link_id is not null and new.link_id is distinct from old.link_id) then
    raise exception 'household_members: only the end and the link can be recorded';
  end if;
  return new;
end;
$$;

create trigger household_members_guard
  before update or delete on public.household_members
  for each row execute function public.household_members_guard();

-- When both people of an open household have accounts, link them for the
-- household discount (household_links, one household at a time). Runs when a
-- prospect becomes a client and when a household row is added.
create function public.household_try_link(household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.household_members%rowtype;
  a uuid;
  b uuid;
  lid uuid;
begin
  select * into h from public.household_members where id = household;
  if not found or h.ended_at is not null or h.link_id is not null then
    return;
  end if;
  a := coalesce(h.primary_user_id, (select p.converted_user_id from public.prospects p where p.id = h.primary_prospect_id));
  b := (select p.converted_user_id from public.prospects p where p.id = h.member_prospect_id);
  if a is null or b is null or a = b then
    return;
  end if;
  if public.household_partner(a) is not null or public.household_partner(b) is not null then
    return;
  end if;
  insert into public.household_links (user_a, user_b, created_by, created_by_name)
    values (least(a, b), greatest(a, b), h.created_by, 'Household signup')
    returning id into lid;
  update public.household_members set link_id = lid where id = h.id;
end;
$$;

create function public.household_members_link_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.household_try_link(new.id);
  return new;
end;
$$;

create trigger household_members_link_on_insert
  after insert on public.household_members
  for each row execute function public.household_members_link_on_insert();

create function public.household_members_link_on_convert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h record;
begin
  if new.converted_user_id is null or new.converted_user_id is not distinct from old.converted_user_id then
    return new;
  end if;
  for h in
    select id from public.household_members
     where ended_at is null and link_id is null and (member_prospect_id = new.id or primary_prospect_id = new.id)
  loop
    perform public.household_try_link(h.id);
  end loop;
  return new;
end;
$$;

create trigger household_members_link_on_convert
  after update of converted_user_id on public.prospects
  for each row execute function public.household_members_link_on_convert();

-- Whether the plan's household discount goes in this person's agreement: they
-- are linked to another client (household_links), or they are in an open
-- household from the signup flow (as the one who added a member, or as the
-- member). The first of the two to sign does not lose it waiting for the
-- second. Called by the server with the service role; a client calling it
-- reads nothing (no policy here or on household_links lets them), so it
-- answers false and tells them nothing about anyone.
create function public.household_discount_applies(uid uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.household_partner(uid) is not null
      or exists (
        select 1
          from public.household_members h
          left join public.prospects pp on pp.id = h.primary_prospect_id
          join public.prospects mp on mp.id = h.member_prospect_id
         where h.ended_at is null
           and (h.primary_user_id = uid or pp.converted_user_id = uid or mp.converted_user_id = uid)
      );
$$;

-- The team's record of who added a household member (team_audit, append-only).
alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded',
  -- Added here; this list replaces the whole constraint.
  'household_member_added', 'card_brands_changed'
));
