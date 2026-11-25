# The final pass: every department, top of the line (November 25, 2026)

The owner's ask: every department and tab ready to launch the day he says so,
run from Control, easy for a new teammate, and fulfillment at least as good as
Credit Repair Cloud. Several departments (Ads, Video Studio, SEO, Ideas,
Launch readiness, the fulfillment additions) were built in parallel and merged;
this pass walked all of it as one product, fixed what a user would notice,
and closed the known follow-ups. No business rule or invariant was changed.

## How it was checked

- **Demo mode, production build** (`npm run build` + `next start`), driven by
  Playwright (`scratchpad/crawl.js`): every console route (51 static routes
  plus a client's case and report, an invoice, a content piece, a video, a
  guide and its preview), every client-app screen (25) and the public pages
  (15, phone only) — 96 screens.
- **As each role** through the demo's "view as": administrator (Carmen),
  specialist (Marta), sales (Ana), and as the client.
- **At 1440 and 390 px, in English and Spanish.** Administrator: all four
  combinations; specialist and sales: all four; client: all four. About 860
  page loads per full run, three full runs (before, during, after).
- Per page: console errors and page errors (a hydration mismatch shows as a
  minified React error in a production build), HTTP errors, sideways scroll
  (and, after one was found, whether a phone browser zoomed the page out),
  every control under 44 px on a phone, every internal link fetched for a 404,
  and words of the other language on the page.
- **Judged by eye** against "a new teammate understands in 5 seconds what the
  screen is for and what to do first": a review sheet of every console screen
  (administrator, 1440, English) and of every client screen (390), then the
  fixes, then the same sheets again.
- `npx tsc --noEmit -p .`, `npx vitest run` and `npm run build` (results at
  the end).

## What was found and fixed, by section

### Known follow-ups (all five closed)

1. **The Video Studio on the Overview and in Today.** The Content card is now
   **Content & video**: a "Videos waiting for approval" line (with the videos
   sent back and the approved ones to hand to Content), and its «Needs you»
   adds the Video Studio's own rule (`videoNeeds`), opening the Video Studio
   when the board itself has nothing waiting. The Today list carries the
   videos exactly like Content's pieces: "Approve this video", "Changes
   requested on a video", "Hand this approved video to Content", each with its
   steps and «Done when». (`src/lib/control/marketing.ts`, `overview.ts`,
   `today.ts`; tests in `controlDepartments.test.ts`.)
2. **SEO and Ideas on the Overview.** Two compact cards in the same design:
   **2 · SEO** (site checks to fix — "No data yet" until a check has run —,
   guides waiting for approval, sent back, on the website) and **8 · Ideas &
   tests** (new ideas to approve, tests running, tests over to keep or drop,
   decided in the last 30 days; «Needs you» only for an administrator). The
   departments strip now lists every department in the menu's order (Video
   Studio, SEO and Ideas were missing): two rows of five on a laptop, one row
   that slides sideways on a phone. The menu's red circles did not change
   (no double count).
3. **Ideas reads the Ads Manager and SEO.** Two new sources in
   `src/lib/ideas/signals.ts`: Ads (leads and signed clients from ads this
   week, cost per lead, share of ad leads who signed, ads to turn off still
   spending) and SEO (Search Console's 28 days when connected, guides on the
   website, site checks to fix). The server fills every value
   (`ideas/server.ts loadSignals`); sample data, Meta not connected, Search
   Console not connected or no site check yet are "no data", never numbers.
   Tested in `ideas.test.ts`.
4. **The server's mailing gate holds a rejected document.**
   `src/lib/rounds/send.ts` step 1b (`documentHold`): a photo ID or proof of
   address whose current upload a person did not accept refuses the round
   (409 `document_not_accepted`), whoever sends it, with the reason staff read
   in their language ("Not sent: a required document wasn't accepted in review
   (Photo ID). The round goes out once the client uploads a new one and the
   team accepts it."). A newer upload makes the review out of date. The
   agreement gate (cancellation window), the unpaid-charge pause and the
   no-charge-before-work rule are untouched. Tests: `fulfillment.test.ts` and
   `db/fulfillment.test.ts` (the real migrations: held, nothing mailed, then
   sent after a new upload). The send's summary of held rounds, and the
   billing pause message, were Spanish in an English console: now translated
   (`staff/i18n/messages.ts`).
5. **"No name yet" for chat-signup leads.** The chat captured a first name but
   never sent it to the server. Now the progress call sends it once the person
   is signed in, and the server puts it on their lead if the lead has no name
   (never overwriting one; letters, accents, apostrophes and hyphens only).
   The Ads drawer and the lead inbox show it. Test in `db/controlLeads.test.ts`.

### One product, not five (shared pieces in `src/components/staff/ui.tsx`)

- **Demo notes: seven different looks → one `DemoNote`.** Content, Video,
  SEO, Ads' footnote aside, Accounting (small grey line), Letters (bordered
  banner), Letters packet, Plans, Ideas, Launch readiness, Import, Monitoring,
  States, Reviews, Partners and Offers (the last two were grey footnotes at the
  bottom) now share one note under the header: «Demo» · what is made up ·
  «Reset the example» where the department keeps its own example.
- **Switches: five designs (green or blue, 28–32 px) → one `Switch`**, navy
  when on, a 44 px target on a phone (Autopilot, Publishing, Reviews, Phone
  alerts).
