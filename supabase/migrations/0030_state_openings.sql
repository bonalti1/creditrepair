-- Which states Credalti sells in (src/lib/compliance/states.ts, stateRules.ts;
-- docs/STATES.md).
--
--   state_openings  One row per state an administrator has decided about:
--                   opened or not, and for an opened state the attorney who
--                   reviewed it and the date, the state registration or
--                   license reference, and that the bond is in force (the
--                   server asks for the last two only where the state's law
--                   does). Texas, the launch state, starts opened (Phase 0);
--                   every other state starts closed: a missing row is closed.
--                   Read by staff; written by the server for an
--                   administrator ("states.manage"), each change in the
--                   team's audit. Leads, invitations and signups from a state
--                   not opened are refused politely or put on the waitlist.
--
--   waitlist        Takes a phone instead of an email (a HighLevel lead from
--                   a closed state may have no email) and says where it came
--                   from.
--
--   webhook_receipts  A HighLevel lead from a closed state is recorded as
--                   'waitlisted', not made a prospect.

create table public.state_openings (
  state text primary key check (state ~ '^[A-Z]{2}$'),
  opened boolean not null default false,
  attorney_name text check (attorney_name is null or char_length(attorney_name) between 3 and 120),
  attorney_reviewed_on date,
  registration_ref text check (registration_ref is null or char_length(registration_ref) between 2 and 120),
  bond_confirmed boolean not null default false,
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text check (updated_by_name is null or char_length(updated_by_name) between 1 and 80),
  -- An opened state carries the attorney's review (Texas, the launch state, is gated by the agreement's own approval).
  constraint state_openings_open_reviewed check (not opened or state = 'TX' or (attorney_name is not null and attorney_reviewed_on is not null)),
  -- Georgia's statute makes operating a credit repair services organization a misdemeanor (O.C.G.A. § 16-9-59).
  constraint state_openings_not_restricted check (not opened or state <> 'GA')
);

insert into public.state_openings (state, opened, note) values ('TX', true, 'Launch state (Phase 0).');

alter table public.state_openings enable row level security;
create policy "staff read state openings" on public.state_openings for select using (public.is_staff());

create trigger state_openings_guard
  before update or delete on public.state_openings
  for each row execute function public.review_settings_guard();

-- The waitlist: a phone instead of an email, and where it came from.
alter table public.waitlist alter column email drop not null;
alter table public.waitlist
  add column phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  add column source text not null default 'web' check (source in ('web', 'highlevel', 'invite', 'partner')),
  add constraint waitlist_reachable check (email is not null or phone_e164 is not null);

alter table public.webhook_receipts drop constraint webhook_receipts_outcome_check;
alter table public.webhook_receipts add constraint webhook_receipts_outcome_check
  check (outcome in ('created', 'updated', 'existing_client', 'rejected', 'waitlisted'));

alter table public.team_audit drop constraint team_audit_kind_check;
alter table public.team_audit add constraint team_audit_kind_check check (kind in (
  'member_invited', 'member_joined', 'role_changed', 'member_deactivated', 'member_reactivated',
  'auto_assign_changed', 'client_assigned', 'prospect_added',
  'autopilot_changed',
  'prospect_updated', 'prospect_invited', 'partner_applied', 'partner_status_changed',
  'partner_commission_set', 'partner_commission_recorded',
  'household_member_added', 'card_brands_changed',
  'reviews_changed',
  -- Added here; this list replaces the whole constraint.
  'state_opening_changed'
));
