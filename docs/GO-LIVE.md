# Go live: what the owner does, in order

The software is finished as far as it can go without real accounts. This is
the list of what only the owner can do, with the messages already written.

**One rule about keys:** every key and password below goes into the hosting
settings (Render → your service → Environment), under the exact
name shown. Never paste a key into a chat or an email.

---

## Step 1 — Three messages to send today

### To your sister

> Quick question for the new project. Does Miami Credit have a partner or
> affiliate account with IdentityIQ (IDIQ)? If yes: who is your account manager
> there, and what do they pay you per signup? Also, can you export one
> 3-bureau report from IdentityIQ (your own is fine) and send me the file? We
> need a real example to build the part of the app that reads reports.

### To IdentityIQ's partner team

> Subject: Partner program inquiry — Spanish-language credit services company (Texas)
>
> Hello,
>
> We are launching Credalti, a Spanish-first credit services company for
> consumers in Texas. A client reads their own 3-bureau report in our web app
> and tells us which items are inaccurate; our staff then prepares and mails
> the dispute letters for them. We would like to refer our clients to
> IdentityIQ for credit monitoring and are deciding which of your programs fits.
>
> Could you help with the following?
>
> 1. Which program fits this model: Partner, Referral Partner, or another?
> 2. What do you pay per enrollment, is any of it recurring, and when is it paid?
> 3. What price and trial would our partner link carry?
> 4. May we run paid social ads (Meta, TikTok) that lead to enrollment through
>    our link? Are there wording or creative rules?
> 5. May we use the IdentityIQ name and logo in our app and ads, and under what rules?
> 6. How can our software read a member's 3-bureau report with their
>    permission: a partner API, a file export, or another approved method?
> 7. How can we confirm that a member's subscription is active?
> 8. Can a consumer enroll with an ITIN in place of a Social Security number?
> 9. Are enrollment and the member site available in Spanish?
> 10. What happens to our referral if the member cancels during the trial?
>
> Thank you,
> [name, company, phone]

### To the attorney

> Subject: Review before launch — full-service credit services company (Texas)
>
> We are preparing to launch Credalti, a Spanish-language credit services
> company. The client reviews their own credit report in our web app and tells
> us which items are inaccurate and why; our staff then prepares and mails the
> dispute letters for them, in the client's name. We charge a monthly service
> fee, and the client separately pays a credit monitoring company
> (IdentityIQ), which may pay us a referral commission. I am attaching our
> brief with the main questions. Since it was written, these came up and I
> would like to cover them in the same session:
>
> 1. **Name.** The name is now CREDALTI. A quick web search found no existing use of it. Is it safe to use?
> 2. **Commission.** We tell clients in writing that we earn a commission when
>    they subscribe to monitoring through our link. Is the wording sufficient,
>    and may we keep the commission now that we also charge a service fee?
> 3. **Salespeople.** A salesperson chats with the lead on WhatsApp, explains
>    the service and the plan, and sends a link. The client still decides in
>    the app which items are inaccurate. What may a salesperson say, and how
>    may we pay them (per signup, per active client)?
> 4. **Phone calls.** We have told salespeople to keep everything in writing.
>    If we ever sell by voice call, what does the Telemarketing Sales Rule require?
> 5. **AI assistant.** The assistant always says it is AI. Anything else you want disclosed?
> 6. **My sister's company** does traditional credit repair in Florida. How
>    should the two businesses be related, if at all?
> 7. **Texas registration and bond.** We expect to need them as a credit
>    services organization. Please confirm, and in whose name.
> 8. **The agreement and the fee.** What the service agreement must disclose,
>    the 3-business-day right to cancel, and when the monthly fee may be
>    charged so that nothing is charged before the service it pays for.
> 9. **Letters in the client's name.** Our staff prepares and mails them. What
>    must the client sign for that? (The letter packet asks this in detail.)

---

## Step 2 — Open the accounts

Open each one, then copy the values named in the last column into Render
(your service → Environment). Render redeploys by itself after you save.

