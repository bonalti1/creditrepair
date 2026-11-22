-- Client experience: the satisfaction pulse ("¿Cómo vamos?").
--
-- After a few key moments (agreement signed, first round mailed, first answer
-- from a bureau) the client app asks once, with three faces and an optional
-- comment. One row per client per moment.
--
--   Written:  only by the server (POST /api/pulse), after validating the body,
--             for the signed-in client and nobody else. No insert policy: a
--             client cannot write a row by talking to the database directly.
--   Read:     the client reads their own rows; staff read them by role through
--             the 0012 scope functions (admin: everyone; specialist: assigned
--             clients; sales: none, like the rest of the case).
--   Changed:  only one way: a comment the client adds right after tapping a
--             face, once, where there was none (POST /api/pulse again). A
--             trigger refuses every other change, even from the service role.
--             No update or delete policy for anyone: staff can never write,
--             edit or remove a client's answer.

create table public.client_pulses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  moment text not null check (moment in ('agreement_signed', 'first_round_mailed', 'first_answer')),
  -- 1 = not well, 2 = so-so, 3 = well.
  rating smallint not null check (rating between 1 and 3),
  comment text check (comment is null or char_length(btrim(comment)) between 1 and 500),
  locale text not null default 'es' check (locale in ('es', 'en')),
  created_at timestamptz not null default now(),
  unique (user_id, moment)
);

create index client_pulses_created_idx on public.client_pulses (created_at desc);

alter table public.client_pulses enable row level security;

create policy "own pulses read" on public.client_pulses
  for select using (auth.uid() = user_id);

create policy "staff read pulses" on public.client_pulses
  for select using (public.staff_can_see_case(user_id));

create function public.client_pulses_unchangeable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one change allowed: a first comment on an answer that had none.
  if old.comment is null and new.comment is not null
     and new.id = old.id and new.user_id = old.user_id and new.moment = old.moment
     and new.rating = old.rating and new.locale = old.locale and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'client_pulses rows cannot be changed';
end;
$$;

create trigger client_pulses_no_update
  before update on public.client_pulses
  for each row execute function public.client_pulses_unchangeable();
