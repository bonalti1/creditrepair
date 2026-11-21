-- The team: roles that limit what each member sees, the team list, who works
-- each client, people added by hand, and a record of every change.
--
-- Until now every active member of staff could read every client record
-- (migration 0007), whatever their role. This migration makes the role count,
-- in the database itself, with the same scopes as the console's permission
-- matrix (src/lib/staff/permissions.ts; change both together):
--   admin       every client, every record.
--   specialist  the clients assigned to them (client_assignments): their
--               case (report, answers, rounds, letters, conversation) and
--               their billing, read-only.
--   sales       the clients they brought in (profiles.referred_by = their
--               handle): who the person is, the agreement and the documents
--               on file. Not the case, not the money.
--
-- What it adds:
--   - staff_members: a display name, a handle (the one sales links carry),
--     email, phone, when and by whom they were invited, and when they were
--     deactivated. Nobody is ever deleted: a member who leaves is deactivated,
--     loses access at once (is_staff() counts active members only) and their
--     name stays on everything they did.
--   - staff_invitations: someone added to the team who has not signed in yet.
--     The server turns it into a staff_members row the first time they sign in
--     with that email or phone.
--   - client_assignments: the teammate who works each client (one row per
--     client). team_settings: the round-robin switch.
--   - prospects: people sales added by hand before they have an account.
--   - team_audit: an append-only record of role changes, (de)activations,
--     invitations, assignments and prospects added. It cannot be edited or
--     deleted, by anyone.
--   - staff_role(), staff_handle(), staff_can_see_client(), staff_can_see_case(),
--     staff_can_see_billing(): the scopes above, for the read policies.
--   - The "staff read …" policies from 0007, 0010 and 0011 are replaced by the
--     same policies scoped by role. They stay read-only.
--
-- Who writes: only the server, with the service role, after checking the
-- caller's role (src/app/api/staff/*). No member of staff gets an insert,
-- update or delete policy on any table here, and clients read none of them.

-- ── Who is on the team ──────────────────────────────────────────────────

alter table public.staff_members
  add column display_name text not null default '' check (char_length(display_name) <= 80),
  add column handle text check (handle is null or handle ~ '^[a-z0-9-]{2,30}$'),
  add column email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  add column phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column invited_at timestamptz not null default now(),
  add column invited_by uuid references auth.users (id) on delete set null,
  add column deactivated_at timestamptz;

create unique index staff_members_handle_key on public.staff_members (handle) where handle is not null;

-- "active" and "deactivated_at" always agree: setting active = false (the way
-- 0007 says to remove access) dates it, and reactivating clears the date.
create function public.staff_members_track_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active then
    new.deactivated_at := null;
  elsif new.deactivated_at is null then
    new.deactivated_at := now();
  end if;
  return new;
end;
$$;

create trigger staff_members_track_active
  before insert or update on public.staff_members
  for each row execute function public.staff_members_track_active();

-- A member deactivated before this migration gets a date too.
update public.staff_members set deactivated_at = now() where not active and deactivated_at is null;

-- Deactivate, never delete: the row is the name on the member's work.
create function public.staff_members_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'staff_members: a member is deactivated (active = false), never deleted';
end;
$$;

create trigger staff_members_no_delete
  before delete on public.staff_members
  for each row execute function public.staff_members_no_delete();

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 80),
  handle text not null unique check (handle ~ '^[a-z0-9-]{2,30}$'),
  role text not null check (role in ('admin', 'specialist', 'sales')),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint staff_invitations_contact check (email is not null or phone_e164 is not null),
  constraint staff_invitations_accepted_pair check ((accepted_by is null) = (accepted_at is null))
);

alter table public.staff_invitations enable row level security;

-- ── Role helpers ────────────────────────────────────────────────────────
-- Security definer, like is_staff(): they read staff_members without giving
-- anyone the list. search_path is pinned.

create function public.staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.role from public.staff_members s where s.user_id = auth.uid() and s.active;
$$;

