# AI intake: reading documents so a person only looks at what is doubtful

Three slow jobs in Credit Repair Cloud are a person reading a document: the
client's 3-bureau report, their ID and proof of address, and the paper answers
the bureaus mail back. In Credalti, Claude reads them, code checks every answer
before anyone sees it, and a person looks only at what the checks mark.

Code: `src/lib/intake/`. Routes: `src/app/api/staff/intake/{report,letter}`,
`src/app/api/intake/{document,letter}`. Table and bucket: migration
`0016_intake.sql`. Tests: `src/lib/__tests__/intake.test.ts` (validation, with
fake model answers), `src/lib/__tests__/db/intake.test.ts` (row level
security), `src/lib/__tests__/intake.live.test.ts` (opt-in, real API).

**What the AI never does.** It never decides what is inaccurate, negative or
worth disputing, and never marks an item for a letter. Only the client does
that, with their attestation, as before. The AI transcribes documents and
describes photos; the decisions (accepted, needs a person, which report item a
letter talks about) are made in code from rules written here.

## The three intakes

### 1. A credit report from a PDF or a saved page

Staff, on the client's page → **Importar reporte** → **Subir PDF del reporte**
(the `ai_document` reader in `src/lib/reports/readers.ts`). The client
downloads the 3-bureau report from their monitoring service (IdentityIQ,
SmartCredit, MyFreeScoreNow…) as a PDF or saves the page (HTML).

1. The server checks the file by its first bytes (PDF, HTML or text; up to
   20 MB for a PDF, 8 MB for a page) and keeps it in the private
   `intake-files` bucket.
2. Claude transcribes it into the app's report format with a strict JSON
   schema (`src/lib/intake/report/model.ts`): every account, inquiry, public
   record and personal entry, per bureau, each with **a page number and a
   short exact quote**, and a confidence (high / medium / low, with the reason
   when not high).
3. Code validates the answer (`report/validate.ts`) — see the rules below.
4. The import preview shows, first, **what the AI was not sure about**, each
   with its page and quote, plus the report-level warnings; then the usual
   "what changes" with those items marked **Revisar**; then every item read
   with high confidence and its quote. If anything is marked, the person ticks
   "Comparé con el documento los puntos marcados" before **Guardar reporte**.
5. Saving goes through the same route as any import (`/api/staff/reports`),
   which validates the reading again on the server.

### 1b. A lead's report before signup (the live funnel)

A person from a webinar or an ad uploads their own report on `/live`
(`docs/LIVE-FUNNEL.md`): 1 to 3 files (one per bureau from
annualcreditreport.com, or one 3-bureau report from IdentityIQ), checked by
their first bytes like any report and kept in the private **live-reports**
bucket (migration 0043), not in `intake-files` (there is no client yet). The
same reader (`extractReport`) reads each file after the upload answers;
`validateReportExtraction` checks every reading again; the readings are merged
(each bureau from the newest file; scores dropped) and turned into the team's
**review overview** (`src/lib/live/overview.ts`: counts, the § 605 time
limits, the data checks, the items the reader was not sure about). Nothing is
saved to a case. If they sign, «Import as the first report» saves the merged
reading through the ordinary import (`credalti_json` reader, the same rules);
a simulated reading (no key) is refused. If they don't, the files and the
overview are **deleted after 30 days** (`/api/cron/live`). This is the first
automatic purge of report files in the app.

### 2. ID and proof of address

The client uploads them where they always did (`IdentityDocs`). The file goes
to the private `identity-docs` bucket as before (it is the enclosure behind
each letter). Claude describes the picture (kind of document, legible or not,
problems such as glare or a cut-off edge, the name, the address, the statement
date, the expiry date). Code decides (`src/lib/intake/identity.ts`):

| Check | ID | Proof of address |
| --- | --- | --- |
| The right kind of document | government photo ID | bill, statement, lease, insurance, government letter, pay stub, other mail |
| Legible, no glare / cut-off / screen photo | ✓ | ✓ |
| Name matches the account: no accents or capitals, middle names and second surnames tolerated, the first name must match | ✓ | ✓ |
| Not expired | ✓ | — |
| Same house number, street and ZIP as the mailing address on file (apartment numbers ignored) | — | ✓ |
| Dated within `PROOF_OF_ADDRESS_MAX_AGE_DAYS` (90, in `config.ts`) | — | ✓ |
| The model was sure | ✓ | ✓ |

