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

> Subject: Partner program inquiry — Spanish-language credit education software (Texas)
>
> Hello,
>
> We are launching CreditCapi, a Spanish-first web app for consumers in Texas.
> It helps a consumer read their own 3-bureau report and prepare their own
> dispute letters; the consumer makes every decision and sends their own
> disputes. We would like to refer our users to IdentityIQ for credit
> monitoring and are deciding which of your programs fits.
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

> Subject: Review before launch — consumer credit dispute software (Texas)
>
> We are preparing to launch CreditCapi, a Spanish-language web app where a
> consumer reviews their own credit report and sends their own dispute
> letters. The software is free to the consumer; we are paid a referral
> commission by the credit monitoring company (IdentityIQ). I am attaching our
> brief with the main questions. Since it was written, these came up and I
> would like to cover them in the same session:
>
> 1. **Name.** There are registered US marks for CREDITAPI. Is CREDITCAPI safe to use?
> 2. **Commission.** We tell users in writing that we earn a commission when
>    they subscribe to monitoring through our link. Is the wording sufficient?
>    Does being paid this way change how the product is classified?
> 3. **Salespeople.** A salesperson chats with the lead on WhatsApp, explains
>    the product, and sends a link. The consumer still makes every decision in
>    the app. Does that guidance change our classification? How may we pay
>    salespeople (per signup, per active customer)?
> 4. **Phone calls.** We have told salespeople to keep everything in writing.
>    If we ever sell by voice call, what does the Telemarketing Sales Rule require?
> 5. **AI assistant.** The assistant always says it is AI. Anything else you want disclosed?
> 6. **My sister's company** does traditional credit repair in Florida. How
>    should the two businesses be related, if at all?
> 7. **Texas registration and bond.** Do we need them for this model, and in whose name?

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
| `NEXT_PUBLIC_APP_URL` | The app's address, for example `https://app.creditcapi.com` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | The sales WhatsApp number, digits only, with country code |
| `NEXT_PUBLIC_MONITORING_SIGNUP_URL` | The partner link from IdentityIQ (when you have it) |
| `NEXT_PUBLIC_MONITORING_PRICE` | The price on that link's checkout page, for example `$31.49` |
| `MONITORING_PROVIDER` | Leave empty until report reading is built |

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
- [ ] Review the items, confirm one, approve the letters
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
| Attorney | Launch itself; Texas registration and bond |
| You: final logo, Capi's voice | Brand polish on ads |
