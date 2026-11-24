# Reviews

Every client is asked to leave a public review, **once**, at a moment every
client reaches, **whatever they think of the service**. Nothing is offered for
it. The links are the same for everyone, in the same order. Not legal advice:
the attorney reviews this design (questions at the end).

Code: `src/lib/reviews/` (`reviews.ts` the rules and words, `reply.ts` the
reply drafts, `server.ts` the database, `store.ts` the screens' data).
Screens: `/equipo/resenas` (the team), `/opina` (public, no sign-in, where the
message links), the "¿Cómo vamos?" pulse (`src/components/Pulse.tsx`).
Database: `supabase/migrations/0029_reviews.sql`. Tests:
`src/lib/__tests__/reviews.test.ts`, `src/lib/__tests__/db/bestPractices.test.ts`.

## The rules it follows, and where each is enforced

Researched on 2026-11-24 by web search (the eCFR and Cornell pages could not be
opened from the build environment; the rule text was read through the Federal
Register and FTC pages in search results).

| Rule | Source | In the app |
| --- | --- | --- |
| No incentive conditioned on a review's sentiment | FTC Consumer Reviews and Testimonials Rule, 16 C.F.R. § 465.4 (final rule 89 FR 68034, Aug. 22, 2024; in force Oct. 21, 2024): [Federal Register](https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials), [FTC Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers) | **No incentive of any kind**, not only sentiment-tied ones, because the platforms ban all incentives: [Google's prohibited practices](https://support.google.com/business/answer/4596773) (payment, discounts, free goods or services for a review), [Trustpilot's guidelines for businesses](https://legal.trustpilot.com/for-businesses/guidelines-for-businesses) ("no incentives"), [BBB](https://www.bbb.org/business/customer-reviews-policy) (rejects incentivized reviews even when disclosed). The schema has no reward column; `reviewCopyProblems` rejects incentive words ("discount", "gift card", "sorteo", "$10"…); the message says "We give nothing in exchange". The referral credit (migration 0026) is never mentioned with, or tied to, a review |
| No review gating (asking only those likely to be positive) | FTC Endorsement Guides, 16 C.F.R. § 255.2(e) (procuring or suppressing reviews in a way that distorts what consumers think), the FTC's 2022 notices of penalty offenses on review gating; Google ("selectively soliciting positive reviews" in its fake-engagement policy); Trustpilot ("invite all customers or none", no inviting only happy customers) | `reviewRequestDue` takes **no sentiment**: no pulse rating, no comment, no outcome, no hold. The milestones are facts everyone who stays reaches. "First new report after round 1" fires **whatever the report shows**, never only when something changed (that would pick clients by outcome). The pulse shows the **same links after every face**; a sad or neutral face *also* gets "Talk to the team", never *instead*. A held client is asked like anyone else. There is no per-client "do not ask" switch. Tests: "the pulse face plays no part", "a held client is asked", the schema and the run never read pulse ratings |
| No suppression of negative reviews | 16 C.F.R. § 465.7; Consumer Review Fairness Act, 15 U.S.C. § 45b (no form-contract clause restricting reviews) | Nothing asks anyone to remove or change a review: `replyProblems` rejects "remove your review", "quitar tu reseña", threats ("lawyer", "defamation"). A test reads the agreement for any non-disparagement or review clause (none) |
| No fake, staff or undisclosed insider reviews | 16 C.F.R. §§ 465.2, 465.5 | Only clients are asked; the console says "Nobody on the team, and no relatives, writes reviews of the company". The drafter writes replies, never reviews |
| A public reply reveals nothing private and promises nothing | GLBA privacy (a customer relationship with a financial-services company is nonpublic information), the claim rules (`docs/BRAND.md`) | `replyProblems`: no case words (report, round, letters, bureaus, payment…), no dates, no numbers, no "as our client"; no refund, credit or "we'll fix it"; the claim guardrails; only the first name the reviewer showed. Drafts that fail are rewritten once with the reasons, then the safe fallback. Nothing is posted from the app |
| Automatic messages | TCPA/CAN-SPAM rules as built in `docs/AUTOPILOT.md` | The request is a status message in the outbound log: opt-out (BAJA/STOP), quiet hours, the daily cap, the dedupe key `status:<user>:review_request` (once per client, ever), WhatsApp then email, **never SMS**, in the client's language |

## When a client is asked

`REVIEW_MILESTONES`, each with a switch in `/equipo/resenas` (off moves the ask
to the next milestone; it never excludes anyone):

| Milestone | Fires when | Channel |
| --- | --- | --- |
| `pulse_answered` | The pulse is answered after the first letters or the first answer, **any face** | In the app (no message) |
| `first_results` | Round 1's answers are in (the first new report after it), whatever it shows | WhatsApp / email |
| `referral_signed` | Someone the client referred (`client_referrals`) signed their agreement | WhatsApp / email |
| `program_finished` | The client asked to end the service (after the window), whatever their results | WhatsApp / email |

Not asked automatically: a client who cancelled inside the 3-day window, one
who opted out, or before asking is turned on (off by default) and a site is
set up. `/opina` stays public for anyone, including them.

The autopilot run (`runAutopilot`, step 1b) claims a `review_requests` row
(unique per client) before queueing the message, so a run twice asks once.

## The words

The message (`credalti_resena`, two parameters: name, link to `/opina?lang=`):

> Hi {{1}}, thank you for trusting us. If you have a minute, would you share in
> a review how your experience with Credalti has been, good or bad? Here are
> the sites: {{2}} Honest reviews help other people decide. We give nothing in
> exchange, and leaving one or not changes nothing about your service.

> Hola {{1}}, gracias por confiar en nosotros. Si tienes un minuto, ¿nos
> cuentas en una reseña cómo ha sido tu experiencia con Credalti, buena o mala?
> Aquí están los sitios: {{2}} Tu opinión honesta ayuda a otras personas a
> decidir. No damos nada a cambio, y dejarla o no, no cambia en nada tu
> servicio.

Meta will likely classify it as **Marketing**, not Utility. Approve both
languages under one name, like every template.

## Ratings

We do not read Google, Trustpilot or BBB ratings: a person types each one in
from the site's own page (who and when are kept). The dashboard number is the
average weighted by review count. `ReviewRatingProvider` in `reviews.ts` is the
hook for reading them by API, **not built**: Google Business Profile APIs
(OAuth as the profile owner, API access approval), Trustpilot's Business Units
API (a business account key); BBB has no known public rating API.

## For the attorney

1. Is the design above (milestones everyone reaches; same links after every
   pulse face, with the team line added for unhappy faces) free of gating
   under 16 C.F.R. § 255.2(e) and the platforms' rules?
2. Consent: is the agreement's consent to automated messages enough for a
   review request, or is it marketing that needs separate consent (TCPA /
   Texas)? Should it go only by email?
3. Asking after a request to end the service (`program_finished`): acceptable?
4. Referral credits exist (migration 0026). Confirm that a client who earned
   one may be asked for a review with no link between the two.
5. Can a reply to a public review acknowledge anything at all about the
   relationship (GLBA, state privacy law), or is the generic reply required?
