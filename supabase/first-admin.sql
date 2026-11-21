-- Make yourself the first administrator of the staff console.
--
-- Not a migration: run it once, by hand, in the Supabase SQL editor, after
-- supabase/setup.sql. Replace the three values in angle brackets. No secret
-- goes in this file. See docs/DATABASE.md, step 6.
--
-- Way A (before you ever sign in, recommended): an invitation. The first time
-- you sign in at /login with this phone number, the app turns it into your
-- staff record and sends you to /equipo.

insert into public.staff_invitations (display_name, handle, role, phone_e164)
values ('<Your Name>', '<yourhandle>', 'admin', '+1<10 digits>');

-- Way B (you already signed in once): promote the account that has your phone.
-- Supabase keeps the phone without the "+", so '+17135550100' is '17135550100'.
--
-- insert into public.staff_members (user_id, role, handle, display_name, phone_e164, active)
-- select id, 'admin', '<yourhandle>', '<Your Name>', '+' || phone, true
-- from auth.users where phone = '1<10 digits>'
-- on conflict (user_id) do update set role = 'admin', active = true;
--
-- Check it worked (one row, role admin, active true):
-- select user_id, role, handle, active from public.staff_members;
