-- Review states + letter outcome tracking.
--
-- item_flags.state mirrors the client review store: 'correct' (user verified
-- the item is fine — first-class answer, never enters a letter), 'flagged'
-- (believed inaccurate, attestation still pending), 'attested' (attestation
-- logged — eligible for letters).
--
-- letter_items outcome tracks what the bureau/furnisher did per item per
-- letter, so round N+1 letters can cite the actual prior response and MOV
-- escalation is grounded in a recorded "verified" outcome.

alter table public.item_flags
  add column state text not null default 'flagged'
    check (state in ('correct', 'flagged', 'attested'));

update public.item_flags set state = 'attested' where attested = true;

alter table public.letter_items
  add column outcome text
    check (outcome in ('deleted', 'corrected', 'verified', 'no_response')),
  add column outcome_at timestamptz,
  add column outcome_notes text;
