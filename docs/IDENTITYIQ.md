# IdentityIQ: the monitoring provider

**Decision (2026-11-19):** Credalti uses IdentityIQ (company: IDIQ) for
credit monitoring. The customer subscribes with IdentityIQ and pays them
directly; Credalti is paid by IdentityIQ for the referral. We do not bill
customers, so Stripe is not needed.

## What was found, and how sure it is

Checked by web search on 2026-11-19. IdentityIQ's own pages could not be opened
from the build environment, so each row says where the fact came from.

| Topic | Finding | Source | Confidence |
| --- | --- | --- | --- |
| Plan we need | Secure Max: monthly 3-bureau reports and scores. Lower plans refresh less often or cover one bureau. | IdentityIQ pricing page, as quoted in search results | Good |
| List price | $31.49/month, with a $1 seven-day trial. Third-party sites show $27 to $31. | Same | Good for list price; a partner link may differ |
| Public affiliate program | Run through Awin. $40 per enrollment. Not accepting paid-search or incentive traffic "at this time". US only. | Awin merchant page | Good, but terms change |
| Credit-repair partner program | IDIQ runs a separate Partner program: clients enroll through your own link and you earn per enrollment. Terms are not public. | IDIQ site and its G2 listing | Exists; terms unknown |
| Report data access | No public API. A third party's documentation shows partner endpoints exist (a partner token, and pulling a recent report). | The Credit Pros API reference | Suggestive only |
| ITIN in place of SSN | Nothing found either way. | — | Unknown |

## What this changes

- **Price.** Pages said "~$49/mes". They now read the price from
  `src/lib/monitoring/offer.ts` (default "~$32"). Set
  `NEXT_PUBLIC_MONITORING_PRICE` to match the checkout page of the partner link.
- **Revenue per customer.** The earlier model assumed about $49 a month of
  subscription revenue. With IdentityIQ the customer's money goes to IdentityIQ
  and we receive a commission. The public rate is a one-time $40; the partner
  program's rate is unknown. The unit economics need redoing once IDIQ quotes
  partner terms.
- **Paid ads.** The public affiliate program excludes paid-search traffic. Our
  funnel is paid Meta ads to WhatsApp. Whether that is allowed under the
  Partner program has to be asked before any ad spend.

## Questions for IDIQ's partner team

1. Which program fits a consumer software product where the customer disputes
   their own report: Partner, Referral Partner, or something else?
2. What do you pay per enrollment, is any of it recurring, and when is it paid?
3. What price and trial does our partner link carry?
4. May we run paid social ads (Meta, TikTok) that lead to enrollment through
   our link? Any wording or creative rules?
5. May we use the IdentityIQ name and logo in our app and ads? Under what rules?
6. How can our software read a customer's 3-bureau report with their
   permission: a partner API, a file export, or another approved method?
7. How can we tell whether a customer's subscription is active?
8. Can someone enroll with an ITIN in place of a Social Security number? If
   not, what do you suggest for those customers?
9. Is the enrollment flow and the member site available in Spanish?
10. What happens to our referral if the customer cancels in the trial?

**A shortcut worth checking first:** credit repair companies that use Credit
Repair Cloud usually already hold an IDIQ partner account. If Miami Credit has
one, its account manager is the fastest way to get these answers.

## What is built

| Piece | State |
| --- | --- |
| Provider settings (`src/lib/monitoring/offer.ts`) | Done. Name, plan, price, signup link in one place. |
| Onboarding step "Activa tu monitoreo" | Done. Shows price, who it is bought from, and the commission disclosure. The subscribe button appears when the partner link is set. |
| Naming rule | Done. IdentityIQ is named only once the partner link exists; before that the copy says "monitoreo de crédito". |
| Commission disclosure | Done, on the funnel page footer and the onboarding step. |
| Report adapter (`src/lib/monitoring/identityiq.ts`) | Registered, but report access is deliberately not implemented. |

## What is blocked, and what unblocks it

**Reading a real report.** IdentityIQ does not publish its report format, and a
guessed mapping would put wrong items into dispute letters without any error.
One of these is needed:

1. IDIQ partner API documentation and test credentials, or
2. one real IdentityIQ 3-bureau report export (the owner's own is fine) to
   build and test a parser on.

We will not ask customers for their IdentityIQ password or collect it in the
app unless IDIQ confirms in writing that this is permitted. Some credit repair
software imports reports that way; it puts the customer's login in our hands
and may breach IdentityIQ's terms.

**Knowing a subscription is active.** The letter builder requires an active
subscription. Without a status call from IDIQ, the fallback is to treat a
report dated within the last 45 days as proof. That rule is not built yet; it
depends on the answer to question 7.

## Going live checklist

- [ ] Partner agreement signed; link issued
- [ ] `NEXT_PUBLIC_MONITORING_SIGNUP_URL` and `NEXT_PUBLIC_MONITORING_PRICE` set
- [ ] Paid-ads permission confirmed in writing
- [ ] Report access method agreed; adapter implemented and tested on real reports
- [ ] `MONITORING_PROVIDER=identityiq`
- [ ] Attorney has reviewed the commission disclosure wording
