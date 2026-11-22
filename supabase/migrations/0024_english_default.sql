-- English first (November 2026). The owner's decision: the app is in English
-- first, then Spanish if needed. A client or visitor with no saved choice
-- starts in English (or in Spanish when their browser prefers Spanish, or a
-- salesperson's link says so: src/lib/i18n/detect.ts), and the language they
-- use is saved on their profile, which is what their automatic messages go
-- out in.
--
-- Only the DEFAULTS change, for rows created from now on. No existing row is
-- rewritten: a client whose profile says 'es' keeps Spanish, which is what
-- they have had so far.
--
--   profiles.locale           the client's language (app and messages)
--   outbound_messages.locale  an automatic message's language (always written
--                             explicitly by the server; the default is a fallback)
--   client_pulses.locale      the language a satisfaction answer was given in
--   waitlist.locale           the language of a waiting-list signup
--   partners.locale           NEW: the language a referral partner reads their
--                             portal in, which their milestone notices go out
--                             in. Partners who applied before this keep
--                             Spanish (every notice so far was Spanish); new
--                             ones start in English.

alter table public.profiles alter column locale set default 'en';
alter table public.outbound_messages alter column locale set default 'en';
alter table public.client_pulses alter column locale set default 'en';
alter table public.waitlist alter column locale set default 'en';

alter table public.partners add column locale text not null default 'es' check (locale in ('es', 'en'));
alter table public.partners alter column locale set default 'en';