create function public.staff_handle()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.handle from public.staff_members s where s.user_id = auth.uid() and s.active;
$$;

-- ── Who works each client ───────────────────────────────────────────────

create table public.client_assignments (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Null: the client was left without anyone.
  staff_user_id uuid references public.staff_members (user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  -- Null: the round-robin did it.
  assigned_by uuid references auth.users (id) on delete set null,
  auto boolean not null default false
);

alter table public.client_assignments enable row level security;

create table public.team_settings (
  id boolean primary key default true check (id),
  auto_assign boolean not null default false,
  last_auto_assigned uuid references public.staff_members (user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.team_settings (id) values (true);

alter table public.team_settings enable row level security;

-- ── People added by hand ────────────────────────────────────────────────
-- Only what sales needs to start the conversation. There is no column for a
-- Social Security number or a date of birth, on purpose: the client gives
-- their identity data themselves, in their own app.

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 2 and 40),
  last_name text not null check (char_length(last_name) between 2 and 40),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  email text check (email is null or email ~ '^[^@ ]+@[^@ ]+\.[a-z]{2,24}$'),
  state text not null check (state ~ '^[A-Z]{2}$'),
  goal text not null check (goal in ('mortgage', 'auto', 'card', 'general')),
  -- The salesperson's handle, the same value an invite link writes to profiles.referred_by.
  salesperson text not null check (salesperson ~ '^[a-z0-9-]{2,30}$'),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  assigned_to uuid references public.staff_members (user_id) on delete restrict,
  -- Set when the person creates their account: from then on they are a client.
  converted_user_id uuid references auth.users (id) on delete set null,
  converted_at timestamptz
);

-- One open prospect per phone number.
create unique index prospects_open_phone on public.prospects (phone_e164) where converted_user_id is null;

alter table public.prospects enable row level security;

-- ── The record of every change ──────────────────────────────────────────
-- Plain ids, no foreign keys: a referential action would have to edit a row,
-- and rows here are never edited.

create table public.team_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- Null: the system (the round-robin).
  actor uuid,
  kind text not null check (kind in (
    'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
    'auto_assign_changed', 'client_assigned', 'prospect_added'
  )),
  member uuid,
  member_handle text,
  client_id uuid,
  prospect_id uuid,
  from_role text check (from_role is null or from_role in ('admin', 'specialist', 'sales')),
  to_role text check (to_role is null or to_role in ('admin', 'specialist', 'sales')),
  detail jsonb not null default '{}'
);

create index team_audit_at_idx on public.team_audit (at desc);
create index team_audit_client_idx on public.team_audit (client_id) where client_id is not null;

alter table public.team_audit enable row level security;

create function public.team_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'team_audit: the record of team changes is append-only';
end;
$$;

create trigger team_audit_append_only
  before update or delete on public.team_audit
  for each row execute function public.team_audit_append_only();

-- ── Scopes ──────────────────────────────────────────────────────────────

-- The client's record at all: who they are, the agreement, the documents on file.
create function public.staff_can_see_client(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active and (
      s.role = 'admin'
      or (s.role = 'specialist' and exists (
        select 1 from public.client_assignments a where a.user_id = client and a.staff_user_id = s.user_id
      ))
      or (s.role = 'sales' and s.handle is not null and exists (
        select 1 from public.profiles p where p.id = client and p.referred_by = s.handle
      ))
    )
  );
$$;

