-- Conversation history, kept on the server so a client's thread with Capi
-- follows them across devices and so there is a record of what the AI said.
--
-- channel 'app'      : the in-app assistant thread (user_id always set)
-- channel 'whatsapp' : inbound/outbound WhatsApp turns, keyed by phone and
--                      linked to a user when the number matches a profile
--
-- source 'journey' : scripted assistant lines and the client's own taps,
--                    written by the client through /api/chat (RLS-bound)
-- source 'coach'   : AI-generated replies and the questions that prompted
--                    them, written only by the server (service role)
-- source 'human'   : a teammate taking over a thread (assisted plan)

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  phone_e164 text,
  channel text not null default 'app' check (channel in ('app', 'whatsapp')),
  role text not null check (role in ('user', 'assistant')),
  source text not null default 'journey' check (source in ('journey', 'coach', 'human')),
  body text not null check (char_length(body) between 1 and 4000),
  -- Provider message id (WhatsApp `wamid`), so a redelivered webhook is stored once.
  external_id text unique,
  created_at timestamptz not null default now(),
  check (user_id is not null or phone_e164 is not null)
);

create index chat_messages_user_idx on public.chat_messages (user_id, created_at desc);
create index chat_messages_phone_idx on public.chat_messages (phone_e164, created_at desc);

alter table public.chat_messages enable row level security;

create policy "own chat read" on public.chat_messages
  for select using (auth.uid() = user_id);

-- Clients may only add their own in-app journey lines. AI and human-teammate
-- rows come from the server, so a client cannot fabricate what the AI said.
create policy "own chat write" on public.chat_messages
  for insert with check (auth.uid() = user_id and channel = 'app' and source = 'journey');
