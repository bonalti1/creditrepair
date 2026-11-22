# The database: turning the demo into the real app

Without database settings the app is the demo: invented clients in the staff
console, the sample report in the client app, nothing saved anywhere but the
browser. With the Supabase settings below, the same screens run on the
database: real accounts, real reports, real letters. One rule decides which
(`src/lib/supabase/config.ts`): the app is on the database when
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both set.

**About keys:** every value below goes into Render (your service → Environment)
or into Supabase's own settings. Never paste a key into a chat or an email.

---

## 1. Create the Supabase project (free tier is fine to start)

1. Sign up at supabase.com → **New project**. Pick a region close to Texas
   (for example US East or US Central). Write the database password somewhere
   safe; the app does not need it.
2. Wait for it to finish setting up (a minute or two).
3. Note: a free project is **paused after about a week with no use**. Before
   real clients, move to a paid plan so it never sleeps.

## 2. Create the tables

1. In Supabase: **SQL Editor → New query**.
2. Open `supabase/setup.sql` from this repository, copy **all** of it, paste,
   and press **Run**. It is every migration (`supabase/migrations/0001`
   onwards; `0017` adds referral partners and the HighLevel handoff, see
   `docs/PARTNERS.md` and `docs/HIGHLEVEL.md`) in order. It should finish with "Success. No rows returned".
3. Run it **once**. If you run it a second time it stops at the first table
   that already exists; that is harmless, nothing is changed.

## 3. Check the storage bucket

`setup.sql` creates the private bucket for ID photos. In Supabase:
**Storage** → you should see **identity-docs**, marked private (no "public"
badge). If it is missing, create it: **New bucket**, name `identity-docs`,
leave "Public bucket" **off**.

## 4. Turn on phone login (this needs an SMS provider, and it costs money)

Clients and staff sign in with a code sent by text message. **Supabase does
not send text messages itself**: it hands them to an SMS provider you connect,
and that provider bills you per message. Supabase supports Twilio, Twilio
Verify, MessageBird, Vonage and Textlocal; Twilio is the usual choice in the US.

1. Open a **Twilio** account. You will pay Twilio for each text and, if you use
   a regular US phone number, for the number each month and for the US carrier
   registration ("A2P 10DLC"), which can take days to be approved. Check
   Twilio's current prices before you start. (A toll-free number or Twilio
   Verify avoids part of that registration.)
2. In Twilio, copy the **Account SID**, the **Auth Token** and a **Messaging
   Service SID** (or use Twilio Verify and copy its Service SID).
3. In Supabase: **Authentication → Sign In / Providers → Phone** → enable it,
   choose Twilio (or Twilio Verify), paste the values, save.
4. In Supabase: **Authentication → URL Configuration** → set **Site URL** to
   your app's address (for example `https://app.credalti.com`) and add
   `https://YOUR-APP/auth/callback` under **Redirect URLs**. This is for the
   email-link backup on the login page. (Supabase's built-in email sender only
   sends a few emails per hour; for more, connect your own SMTP under
   Authentication → Emails.)

Until a provider is connected, the login page shows "No pudimos enviar el
código" for phone numbers. The email link still works.

## 5. Put the keys into Render

In Supabase: **Project Settings → API** (or "API Keys"). Copy the three values
below into Render (your service → **Environment**), then **save and redeploy**.

| Variable | Where it comes from | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, `https://xxxx.supabase.co` | No: the browser uses it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The `anon` / publishable key | No: the browser uses it. Row level security protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` / secret key | **Yes.** It bypasses every privacy rule. Only Render, never the browser, never a message. |
| `N8N_WEBHOOK_SECRET` | A long random password you invent | **Yes.** Protects `/api/health` details and the hourly jobs. |
| `NEXT_PUBLIC_APP_URL` | Your app's address | No. |

Important: the two `NEXT_PUBLIC_…` values are built into the app when Render
builds it. After setting or changing them, use **Manual Deploy → Clear build
cache & deploy** (a plain restart is not enough).

The other accounts (Lob, WhatsApp, Anthropic, the agreement and billing
settings) are listed in `docs/GO-LIVE.md`; the app runs on the database
without them, with mail "simulado" and no WhatsApp.

## 6. Make yourself the first administrator

Use `supabase/first-admin.sql`. The easy way (before you sign in):

1. In the SQL Editor, run (with your name, a short handle in lowercase and your cell number):

   ```sql
   insert into public.staff_invitations (display_name, handle, role, phone_e164)
   values ('Your Name', 'yourhandle', 'admin', '+17135550100');
   ```

2. Open `https://YOUR-APP/login`, enter that number, type the code. The app
   finds the invitation, makes you an administrator and opens `/equipo`.

