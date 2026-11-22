-- The report facts a client chose to put in their letter.
--
-- The review shows, on each report item, what the report's own data shows
-- ("Equifax shows a balance of $1,250 and Experian shows $900 for the same
-- account"): the data checks in src/lib/domain/checks.ts. They are worked out
-- from the report, never stored, and never answer for the client.
--
-- When the client marks an item inaccurate and picks a reason one of those
-- checks relates to, they may tick "include in my letter what my data shows".
-- item_flags.check_ids records which checks they ticked it for. Ids only: the
-- sentence printed in the letter is worked out again from the report rows on
-- the server (rounds/plan.ts: itemDetailsFromRows), and /api/flags keeps an id
-- only when that check is on the item and relates to the reason picked.
--
-- Written by the client, like the rest of their answer (the "own flags"
-- policy); staff read it and cannot write it (no staff write policy exists on
-- item_flags). Empty for every answer saved before this change, and for every
-- answer where the client did not tick the box.

alter table public.item_flags
  add column check_ids text[] not null default '{}'
    check (
      cardinality(check_ids) <= 20
      and array_to_string(check_ids, '|') ~ '^([a-z_]{2,40}:[A-Za-z+]{1,120}:[0-9a-f.]{1,200}(\|[a-z_]{2,40}:[A-Za-z+]{1,120}:[0-9a-f.]{1,200})*)?$'
    );

comment on column public.item_flags.check_ids is
  'Data checks (src/lib/domain/checks.ts) whose facts the client chose to include in the letter for this item. Set only by the client.';