All pass → **accepted**: the client sees "Revisado automáticamente" with the
reasons, and nobody on the team is asked to look. Anything else →
**needs a person**, with plain Spanish reasons: the console shows a
"Documento para revisar" notice (`document_check_needs_person`). A newer
accepted upload clears it.

### 3. Bureau response letters — optional

**The source of truth for a round's results is the client's next report**,
compared with the one the round was written from (`src/lib/intake/outcomes.ts`):

- the item is gone → **deleted**;
- its fields changed → **updated**;
- still reported, unchanged, once the response window has closed → treated as
  **verified** (the basis for a method-of-verification letter next round);
- unchanged before the window closes → **pending**.

Nothing in the round cycle waits for, asks for, or reminds anyone about a
letter, and the absence of a letter creates nothing.

Letters are an extra. On the rounds page there is a low-key "¿Llegó una carta
de un buró?" with the copy "Si te llega una carta de un buró, puedes subirla
aquí. No es necesario: revisamos tu reporte de nuevo de todas formas." Staff
can also upload one on the client's behalf from the client page (Documentos →
"Subir una carta de un buró") when it reaches them another way.

Claude reads which bureau, the date, which items the letter mentions and what
it says happened to each (deleted / verified / updated / still under
investigation / more information requested / "frivolous" / unclear), with
citations. Code matches each item to the client's report by creditor name and
the last 4 digits of the account, preferring the item that was disputed when a
name matches more than one.

- **Only a letter that asks for more information or calls the dispute
  "frivolous"** creates a notice for a person (`bureau_letter_needs_person`).
  Those are the answers a report cannot show and that need someone to act.
- An item not found on the report, an unclear outcome or an unsure reading is
  written on the client page for staff, without a notice: the next report
  settles it anyway.
- In `roundOutcomes`, a letter only adds what a report cannot show (more
  information, frivolous, still investigating). On anything the report shows,
  the report wins, and a letter that disagrees is kept as a `conflict` for a
  person to see. `domain/attack.ts` is unchanged; `verifiedItems()` is there
  for the next round's escalation to use.

The client sees the letter's facts only ("Midland Credit Management ****8821:
la carta dice que lo quitaron de tu reporte."): no score, no promise, no
advice on what to dispute. A test runs every line through the claim
guardrails in Spanish and English.

## Validation rules (credit report)

Run on every reading, every time it is read (in the browser for the preview
and again on the server before saving):

**Thrown away whole, nothing stored:**
- anything that looks like a Social Security number (full or masked, 9 digits
  in a row, an "SSN"/"Social Security" label) or a birth date (by its label),
  anywhere in the answer, keys included.

**Cannot be used (shown as the reason):**
- the answer does not have the exact shape (strict schema check);
- not a credit report;
- no report date, or a date in the future;
- no bureau, or a bureau the document never mentions (checked against the
  page text for a saved page), or a bureau name that is not one of the three;
- no items at all.

**Item marked for a person ("Confianza baja"):**
- the model was not sure (its own words shown);
- an account number that came unmasked: saved as `****` + last 4 only;
- no account number;
- a date that is not a real date, before 1950, after the report date, or an
  opening date after the last-reported date: the date is left out;
- a balance or limit that is negative or above $10,000,000: left out;
- a page number outside the PDF (when its pages can be counted);
- a quote that is not in the page text (saved pages), or that does not name
  the creditor;
- a repeat of another entry in the same bureau (both marked).

**Left out ("No se guarda"):** no creditor / inquirer / record type, an
inquiry without a date, an item under a bureau the reading says the report
does not have, the second of a repeat.

**Report-level warnings:** per-bureau counts that differ from the summary the
report printed (accounts, inquiries, public records), no summary to compare,
parts the model could not read, a report older than 120 days.

Furnisher addresses are never taken from a reading: letters use only the
verified address book.

## What is sent to the AI, and what never is

| Document | Sent | Never sent / never kept |
| --- | --- | --- |
| Saved report page | The page's **text** (markup removed), with SSN-like numbers and birth dates replaced by `[REDACTED]` before sending | SSN, date of birth (removed before sending) |
| Report PDF | The PDF as is (no PDF library is installed to edit it). The instructions say to ignore the SSN, birth date and ID numbers and never write them; the answer is checked and thrown away whole if any appear | SSN and birth date are in the PDF the AI reads, but never in anything stored from it |
| ID, proof of address | The photo or PDF, and a short instruction. Name and address on file are **not** sent: they are compared in code | ID numbers (no field for them; an answer with a long digit run where a name or address goes is not used). Stored: only the status and the reasons |
| Bureau letter | The photo or PDF | Stored: bureau, date, per item the creditor, the last 4 digits, the outcome and the quote |