-- The case: report, answers, rounds, letters, conversation, events. Not sales.
create function public.staff_can_see_case(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_role() in ('admin', 'specialist') and public.staff_can_see_client(client);
$$;

-- Billing, read-only: payment method summary, charges, refunds, pauses. Not sales.
create function public.staff_can_see_billing(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_role() in ('admin', 'specialist') and public.staff_can_see_client(client);
$$;

revoke all on function public.staff_role() from public;
revoke all on function public.staff_handle() from public;
revoke all on function public.staff_can_see_client(uuid) from public;
revoke all on function public.staff_can_see_case(uuid) from public;
revoke all on function public.staff_can_see_billing(uuid) from public;
grant execute on function public.staff_role() to authenticated;
grant execute on function public.staff_handle() to authenticated;
grant execute on function public.staff_can_see_client(uuid) to authenticated;
grant execute on function public.staff_can_see_case(uuid) to authenticated;
grant execute on function public.staff_can_see_billing(uuid) to authenticated;

-- ── Read policies, scoped by role ───────────────────────────────────────
-- Same names, same tables, still select-only. The customers' own "own …"
-- policies are untouched.

drop policy "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles
  for select using (public.staff_can_see_client(id));

drop policy "staff read monitoring" on public.monitoring_subscriptions;
create policy "staff read monitoring" on public.monitoring_subscriptions
  for select using (public.staff_can_see_client(user_id));

drop policy "staff read documents" on public.identity_documents;
create policy "staff read documents" on public.identity_documents
  for select using (public.staff_can_see_client(user_id));

drop policy "staff read agreements" on public.service_agreements;
create policy "staff read agreements" on public.service_agreements
  for select using (public.staff_can_see_client(user_id));

drop policy "staff read pulls" on public.report_pulls;
create policy "staff read pulls" on public.report_pulls
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read items" on public.report_items;
create policy "staff read items" on public.report_items
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read flags" on public.item_flags;
create policy "staff read flags" on public.item_flags
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read rounds" on public.attack_rounds;
create policy "staff read rounds" on public.attack_rounds
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read letters" on public.letters;
create policy "staff read letters" on public.letters
  for select using (public.staff_can_see_case(user_id));

drop policy "staff read letter items" on public.letter_items;
create policy "staff read letter items" on public.letter_items
  for select using (exists (
    select 1 from public.letters l where l.id = letter_id and public.staff_can_see_case(l.user_id)
  ));

-- A WhatsApp message from a number with no account (user_id null) is for an administrator.
drop policy "staff read chat" on public.chat_messages;
create policy "staff read chat" on public.chat_messages
  for select using (public.staff_can_see_case(user_id) or (user_id is null and public.staff_role() = 'admin'));

drop policy "staff read events" on public.events;
create policy "staff read events" on public.events
  for select using (public.staff_can_see_case(user_id) or (user_id is null and public.staff_role() = 'admin'));

drop policy "staff read payment methods" on public.payment_methods;
create policy "staff read payment methods" on public.payment_methods
  for select using (public.staff_can_see_billing(user_id));

drop policy "staff read charges" on public.charges;
create policy "staff read charges" on public.charges
  for select using (public.staff_can_see_billing(user_id));

drop policy "staff read refunds" on public.refunds;
create policy "staff read refunds" on public.refunds
  for select using (public.staff_can_see_billing(user_id));

drop policy "staff read billing pauses" on public.billing_pauses;
create policy "staff read billing pauses" on public.billing_pauses
  for select using (public.staff_can_see_billing(user_id));

-- ── The team tables ─────────────────────────────────────────────────────

-- Teammates' names and roles, for the console (assignment, the activity log).
create policy "staff read team" on public.staff_members
  for select using (public.is_staff());

create policy "admin read invitations" on public.staff_invitations
  for select using (public.staff_role() = 'admin');

create policy "staff read assignments" on public.client_assignments
  for select using (public.staff_can_see_client(user_id));

create policy "staff read team settings" on public.team_settings
  for select using (public.is_staff());

create policy "staff read prospects" on public.prospects
  for select using (
    public.staff_role() = 'admin'
    or (public.staff_role() = 'specialist' and assigned_to = auth.uid())
    or (public.staff_role() = 'sales' and salesperson = public.staff_handle())
  );

create policy "admin read team audit" on public.team_audit
  for select using (public.staff_role() = 'admin');

create policy "staff read audit of their clients" on public.team_audit
  for select using (client_id is not null and public.staff_can_see_client(client_id));
