-- A teammate's reply in a client's conversation carries the teammate's name.
--
-- chat_messages.source = 'human' already marks a message a person wrote
-- (migration 0004). This adds who: the name the client sees beside the
-- message ("Ana, del equipo"). It is empty on every message Capi or the
-- client wrote, and the check keeps it that way, so a name can never be
-- attached to an AI reply or to a line the client added.
--
-- Rows with source 'human' are written by the server only (clients may insert
-- 'journey' rows and nothing else), so a client cannot put a name here.

alter table public.chat_messages
  add column author_name text
  check (author_name is null or (source = 'human' and char_length(author_name) between 1 and 80));
