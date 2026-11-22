# "Aprende": lessons and tools

Ten short lessons about credit, in Spanish and English, and two tools. The
content is `src/lib/learn/lessons.ts` and `src/lib/learn/calculators.ts`; the
pages are `/aprende`, `/aprende/[slug]` and `/aprende/herramientas/*`.

Rules, checked by `src/lib/__tests__/learn.test.ts`:

- At most 150 words per lesson per language; no sentence over 25 words.
- Every title, summary and paragraph passes `checkClaimGuardrails` and
  `checkMarketingCopy`. No score promises, no outcome claims.
- Every lesson lists its sources, each with its URL, the day it was checked and
  a status.
- The scams lesson says plainly that no one can legally remove accurate, timely
  information, and that you can dispute errors yourself, for free (the Credit
  Repair Organizations Act requires telling consumers they can do it
  themselves).
- Characters: AltiBot presents the lessons that explain how credit works, and
  the lesson says he is AI. Alti illustrates the identity theft and scams
  lessons, as the face of the team; he is never the author.

## Sources and their status

Checked on 2026-11-22. The official pages could not be opened from the build
environment (its network does not reach consumerfinance.gov or
consumer.ftc.gov), so each fact marked **verified** was confirmed against the
official page's text through a web search restricted to that site. **A person
should open each link once before launch.** Facts marked **needs review**
could not be confirmed and say "Pendiente de revisión" on screen.

| Lesson | Fact | Source | Status |
| --- | --- | --- | --- |
| reporte | Free weekly reports; AnnualCreditReport.com is the only authorized site | FTC, free weekly credit reports (2023) | verified |
| reporte | What a credit report contains | FTC, Understanding Your Credit | needs review |
| buros | Nationwide and specialty reporting companies | CFPB, Consumer reporting companies | verified |
| disputa | Disputes are free; investigated within 30 days | FTC, Disputing Errors on Your Credit Reports | verified |
| disputa | Accurate negative information generally cannot be removed | CFPB, ask-cfpb 1249 | verified |
| disputa | Disputing information you know is accurate is not legal | FTC alert, January 2026 | verified |
| cuanto-tiempo | 7 years for most negative items; bankruptcy up to 10; exceptions over $75,000 / $150,000 | CFPB, ask-cfpb 323 | verified |
| cuanto-tiempo, cobranza | Collections and charge-offs: 7 years from 180 days after the first delinquency | 15 U.S.C. § 1681c (FCRA § 605) | verified |
| cuanto-tiempo | Paying or selling the debt does not restart the period | FTC advisory opinion (Kosmerl, 1999) | verified |
| cobranza | Date of delinquency is when the late payment began, not the collection date | FTC, What Information Furnishers Need to Know | verified |
| cobranza | The same debt can show with the original creditor and the collector | CFPB, How do collections affect my credit? | needs review |
| utilizacion | Balances ÷ limits; many experts suggest under 30% | CFPB, How do I get and keep a good credit score? | verified |
| pagos | Reported late at 30 days; payment history weighs most | CFPB, Understand your credit score | needs review |
| consultas | Hard inquiries show about 2 years (bureau practice, not law); exact page address | CFPB, What is a credit inquiry? | needs review |
| robo-de-identidad | IdentityTheft.gov report and recovery plan | IdentityTheft.gov (FTC) | verified |
| robo-de-identidad | Free one-year fraud alert via one bureau; free freeze at each bureau | FTC, Credit Freezes and Fraud Alerts | verified |
| estafas | No one can remove accurate information; dispute free yourself; written contract, 3-day cancel, no advance fee, no lying | FTC, Spot the scams when fixing your credit (2026) | verified |
| estafas | "Remove all negative information" is a scam sign | FTC alert, August 2024 | verified |

## Tools

- **Utilization calculator**: balances on open cards divided by their limits.
  Arithmetic only: no score, nothing saved or sent.
- **"¿Hasta cuándo se puede reportar?"**: type of item and its date →
  the latest month it may be reported under FCRA § 605: late payment 7 years;
  collection or charge-off 7 years from 180 days after the first delinquency;
  bankruptcy 10 years; hard inquiry about 2 years (bureau practice, marked as
  not law and pending review). The screen states the limits: it is the
  longest period (a bureau may remove it sooner), accurate items stay until
  then, payments do not restart it, the § 605(b) exceptions, and that it is
  not legal advice.
