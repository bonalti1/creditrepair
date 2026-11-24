-- When the next round is due: from the evidence, not a fixed 40 days
-- (src/lib/rounds/timing.ts, nextRoundDue; docs/AUTOPILOT.md).
--
--   round_next_due(round, mailed_at)  The rule in SQL, the same as the
--        TypeScript one (a PGlite test runs both on the same rows):
--          receipt   per letter that reached someone (not returned or
--                    undeliverable): a certified letter's delivery scan; else
--                    its mailing date + 5 days (a First-Class "delivered" is an
--                    estimate and may only move the date later). The round's
--                    receipt is the latest.
--          window    receipt + 30 days (FCRA § 611(a)(1)(A)): never earlier.
--          due       window + 5 days (the bureau's mailed answer, the report's
--                    refresh), at most mailing + 45 days, unless the window
--                    itself ends later.
--
--   attack_rounds.next_round_due_at  Kept equal to it by triggers: when a
--        round is recorded as mailed (any path: the send, the printed batch),
--        and when one of its letters gets a delivery scan, comes back, or is
--        mailed again. The hourly re-pull (/api/cron/rounds) reads it, as it
--        always did. Rounds already mailed are recomputed below.
--
--   partner_progress_rows  The partner's "next round" date now uses the rule
--        (it was mailed_at + 40 days). Nothing else in the function changed.