Nothing is sent without `ANTHROPIC_API_KEY`. The client's name, phone, email,
answers, attestation and the other documents are never sent.

## Model, cost, caching

- Model: `claude-opus-5-5` (Claude Opus 5.5; `INTAKE_MODEL` overrides it). It
  reads PDFs and images, answers in a strict JSON schema
  (`output_config.format`), and thinks adaptively; effort is set per kind
  (`high` for reports, `medium` for photos and letters). Requests stream, so a
  long report is not cut off by an HTTP timeout. `fallbacks: "default"` lets
  the API re-run a request a safety classifier declined on Anthropic's
  recommended fallback model.
- **Prompt caching:** the fixed instructions are the cached prefix
  (`cache_control: ephemeral` on the system prompt); repeated documents pay
  a tenth for them.
- **Every call logs** one JSON line (`where: "intake"`): task, model, input /
  output / cache tokens, estimated cost, how it ended. The estimate is also
  stored with the document (`intake_documents.cost_usd`).

Prices used for the estimate (`config.ts`): $4 per million input tokens, $20
per million output tokens, cache writes $5, cache reads $0.20 (Claude API
first-party rates, November 2026). Expected cost per document — **an estimate
until measured on real documents** (thinking tokens bill as output):

| Document | Input | Output | Estimate |
| --- | --- | --- | --- |
| 3-bureau report PDF, ~40 pages | ~120k tokens (text + page images) | ~15–25k | **~$0.80–1.00** (≈$0.40 for 15 pages, ≈$2 for 80) |
| Same report as a saved page | ~40–80k tokens of text | ~15–25k | **~$0.50–0.80** |
| ID or proof of address photo | ~3k | ~1–2k | **~$0.03–0.05** |
| Bureau letter, 1–3 pages | ~5–8k | ~2–4k | **~$0.06–0.10** |

Rough yearly cost per client: a report per round (about 9 a year) plus two
documents: **~$8–10 a client a year**. Once the logs show real numbers, the
owner can try `INTAKE_MODEL=claude-sonnet-5-5` ($2 / $10 per million) on the
same documents and keep it only if the accuracy holds.

## Accuracy limits

- **No real provider sample has been read yet.** The instructions and checks
  were built against a fictional layout (`src/lib/intake/__fixtures__/`). The
  first real IdentityIQ / SmartCredit / MyFreeScoreNow reports should be read
  with a person checking every line, and the instructions tuned.
- Side-by-side layouts (one column per bureau) are where a value can land
  under the wrong bureau. The model is told to mark such doubts; the summary
  count check catches missing or extra accounts only when the report prints a
  summary.
- For PDFs this app cannot read the text itself, so quotes cannot be checked
  against the document (they can for saved pages), and pages are counted only
  when the PDF keeps them uncompressed.
- Scanned, image-only PDFs and blurry photos read worse; very long reports can
  run past the output limit (the reading then fails and says so).
- Name and address matching is deliberately strict: in doubt it goes to a
  person.

## How a person reviews

- **Reports:** on the import screen, before anything is saved: the marked
  items with page and quote, the warnings, a checkbox, then "Guardar reporte".
- **ID / proof of address:** the "Documento para revisar" notice on the
  console's list and the client page (Documentos → Revisión automática). The
  person looks at the photo, then marks the notice as handled or asks the
  client for a new one (the drafted WhatsApp message asks for a clear, recent
  photo).
- **Bureau letters:** the "Carta de un buró para revisar" notice when a letter
  asks for more information or says "frivolous". Other letters are listed on
  the client page with what was read, for reference.

## Demo and "no key" behaviour

- **Demo (no database):** every flow works with **simulated** results, labelled
  as such: a reading of the demo report with one Experian card marked unsure;
  an ID accepted and a proof of address that needs a person; an Equifax letter
  that asks for more information about an account not on the report. Nothing
  is stored and no AI is called.
- **Database without a key:** files are stored, but no check passes: every
  ID and proof of address goes to a person, a letter is kept unread, and a
  simulated report reading can be previewed but is refused on save.

## Retention

