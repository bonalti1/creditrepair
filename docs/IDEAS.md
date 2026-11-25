# Ideas and experiments

`/equipo/ideas`, section **8 · Ideas & numbers**, beside the business
dashboard (`/equipo/negocio`). The team's ideas to improve the business, the
tests run on them, and what every finished test taught (after ALTO Control's
Intelligence Center). Code: `src/lib/ideas/`; migration
`0040_ideas_launch.sql`; route `/api/staff/ideas`; weekly job
`/api/cron/ideas`.

## Who may do what

| | Everyone on the team (`ideas.add`) | An administrator (`ideas.approve`) |
| --- | --- | --- |
| See the board and the learnings | ✓ | ✓ |
| Add an idea | ✓ | ✓ |
| Edit an idea while it is New | their own | any |
| Approve, Not now, start a test, Keep or Drop | | ✓ |
| Ask Alti for ideas, see and decide Alti's proposals | | ✓ |

The route checks the role again (`requireCapability`), and the database
checks the order of statuses itself (`ideas_guard`): even the server cannot
skip a step.

## The board

An idea has: a title (one line), why (what was seen and what to change), the
department, the number it should move (a metric the console already counts,
or "something not counted yet"), what the author expects to happen to that
number, and the effort (S, M, L). Before adding, the form shows ideas already
on the board with a similar title.

The order: **New → Approved → Testing → Result: Kept or Dropped**, with what
was learned (required: at least a sentence). An administrator may say **Not
now** to a New or Approved idea, with the reason the team sees. Kept, Dropped
and Not now are final; the words are kept as they were approved; nothing is
deleted; every step is in `idea_events` (append-only) with who and when. A
test has a length (7 to 90 days); when its days are over the card says so and
asks for the decision.

On a laptop the board is four columns (New, Approved, Testing, Results); on a
phone one column at a time.

## Alti's proposals

«Ask Alti for ideas» (administrators): Alti, the AI assistant, reads the
numbers the console already computes and proposes **3 to 5 experiments**. The
rules (`src/lib/ideas/alti.ts`, `check.ts`):

- **Alti never types a number.** It cites the numbers by key; the server
  fills in each figure from its own snapshot (`basedOnFrom`). A proposal
  whose words contain a digit is dropped.
- Each proposal names the **metric to watch** and the **test length** (7 to
  60 days), and the numbers it is based on (one to six, each one that has a
  value).
- Every word passes the claim rules (`src/lib/compliance/guardrails.ts`:
  `checkMarketingCopy` and `checkClaimGuardrails`) and the house rules: never
  "free", no pressure or urgency, never SMS, only Texas (any other state, and
  Georgia, is dropped). A repeat of an idea already on the board, or of an
  open proposal, is dropped.
- **Nothing is acted on.** A proposal waits until an administrator taps «Add
  to the board» (it becomes a New idea, marked "Proposed by Alti · AI") or
  «Dismiss». The numbers stay on the proposal (administrators only); the idea
  on the board carries the words, the metric and the department.
- At most 5 asks a day, two a minute per person (each is a paid model call).
- Without `ANTHROPIC_API_KEY` the button is off and says Alti is not
  connected (Launch readiness lists the key). The demo shows **sample**
  proposals, labelled, and calls no model.

What Alti reads (`src/lib/ideas/signals.ts`), aggregates only (never a
client's or teammate's name, phone or email): from the business dashboard's
`businessMetrics` over 30 days (new leads, signed, conversion, cancellations,
churn, active clients, days to the first round, rounds mailed and behind,
a person's minutes per active client, net charged, failed and recovered
payments, chargeback rate, share paid by ACH); from the lead inbox's
`leadQuality` (leads this week, a person's first-reply time, contacted,
invited and signed rates, partner referrals this week); from the Overview's
content summary (posts made and scheduled this week, pieces waiting for
review, failed posts). A number that could not be read is "no data", never a
zero.

**Extension point (Ads, SEO, …):** a department built later adds one entry to
`SIGNAL_SOURCES` in `signals.ts`: its metrics (unit, window, which way is
better), their names in English and Spanish, and a `collect` that reads its
own summary from `input.extra[<its id>]`. The metric picker, the proposals,
the checks and the language test pick it up; then pass that summary in
`loadSignals` (`src/lib/ideas/server.ts`).

The model call (`altiModel.ts`): `claude-opus-5-5` (or `IDEAS_MODEL`),
structured JSON output, the fixed instructions cached, the API's refusal
fallback, effort medium. It logs no key and no prompt.

## The weekly run (optional)

`docs/n8n.md` Workflow 10: `POST /api/cron/ideas` once a week with the shared
secret. It asks Alti at most once in six days (a person's ask counts), leaves
the proposals for an administrator, and records a heartbeat. Without the key
it does nothing and says so.

## The learnings library

Every finished test (Kept or Dropped) with what it taught, searchable by
words (title, why, what was learned, the metric's name in either language).
«Ask Alti»'s playbook search finds them too («From a finished test»): it reads
the same board, only when the member types, and still only returns what the
team wrote.

## Tests

- `src/lib/__tests__/ideas.test.ts`: permissions, every transition from every
  status, edit rights, the strict body, the metrics and the extension point,
  aggregates only in what Alti is sent, every check a proposal must pass
  (numbers, promises, free, pressure, SMS, other states, unknown metrics,
  lengths, repeats, at most five), the demo's samples, the learnings search,
  Ask Alti's job and search, the menu.
- `src/lib/__tests__/db/ideasLaunch.test.ts`: on the real migrations with row
  level security: every active member reads ideas, clients and anon none,
  nobody writes directly; the order kept by the database; append-only
  history; proposals and runs for administrators only, decided once; the
  route end to end; Alti with a mocked model; the cron route's heartbeat.