If you already signed in once before doing this, use "Way B" in
`supabase/first-admin.sql` instead. From then on you add everyone else from
the console itself (**Equipo → Agregar persona**), never with SQL: each person signs in
at `/login` with the phone or email you entered and lands on `/equipo`.

A client (anyone who is not an active member of the team) who opens
`/equipo` sees "No tienes acceso".

## 7. Smoke test (about 20 minutes)

1. **Health.** Open `https://YOUR-APP/api/health` with the header
   `x-webhook-secret: <your N8N_WEBHOOK_SECRET>` (ask the developer or Claude).
   "Database and login", "Database tables", "ID photo storage" and "Database:
   first administrator" must say `"ok": true`.
2. **You, as staff.** Sign in at `/login` → you land on `/equipo`. The header
   shows your initials; tap them to see your name, your role and "Cerrar
   sesión". There is **no "Demo" pill**: these are real records (an empty list
   at first).
3. **A test client.** In `/equipo/invitar` make a link for yourself as a
   client, with a **second phone number** (a staff number always opens the
   console). Open it on that phone, go through onboarding, sign in with the code.
4. The client app shows **"Tu equipo está importando tu reporte"** on Home,
   Revisar, Mis cartas, Rondas and Auditoría. In **Mis cartas** (or **Más**),
   write the mailing address and upload a photo of an ID and of a proof of address.
5. **Import a report.** In the console, open the client (Clientes) → "Importar
   reporte" → paste a report in the app's own JSON format (the reader for
   IdentityIQ pages does not exist yet; see `docs/IDENTITYIQ.md`) → review →
   save. The client's phone now shows the items.
6. **Review.** On the client's phone, answer every item; mark one personal
   detail as inaccurate with a reason and the confirmation box.
7. **Send.** In the console the round shows as prepared. Until the service
   agreement can be signed (an attorney-approved text, `docs/AGREEMENT.md`),
   "Enviar" refuses with the reason; that refusal is itself the check that the
   legal gate works. Once a client has signed and the 3-business-day window is
   over, "Enviar" mails through Lob (with the **test** key first: the letters
   appear in Lob's dashboard, nothing is printed).
8. **Tracking.** With the Lob webhook set up (`docs/GO-LIVE.md`, step 3.4),
   a test letter's status shows on the client page and in the client app.

## What runs on the database now, and what still does not

Runs on the database: sign-in (phone code or email link), onboarding and the
salesperson's attribution, the client's address and documents, the agreement
record, the client's answers (with reason and attestation), reports imported
by staff (read again on the server), the staff console's lists, client pages,
notes, handled notices, replies, report samples, team and assignments, the
send (Lob or "simulado") and printing, the furnisher address book, Lob
tracking, billing records, refunds and pauses.

Not yet, and why:

- **Reading IdentityIQ (or any provider's) report pages.** No reader exists
  until a real sample is in hand; staff can save the page as a sample, and
  import a report only in the app's own JSON format.
- **Signing the agreement.** Blocked by design until an attorney approves the
  text and the statutory passages are verified (`docs/AGREEMENT.md`). No round
  can be sent before a client signs.
- **Taking money.** Needs a payment processor adapter (`docs/BILLING.md`).
- **Questions the assistant (AltiBot) passes to the team.** The console can show them, but the assistant
  does not record them yet.
- **Staff seeing the ID photos themselves.** The console shows which documents
  are on file; storage lets only the client read the files.
- The client app follows the newest round the team mailed; older rounds are
  in the console.

## For developers: how this is tested without a live project

`src/lib/__tests__/db/` runs the real `supabase/setup.sql` in PGlite (an
in-process Postgres) with stand-ins for Supabase's roles, `auth.uid()` and
storage, and an adapter that runs the app's supabase-js calls as SQL under the
chosen person, so row level security, triggers and constraints really apply.
It covers what each role reads, that staff and clients cannot write directly,
each staff route's checks, and the whole path from invitation to charge. The
top of `pg.ts` lists what the adapter does not emulate (PostgREST's own
behaviour, Auth sessions and cookies, storage files). Change a migration →
`npm run db:setup-sql` rebuilds `setup.sql`.
