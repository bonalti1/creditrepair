-- Staff access for the console at /equipo.
--
-- Credalti is moving to full service: two members of staff run fulfillment for
-- every client, so they need to see client records. Until now each table was
-- readable only by the customer who owns the row.
--
-- What this adds:
--   - staff_members: who is on the team, their role, and whether they are active.
--   - is_staff(): true when the signed-in user is an active member of staff.
--   - "staff read" policies: an active member of staff can SELECT the client
--     tables the console shows.
--
-- What it does not add, on purpose: staff get no INSERT, UPDATE or DELETE
-- policy on any table. Everything staff do (send a round, add a note, mark an
-- exception handled) goes through the server, which checks is_staff() and
-- writes with the service role, so each action is validated and logged in one
-- place. In particular no policy lets staff write item_flags: which items are
-- disputed is the client's own answer.
--
-- Add a person (SQL editor, after they have signed in once):
--   insert into public.staff_members (user_id, role)
--   select id, 'specialist' from auth.users where phone = '+1XXXXXXXXXX';
-- Remove access without losing the record: set active = false.

create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- admin: everything, including the team list. specialist: fulfillment.
  -- sales: leads and invitations. The console does not yet tell them apart.
  role text not null check (role in ('admin', 'specialist', 'sales')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_members enable row level security;

-- Security definer so the check works inside other tables' policies without
-- giving anyone read access to the team list. search_path is pinned so the
-- function cannot be pointed at another schema's tables.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = auth.uid() and s.active
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- A member of staff can see their own row (their role); nobody can see the
-- whole list or change it through the database API. Rows are managed with the
-- service role.
create policy "own staff row" on public.staff_members
  for select using (auth.uid() = user_id);

-- Read-only access to client records. These sit beside the "own … read"
-- policies: a customer still sees only their own rows.
create policy "staff read profiles" on public.profiles
  for select using (public.is_staff());

create policy "staff read monitoring" on public.monitoring_subscriptions
  for select using (public.is_staff());

create policy "staff read pulls" on public.report_pulls
  for select using (public.is_staff());

create policy "staff read items" on public.report_items
  for select using (public.is_staff());

create policy "staff read flags" on public.item_flags
  for select using (public.is_staff());

create policy "staff read rounds" on public.attack_rounds
  for select using (public.is_staff());

create policy "staff read letters" on public.letters
  for select using (public.is_staff());

create policy "staff read letter items" on public.letter_items
  for select using (public.is_staff());

-- The rows only (which kinds are on file, and when). The files themselves are
-- in storage, which staff cannot read yet.
create policy "staff read documents" on public.identity_documents
  for select using (public.is_staff());

create policy "staff read chat" on public.chat_messages
  for select using (public.is_staff());

create policy "staff read events" on public.events
  for select using (public.is_staff());
