-- The staff console in two languages (docs/STAFF.md, "Language").
--
--   staff_preferences.locale   the language the console speaks to this member:
--                              'en' or 'es', chosen on /equipo/perfil or from
--                              the menu under their initial. Null until they
--                              choose; the console then follows their browser,
--                              else English. Written by the server only
--                              (POST /api/staff/preferences), like the rest of
--                              the row; read by the member.
--   saved_answers.language     the language a saved answer is written in. An
--                              answer goes to a client in the client's
--                              language, never the staff member's: the console
--                              suggests only answers in the client's language.
--                              Every answer saved before this migration was
--                              written in Spanish.
--   saved_answer_events.language  the same, kept with each recorded change.

alter table public.staff_preferences
  add column locale text check (locale is null or locale in ('en', 'es'));

alter table public.saved_answers
  add column language text not null default 'es' check (language in ('en', 'es'));

alter table public.saved_answer_events
  add column language text check (language is null or language in ('en', 'es'));