create function public.round_next_due(p_round uuid, p_mailed_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with l as (
    select
      case
        when lt.mail_class in ('certified', 'certified_return_receipt') and lt.delivered_at is not null
          then greatest(lt.delivered_at, coalesce(lt.mailed_at, p_mailed_at))
        else greatest(coalesce(lt.mailed_at, p_mailed_at) + interval '5 days', coalesce(lt.delivered_at, '-infinity'::timestamptz))
      end as receipt
    from public.letters lt
    where lt.round_id = p_round and lt.mail_status not in ('returned', 'undeliverable')
  ),
  w as (
    select coalesce(max(l.receipt), p_mailed_at + interval '5 days') + interval '30 days' as window_end from l
  )
  select case
    when p_mailed_at is null then null
    else greatest(w.window_end, least(w.window_end + interval '5 days', p_mailed_at + interval '45 days'))
  end
  from w;
$$;

revoke all on function public.round_next_due(uuid, timestamptz) from public, anon;
grant execute on function public.round_next_due(uuid, timestamptz) to authenticated;

-- A round recorded as mailed (or its mailing date corrected): its date from the rule.
create function public.attack_rounds_next_due()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'mailed' and new.mailed_at is not null
     and (tg_op = 'INSERT' or old.mailed_at is distinct from new.mailed_at or old.status is distinct from new.status) then
    new.next_round_due_at := public.round_next_due(new.id, new.mailed_at);
  end if;
  return new;
end;
$$;

revoke all on function public.attack_rounds_next_due() from public;

create trigger attack_rounds_next_due
  before insert or update on public.attack_rounds
  for each row execute function public.attack_rounds_next_due();

-- A letter's delivery, return or re-mail moves its round's date.
create function public.letters_round_next_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or old.delivered_at is distinct from new.delivered_at
     or old.mail_status is distinct from new.mail_status
     or old.mailed_at is distinct from new.mailed_at
     or old.mail_class is distinct from new.mail_class then
    update public.attack_rounds r
       set next_round_due_at = public.round_next_due(r.id, r.mailed_at)
     where r.id = new.round_id and r.status = 'mailed' and r.mailed_at is not null;
  end if;
  return null;
end;
$$;

revoke all on function public.letters_round_next_due() from public;

create trigger letters_round_next_due
  after insert or update on public.letters
  for each row execute function public.letters_round_next_due();

-- Rounds already out: recomputed once (they were stored as mailed_at + 40 days).
update public.attack_rounds r
   set next_round_due_at = public.round_next_due(r.id, r.mailed_at)
 where r.status = 'mailed' and r.mailed_at is not null;

comment on column public.attack_rounds.next_round_due_at is
  'When the report is pulled again and the next round prepared: public.round_next_due (src/lib/rounds/timing.ts). Kept by triggers.';

-- ── The partner view: the same rule ─────────────────────────────────────

create or replace function public.partner_progress_rows(p_partner uuid, p_client uuid)
returns table (
  client_id uuid,
  display_name text,
  level text,
  how text,
  shared_at timestamptz,
  goal text,
  agreement_signed_at timestamptz,
  work_starts_at timestamptz,
  service_ended_at timestamptz,
  documents_complete_at timestamptz,
  review_finished_at timestamptz,
  rounds jsonb,
  disputing_count integer,
  no_longer_reported_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (c.user_id) c.user_id, c.level, c.how, c.seq
    from public.partner_share_consents c
    where c.partner_id = p_partner and (p_client is null or c.user_id = p_client)
      and (auth.uid() is null or (p_partner = public.partner_id() and public.partner_terms_ok()))
    order by c.user_id, c.seq desc
  ),
  sharing as (
    select l.*,
      (select min(c2.created_at) from public.partner_share_consents c2
        where c2.user_id = l.user_id and c2.partner_id = p_partner
          and c2.seq > coalesce((select max(c3.seq) from public.partner_share_consents c3
                                 where c3.user_id = l.user_id and c3.partner_id = p_partner and c3.level = 'none'), 0)
      ) as since
    from latest l
    join public.partners p on p.id = p_partner and p.status = 'approved'
    where l.level <> 'none'
  )
  select
    s.user_id,
    btrim(pr.full_name),
    s.level,
    s.how,
    s.since,
    case when pr.goal in ('mortgage', 'auto', 'card', 'general') then pr.goal else null end,
    a.signed_at,
    case when a.signed_at is not null and a.cancelled_at is null then a.cancellation_deadline else null end,
    coalesce(a.cancelled_at, a.service_end_requested_at),
    (select max(d.first_at) from (
        select min(i.uploaded_at) as first_at from public.identity_documents i
        where i.user_id = s.user_id and i.kind in ('government_id', 'proof_of_address') group by i.kind
      ) d having count(*) = 2),
    (select case when count(*) > 0 and count(f.item_id) = count(*) then max(coalesce(f.attested_at, f.created_at)) else null end
       from public.report_items ri
       left join lateral (
         select fl.item_id, fl.attested_at, fl.created_at from public.item_flags fl
         where fl.item_id = ri.id order by fl.created_at desc limit 1
       ) f on true
       where ri.user_id = s.user_id and ri.status = 'active'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', r.round_number,
        'mailed_at', r.mailed_at,
        'answer_due_at', w.window_start + interval '30 days',
        'next_round_at', public.round_next_due(r.id, r.mailed_at)
      ) order by r.round_number)
      from public.attack_rounds r
      cross join lateral (
        select greatest(r.mailed_at, coalesce(max(lt.delivered_at) filter (
          where lt.mail_class in ('certified', 'certified_return_receipt') and lt.mail_status = 'delivered'
        ), r.mailed_at)) as window_start
        from public.letters lt where lt.round_id = r.id
      ) w
      where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
    ), '[]'::jsonb),
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      where lt.round_id = (
        select r.id from public.attack_rounds r
        where r.user_id = s.user_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
        order by r.round_number desc limit 1
      )
    ) else null end,
    case when s.level = 'summary' then (
      select count(distinct li.item_id)::integer
      from public.letter_items li
      join public.letters lt on lt.id = li.letter_id
      join public.attack_rounds r on r.id = lt.round_id and r.status in ('mailed', 'complete') and r.mailed_at is not null
      join public.report_items ri on ri.id = li.item_id
      where lt.user_id = s.user_id and ri.status = 'deleted'
    ) else null end
  from sharing s
  join public.profiles pr on pr.id = s.user_id
  left join lateral (
    select sa.signed_at, sa.cancellation_deadline, sa.cancelled_at, sa.service_end_requested_at
    from public.service_agreements sa where sa.user_id = s.user_id
    order by sa.created_at desc limit 1
  ) a on true
  order by s.since desc;
$$;