| # | Account | What it is for | Variables to set in Render |
| --- | --- | --- | --- |
| 1 | **Render** | Hosting. Already set up: the demo runs at `creditcapi-demo.onrender.com`. | (this is where the others go) |
| 2 | **Supabase** | Database and login. Create a project. | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| 3 | **A text-message provider** connected in Supabase (Authentication → Providers → Phone) | Login codes by text | set inside Supabase, not Render |
| 4 | **Anthropic** | Capi, and letter wording | `ANTHROPIC_API_KEY` |
| 5 | **Lob** | Prints and mails the letters | `LOB_API_KEY` (start with the test key) |
| 6 | **Meta for Developers + WhatsApp Business** | WhatsApp messages | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, and a word you invent for `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| 7 | **n8n** | The hourly clock for rounds | a long random password you invent for `N8N_WEBHOOK_SECRET` |
| 8 | **Slack or n8n webhook** (optional) | Alerts | `ERROR_WEBHOOK_URL`, `SALES_WEBHOOK_URL` |

Also set, with no account needed:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | The app's address, for example `https://app.credalti.com` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | The sales WhatsApp number, digits only, with country code |
| `NEXT_PUBLIC_MONITORING_SIGNUP_URL` | The partner link from IdentityIQ (when you have it) |
| `NEXT_PUBLIC_MONITORING_PRICE` | The price on that link's checkout page, for example `$31.49` |
| `MONITORING_PROVIDER` | Leave empty until report reading is built |
| `NEXT_PUBLIC_SERVICE_MODE` | Leave empty: that is full service, where the team prepares and mails the letters. `self_serve` brings back the version where the client approves and sends their own letters; it is kept for later. |

### The service agreement

Full service needs a signed agreement before any work starts, and no client
can sign until this is done. The whole list, with every variable, what each
document is and the questions for the attorney, is in `docs/AGREEMENT.md`.
In short:

- [ ] The attorney reviews the agreement text (print `/acuerdo/copia`) and answers the questions in `docs/AGREEMENT.md`
- [ ] Texas registration number, the bond's surety, and your registered agent
- [ ] Decide the monthly fee and the estimated length
- [ ] Set the `NEXT_PUBLIC_COMPANY_…`, `NEXT_PUBLIC_PLAN_…` and `NEXT_PUBLIC_TX_…` variables listed there
- [ ] Only after the attorney approves: set `NEXT_PUBLIC_AGREEMENT_APPROVED_VERSION`

## Step 3 — Three one-time setups

1. **Database.** In Supabase, open the SQL editor, paste the whole file
   `supabase/setup.sql`, and run it once. (It has been run against a test
   database: it applies cleanly and the privacy rules hold.)
2. **WhatsApp webhook.** In the Meta app, set the webhook address to
   `https://YOUR-APP/api/webhooks/whatsapp` and enter the same word you chose
   for `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Subscribe to "messages".
3. **Hourly clock.** In n8n, create a workflow with two steps: "Schedule
   Trigger" every hour, then "HTTP Request" — POST to
   `https://YOUR-APP/api/cron/rounds` with header `x-webhook-secret` set to
   your `N8N_WEBHOOK_SECRET`.

## Step 4 — Check it

Ask the developer (or Claude) to open `https://YOUR-APP/api/health` with the
header `x-webhook-secret`. It lists every integration as set or missing, checks
the database tables, and says whether the app is ready for customers. It never
shows a key.

Then run one full pass yourself:

- [ ] Open `/equipo/invitar`, create a link for yourself, open it on your phone
- [ ] Sign in with your phone number
- [ ] Upload a photo of an ID and a proof of address
- [ ] Review the items and confirm one. The letters page should show the
      letters as being prepared by the team, with no approve button
- [ ] With Lob's **test** key, confirm the letter appears in Lob's dashboard with
      the ID pages behind it; check how the address sits on the first page
- [ ] Send a WhatsApp message from a number that is not a customer: Capi should
      greet once and then stay quiet
- [ ] Only then switch Lob to the live key

## Step 5 — Before the first real letter

- [ ] Open each `source` link in `src/lib/domain/bureaus.ts` and confirm the address
- [ ] Mail one letter to yourself

## What is still waiting on other people

| Waiting on | Unlocks |
| --- | --- |
| IdentityIQ: a sample report or partner documentation | Reading real reports. Until then the app shows the sample report. |
| IdentityIQ: partner link and price | The subscribe button and naming IdentityIQ in the app |
| IdentityIQ: paid-ads permission | Any ad spend |
| Attorney | Launch itself; Texas registration and bond; the service agreement text (`docs/AGREEMENT.md`) |
| You: final logo, Capi's voice | Brand polish on ads |