- `intake_documents` rows are records (an update is refused by the database);
  they go with the client's account (`on delete cascade`).
- Files: ID and proof of address stay in `identity-docs` while they are the
  letters' enclosures. Report PDFs and letters stay in `intake-files`. **No
  automatic purge is built yet.** Proposal for the attorney: delete report
  files 90 days after the next report is saved, letters at the end of the
  service, ID files at the end of the service; keep the records.
- On the AI vendor's side: per Anthropic's commercial API terms at the time of
  writing, API inputs and outputs are not used for training and are kept for a
  limited period (30 days by default); zero data retention can be requested.
  **Confirm the current terms and sign the data processing addendum before
  sending a real client's report.**

## Questions for the attorney (and the owner)

1. **GLBA Safeguards Rule (16 CFR 314).** Is Credalti a "financial
   institution" under the FTC rule (credit repair / counseling is listed as a
   financial activity)? If so: the written information security program must
   cover the AI vendor as a **service provider** — a risk assessment, a
   contract requiring safeguards, and periodic oversight — plus encryption,
   access control, and the FTC notice for a breach affecting 500+ consumers.
   Is Anthropic's commercial terms + DPA enough as the service-provider
   contract?
2. **Texas Business & Commerce Code ch. 521** (sensitive personal
   information, breach notice): anything specific to sending report data to a
   vendor?
3. **Data processing terms with the AI vendor:** DPA signed, no training on
   our data, retention period (or zero retention), sub-processors, US-only
   processing (`inference_geo` can pin it), breach notice to us.
4. **The client's consent.** The agreement does not mention AI today. Proposed
   wording, **pending attorney review — not added to the agreement**
   (`docs/AGREEMENT.md` and the documents in `src/lib/agreement/` are
   unchanged):

   > **ES:** Para preparar tu caso, Credalti usa un servicio de inteligencia
   > artificial (Anthropic) que lee los documentos que tú o nuestro equipo
   > suben: tu reporte de crédito, tu identificación, tu comprobante de
   > domicilio y las cartas de los burós. La IA solo lee y revisa esos
   > documentos; no decide qué es inexacto ni qué se disputa: eso lo decides
   > tú. Antes de enviar un documento quitamos tu número de Seguro Social y tu
   > fecha de nacimiento cuando es posible, y no guardamos los números de tu
   > identificación. Una persona de nuestro equipo revisa todo lo que la
   > revisión automática no puede confirmar. Puedes pedir que una persona
   > revise tus documentos sin usar la IA escribiéndonos a
   > [PENDIENTE: correo].
   >
   > **EN:** To prepare your case, Credalti uses an artificial intelligence
   > service (Anthropic) that reads the documents you or our team upload: your
   > credit report, your ID, your proof of address and the bureaus' letters.
   > The AI only reads and checks those documents; it does not decide what is
   > inaccurate or what is disputed: you do. Before sending a document we
   > remove your Social Security number and date of birth where possible, and
   > we do not store your ID numbers. A person on our team reviews anything the
   > automatic check cannot confirm. You can ask for a person to review your
   > documents without the AI by writing to [PENDING: email].

   Should it be in the agreement, the disclosures, the privacy notice, or a
   separate checkbox? Does an opt-out have to be offered?
5. **PDFs carry the SSN and birth date to the vendor** (they cannot be removed
   from a PDF here). Acceptable under the vendor terms, or should only saved
   pages (which are redacted) be accepted until a redaction step exists?
6. **Retention** of report files, ID photos and letters (proposal above).
7. **FCRA / CROA:** any issue with an automated "accepted" on an ID (a person
   does not see every ID)? Any issue with telling the client what a bureau
   letter says, worded as the letter's facts?

## What still needs a real sample

- A real 3-bureau report from **IdentityIQ** (the chosen provider), as PDF and
  as a saved page, then SmartCredit and MyFreeScoreNow: to measure accuracy,
  cost and tokens, tune the instructions to their layouts (summary section
  names, column order, how they mask accounts), and decide whether PDFs or
  saved pages read better.
- Real ID photos and bills (with consent): the legibility and name/address
  rules, and the 90-day window.
- Real bureau letters from each bureau: their wording for each outcome.
- The live test (`intake.live.test.ts`) has not been run in this environment
  (no API key). Run it once the key is set:
  `ANTHROPIC_API_KEY=… npx vitest run src/lib/__tests__/intake.live.test.ts`.