- **Back links: four styles, some 21 px tall → one `BACK_LINK`** on every
  inner page (a client, a report, an invoice, a piece, a video, a guide and its
  preview, Send, Print, a letter, the attorney's packet).
- **The invite page** used its own round buttons and had a Spanish sentence
  hard-coded in the English console; it now uses the console's buttons and
  both languages.

### Phone (390 px)

- No page scrolls sideways (before or after). One regression found and fixed
  during the pass: the new sideways departments row made a phone browser zoom
  the whole Overview out; it is now paint-contained and the page is 390 wide.
- **44 px targets:** 39 controls on 15 screens were 32–40 px (selects, inputs
  and buttons in Autopilot, States, Team, Invoices, Reviews, Partners,
  Letters, Plans, Content's calendar and piece, the chargeback form, the
  calls queue, the language switch); links and summaries of 20–23 px (Home's
  "Add a client", "What the client got", a creditor's History, "See the
  letter", the business page's links, the autopilot's messages, Launch
  readiness items). All are now 44 px on a phone and keep their size on a
  laptop. In the client app: Sharing's "Change" and back link, the bureau
  letter upload, the payment page's buttons, "Share" on the home path.
- Left on purpose: the States map's tiles (32 px; every state is also in the
  full-size table below the map), footnote numbers inside a guide's text
  (WCAG's inline exception), the client page's "Change" (its hit area is
  already widened by a pseudo-element), a 42 px search field.

### Wording (plain, one language at a time)

- **Screen help missing for five sections**: Accounting, Reviews, States,
  Partner offers and Calls showed Home's help in «Ask Alti → This screen».
  Each now has its own, in both languages; a test fails if any menu
  destination lacks one (`consoleShell.test.ts`).
- English with Spanish quotation marks «…» (SEO, the Video Studio, Ask Alti's
  help): 25 strings now use “…”.
- The creditors' demo notes were Spanish in the English console: English now.
- Letters listed internal template keys (`dispute_611_accounts`); the list no
  longer shows them, the editor shows "ref." in small grey type (the
  attorney's packet uses it).
- Monitoring's month tabs read "2026-11": now "November 2026".
- Music rights read "confirmed by carmen on 2026-11-20": now "Carmen Ruiz on
  November 20, 2026" (the library and the editor).
- **"Free" in the client app** about Credalti's own build-your-credit plan
  (Home's card, "Build your credit", the graduation screen, the tips opt-in,
  three lines of the plan about other products): now "at no cost" /
  "sin costo", like the website.

### Dead ends

- **Send by mail** and **Print letters** with nothing chosen showed one grey
  sentence. Now Alti's empty state, what the screen is for, and a button to
  "Ready to send" on Home.

### Checked and fine

- No console error, page error or hydration error on any page, for any role,
  in either language (production build).
- No broken internal link (see "Left" for the two 404s by design).
- Every section has its «Ask Alti» entry (`altiHelp.ts`, tested) and now its
  screen help; Alti is "Alti · AI assistant" everywhere; AltiBot never appears
  in the console (`brand.test.ts`).
- Red circles and «✓ Clear»: the Overview's cards, the strip and the menu
  agree (Marketing = the board + Video Studio + SEO + ads to turn off, each
  from its own source, no double count); «Clear all notifications» hides and
  returns when a number goes up.
- Only Texas open; Georgia shown as restricted; no secrets anywhere (Launch
  readiness, Publishing and Local SEO show variable names only).
- Scores in the client app follow the owner's decision of 2026-11-22 (plain
  numbers, no gauges).

## Left, and why

- `/equipo/llamadas` answers 404 while calls are off (the default); it is not
  in any menu or link.
- `/guias` answers 404 until the first guide is published (docs/SEO.md); the
  only link to it is inside a guide's preview.
- **"Free" in consumer-rights text**: the federal rights statement, the FTC
  lessons ("disputing is free", "free weekly reports", "a free fraud alert")
  and the RESPA disclosure on the mortgage path say "free" about the law and
  the bureaus, not about Credalti. They are legal or attorney-reviewed text;
  changing them is the attorney's call (see "For the owner").
- Demo data stays in Spanish where a client wrote in Spanish (names,
  messages, a Spanish content piece): it is the client's language.
- Internal file names in a few owner-only notes (Launch readiness "docs/GO-
  LIVE.md", Offers "docs/AFTERCARE.md", Partners "docs/PARTNERS.md",
  Reviews "docs/REVIEWS.md"): they point the owner to the written guide.
- The Overview's last card (Tech health) sits alone on its row at 1440 px
  (ten cards in three columns). Cosmetic.
- An invoice's "Failed" chip is gold, not red. Cosmetic; the red count on the
  menu and the Money card carry the alarm.
- **Not checked:** dev-mode hydration warnings across every route (the dev
  server compiles each route for ~30 s; production errors were checked
  instead), a full keyboard-only walk (the console's navy focus ring is on
  everything focusable; tab order was not walked screen by screen), and
  anything that needs the database (the demo has none; the database paths
  are covered by the PGlite tests).

## For the owner

- Decide with the attorney whether the consumer-rights lessons should say
  "at no cost" instead of "free" (the statutory statement cannot change).
- Everything Launch readiness lists is still yours: the attorney's session,
  the Texas registration and bond, the payment processor, Meta and Search
  Console keys (Ads, Ideas' ad numbers and SEO's search numbers stay "no data"
  until then).

## Screens

Before / after and the final set: `scratchpad/final-audit/` (before,
after-crawl, changed); one contact sheet per menu group plus the client app:
`scratchpad/final-audit/sheets/`.
