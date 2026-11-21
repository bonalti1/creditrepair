-- A stated reason for every disputed item.
--
-- When a customer says an item is inaccurate they now pick a standard reason
-- ("this account is not mine", "I was never late"…). The letter prints that
-- reason's sentence after the item, because a dispute that gives no reason is
-- easy for a bureau to set aside.
--
-- item_flags.reason_code holds the code of the reason picked. The list of
-- reasons lives in the app (src/lib/letters/reasons.ts), and /api/flags only
-- accepts a code that is on it. The check here guards the shape of the value,
-- so nothing but a short code can be stored whatever route a write takes.
--
-- The column is nullable on purpose: an item confirmed before this change has
-- no reason code. It still counts, and its line in the letter carries no
-- reason. item_flags.reason stays what it was, the customer's own words. Those
-- words are shown to the team and are never printed in a letter.

alter table public.item_flags
  add column reason_code text
    check (reason_code ~ '^[a-z_]{2,40}$');
