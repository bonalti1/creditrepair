import type { SupabaseClient } from "@supabase/supabase-js";
import { workMayStart } from "../agreement/gate";
import { loadAgreement } from "../agreement/server";
import { buildAttackPlan, ROUND_CYCLE_DAYS } from "../domain/attack";
import type { PlannedLetter, ReportItem, UserProfile } from "../domain/types";
import { MailAddressError, mailLetter } from "../integrations/lob";
import { sendWhatsApp } from "../integrations/whatsapp";
import { ENCLOSURE_LABELS, isAttachableImage, letterHtml, type EnclosurePage } from "../letters/enclosures";
import { enclosureLabelFor, parseIdType } from "../aftercare/itin";
import { pickFont } from "../letters/fonts";
import { varyLetterWording } from "../letters/variation";
import { listLetterVersions } from "../letters/versions/server";
import { lettersMayBeMailed, renderResolved, resolveLetter, type LetterVersion } from "../letters/versions/versions";
import { parseUsAddress } from "../mail/address";
import { defaultMailClass } from "../mail/classes";
import { resolveFurnisherAddress } from "../mail/furnishers";
import { furnisherFromRow } from "../mail/server";
import { verifyRoundAddresses, type Verifier } from "../mail/verifyServer";
import type { MailClass } from "../mail/types";
import { loadMonitoringState, monitoringMessageEs } from "../monitoring/subscription";
import { reportError } from "../observability/errors";
import { attestedFlagsFromRows, historyFromRows, itemDetailsFromRows, itemFromRow, letterKey, nextRoundNumber } from "./plan";

// Mailing one round of a client's letters. One code path for both ways a
// round leaves:
//
//   - the team's send (full service, POST /api/staff/rounds), from the send
//     screen through the mail service, or printed in the office;
//   - the client's own approval (self-serve only, POST /api/attacks/approve).
//
// Everything is checked here, on the server, from the database, whatever the
// screen showed, before anything is mailed:
//
//   1. the service agreement allows work to start (signed, not cancelled, the
//      3-business-day window over; 15 U.S.C. §1679d(a)) and no charge is
//      unpaid after every retry;
//   2. the round is the client's next one and has not already gone;
//   3. the monitoring report is current;
//   4. every item in every letter carries a logged accuracy attestation
//      (Armor #2): the plan is rebuilt here from the client's own answers and
//      checked again against its contents;
//   5. the client's return address can be read, and every letter to a
//      creditor or collector has an address a person checked in the furnisher
//      address book (never the address the report printed);
//   5b. (added on top of 5, migration 0022) every one of those addresses is
//      checked against the post office's data (Lob's US verification;
//      mail/verify.ts): a correction is used as the post office writes it, a
//      client address it cannot confirm asks the client to confirm it, a
//      creditor address it does not deliver to becomes a missing address;
//   6. every letter in the round has a text an attorney approved
//      (letter_template_versions, migration 0019; docs/LETTERS-EDITOR.md),
//      unless LETTERS_ALLOW_UNAPPROVED=1 is set for testing. Each letter is
//      rendered from that approved version and records its number and hash.
//
// Retry-safe: a send that stopped part way (a mail service error) leaves the
// round as a draft. Asking again reuses the letters of that attempt: one that
// already reached the mail service is skipped, an unsent one keeps its row,
// so its idempotency key (the letter's id) stays the same and Lob mails it once.

type Row = Record<string, unknown>;

export interface RoundSender {
  /** "client": the self-serve approval. "staff": a member of the team. */
  kind: "client" | "staff";
  /** The teammate's account and handle; absent for the client. */
  userId?: string;
  name?: string;
}

export interface SendRoundOptions {
  userId: string;
  roundNumber: number;
  sender: RoundSender;
  /** Apply the agreement and unpaid-charge gate (always for the team; full service for the client). */
  requireAgreement: boolean;
  /** "print": printed in the office and mailed by hand. Otherwise through the mail service. */
  via?: "mail" | "print";
  /** A class per letter, by letterKey (plan.ts). Missing: the default for its kind. */
  mailClasses?: Readonly<Record<string, MailClass>>;
  now?: Date;
  /** Replaceable in tests. */
  deps?: {
    mailLetter?: typeof mailLetter;
    varyLetterWording?: typeof varyLetterWording;
    sendWhatsApp?: typeof sendWhatsApp;
    /** The approved letter texts for these templates. Default: read from letter_template_versions. */
    loadLetterVersions?: (db: SupabaseClient, templateKeys: string[]) => Promise<LetterVersion[]>;
    /** How each address is checked (step 5b). Default: Lob's US verification, "unchecked" without a key. */
    verifyAddress?: Verifier;
  };
}

export interface SentLetter {
  id: string;
  target: string;
  stage: string;
}

export type SendRoundResult =
  | { ok: true; roundNumber: number; letters: SentLetter[]; nextRoundDueAt: string }
  | { ok: false; status: number; error: string; code?: string; reason?: string; mailed?: SentLetter[] };

const refuse = (status: number, error: string, code?: string, extra: Partial<Extract<SendRoundResult, { ok: false }>> = {}): SendRoundResult => ({
  ok: false,
  status,
  error,
  ...(code ? { code } : {}),
  ...extra,
});

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

/**
 * The gate that comes before any work: the agreement allows it and the case
 * is not paused for an unpaid charge. Null when work may go ahead.
 */
export async function workGate(db: SupabaseClient, userId: string, now: Date): Promise<SendRoundResult | null> {
  let agreement;
  try {
    agreement = await loadAgreement(db, userId);
  } catch (error) {
    await reportError(error, { where: "rounds/send:agreement", userId });
    return refuse(500, "Could not check the service agreement. Nothing was sent.");
  }
  const gate = workMayStart(agreement, now);
  if (!gate.allowed) return refuse(409, gate.reason.es, `agreement_${gate.code}`);

  // A charge that did not go through after every retry pauses the case: no
  // new round is sent until it is paid (src/lib/billing/dunning.ts). Read
  // from the charge rows themselves; a database without migration 0011 has
  // none, and nothing is held.
  const { data: unpaid, error: unpaidError } = await db
    .from("charges")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "failed")
    .is("next_attempt_at", null)
    .limit(1);
  if (!unpaidError && unpaid && unpaid.length > 0) {
    return refuse(
      409,
      "Un cobro de este cliente no pasó y su caso está en pausa. No se envía una ronda nueva hasta que el pago quede resuelto.",
      "billing_past_due",
    );
  }
  return null;
}

/** The approved versions of these letters, read with the service role. */
async function approvedLetterVersions(db: SupabaseClient, templateKeys: string[]): Promise<LetterVersion[]> {
  return listLetterVersions(db, { templateKeys, approvedOnly: true });
}

/** Mails one round. `db` is the service-role client: the caller has already checked who may ask. */
export async function sendRound(db: SupabaseClient, options: SendRoundOptions): Promise<SendRoundResult> {
  const { userId, roundNumber, sender } = options;
  const now = options.now ?? new Date();
  const via = options.via ?? "mail";
  const mail = options.deps?.mailLetter ?? mailLetter;
  const vary = options.deps?.varyLetterWording ?? varyLetterWording;
  const whatsapp = options.deps?.sendWhatsApp ?? sendWhatsApp;

  // 1. The agreement, before anything else is read.
  if (options.requireAgreement) {
    const blocked = await workGate(db, userId, now);
    if (blocked) return blocked;
  }

  // 2. The round.
  const roundRows = await rows(db.from("attack_rounds").select("id, round_number, status").eq("user_id", userId), "attack_rounds");
  let round = roundRows.find((r) => Number(r.round_number) === roundNumber) ?? null;
  if (round && round.status !== "draft") return refuse(409, `Round already ${String(round.status)}`, "already_sent");

  // 3. Letters go out on current information only: same rule as the builder.
  const monitoring = await loadMonitoringState(db, userId);
  if (!monitoring.active) return refuse(402, monitoringMessageEs(monitoring), "monitoring_inactive", { reason: monitoring.reason });

  const [profileRows, itemRows, flagRows, pullRows] = await Promise.all([
    rows(db.from("profiles").select("*").eq("id", userId).limit(1), "profiles"),
    rows(db.from("report_items").select("*").eq("user_id", userId).eq("status", "active"), "report_items"),
    rows(db.from("item_flags").select("*").eq("user_id", userId), "item_flags"),
    // The newest report's date: the data checks are recomputed against it.
    rows(db.from("report_pulls").select("pulled_at").eq("user_id", userId).order("pulled_at", { ascending: false }).limit(1), "report_pulls"),
  ]);
  const profileRow = profileRows[0];
  if (!profileRow) return refuse(404, "Profile not found", "profile_not_found");

  const user: UserProfile = {
    id: userId,
    fullName: String(profileRow.full_name ?? ""),
    addressLines: (profileRow.address_lines as string[] | null) ?? [],
    locale: profileRow.locale === "es" ? "es" : "en",
    goal: (profileRow.goal as string | null) ?? null,
  };

  const itemRowByFp = new Map(itemRows.map((r) => [String(r.fingerprint), r]));
  const itemIdToFp = new Map(itemRows.map((r) => [String(r.id), String(r.fingerprint)]));
  const items: ReportItem[] = itemRows.map(itemFromRow);

  // The standard reason the client picked for each attested item
  // (item_flags.reason_code, migration 0008); the letter prints its sentence
  // after the item. The client's own words (item_flags.reason) are never printed.
  const { flags, itemReasons } = attestedFlagsFromRows(flagRows, itemIdToFp);
  // The report facts the client chose to add to an attested item's line (data
  // checks, migration 0021): recomputed here from the client's own report and
  // kept only where they fit the reason the client picked. Same as the preview.
  const reportDate = pullRows[0]?.pulled_at ? String(pullRows[0].pulled_at) : null;
  const itemDetails = reportDate ? itemDetailsFromRows(items, flagRows, itemIdToFp, reportDate) : {};
  const attestedFps = new Set(flags.filter((f) => f.attested && f.attestedAt).map((f) => f.fingerprint));

  // The team asks for a round by number; it must be the one that comes next.
  // (The client's approval names the draft the builder made, as before.)
  if (!round) {
    if (sender.kind !== "staff") return refuse(404, "Round not found", "round_not_found");
    const hasPersonalInfo = items.some((i) => i.category === "personal_info" && attestedFps.has(i.fingerprint));
    if (nextRoundNumber(roundRows as Array<{ round_number: unknown; status: unknown }>, hasPersonalInfo) !== roundNumber) {
      return refuse(409, `Round ${roundNumber} is not this client's next round.`, "not_next_round");
    }
  }

  // Rebuild history and the plan here: the browser never supplies the plan it sends.
  const letterRows = await rows(db.from("letters").select("id, round_id, status").eq("user_id", userId), "letters");
  const letterItemRows =
    letterRows.length > 0
      ? await rows(db.from("letter_items").select("letter_id, item_id, escalation_stage").in("letter_id", letterRows.map((l) => String(l.id))), "letter_items")
      : [];
  const history = historyFromRows(letterRows, letterItemRows, itemIdToFp, round ? String(round.id) : null);
  const plan = buildAttackPlan({ roundNumber, items, flags, history });
  if (plan.letters.length === 0) return refuse(422, "Nothing to send: no attested items for this round.", "nothing_to_send");

  // 4. Attestation invariant — checked again against raw plan contents.
  for (const letter of plan.letters) {
    for (const fp of letter.itemFingerprints) {
      if (!attestedFps.has(fp)) {
        return refuse(422, `Item ${fp} has no logged accuracy attestation; approval rejected.`, "attestation_missing");
      }
    }
  }

  // 5. Addresses, all of them, before any letter goes: a round never leaves half-sent for want of one.
  if (!parseUsAddress(user.addressLines).ok) {
    return refuse(409, "La dirección del cliente no se puede leer. Pídele que la escriba en su app.", "client_address_missing");
  }
  const furnisherRows = await db
    .from("furnishers")
    .select("id, name, aliases, address_lines, phone, notes, source, verified_on, updated_at, updated_by_name");
  if (furnisherRows.error) {
    await reportError(new Error(furnisherRows.error.message), { where: "rounds/send:furnishers", userId });
    return refuse(500, "Could not read the furnisher address book. Nothing was sent.");
  }
  const book = ((furnisherRows.data as Row[] | null) ?? []).map(furnisherFromRow);
  const destinations = new Map<PlannedLetter, { name: string; addressLines: string[] }>();
  const missing: string[] = [];
  for (const planned of plan.letters) {
    if (planned.target.type !== "furnisher") {
      destinations.set(planned, { name: planned.target.name, addressLines: planned.target.addressLines });
      continue;
    }
    const resolved = resolveFurnisherAddress(book, planned.target.name);
    if (resolved.ok) destinations.set(planned, { name: resolved.entry.name, addressLines: resolved.addressLines });
    else missing.push(resolved.message);
  }
  if (missing.length > 0) return refuse(409, missing.join(" "), "furnisher_address_missing");

  // 5b. Every address checked against the post office's data (mail/verify.ts), the
  // return address and each recipient's, before any letter goes. A step added on
  // top of step 5, which still applies: the address must also parse and, for a
  // creditor, be one a person verified in the book. What the post office
  // corrects is used as it writes it; what it cannot confirm stops the round.
  let verification;
  try {
    verification = await verifyRoundAddresses(
      db,
      {
        userId,
        roundNumber,
        from: user.addressLines,
        recipients: plan.letters.map((planned) => {
          const destination = destinations.get(planned)!;
          const resolved = planned.target.type === "furnisher" ? resolveFurnisherAddress(book, planned.target.name) : null;
          return {
            ref: letterKey(planned.target.type, planned.target.key, planned.templateKey),
            type: planned.target.type,
            key: planned.target.key,
            name: destination.name,
            lines: destination.addressLines,
            entryId: resolved?.ok ? resolved.entry.id : null,
          };
        }),
      },
      options.deps?.verifyAddress,
      now,
    );
  } catch (error) {
    await reportError(error, { where: "rounds/send:verify", userId });
    return refuse(502, "Could not check the addresses with the mail service. Nothing was sent; please try again.", "address_verification_failed");
  }
  if (!verification.ok) return refuse(verification.status, verification.message, verification.code);
  user.addressLines = verification.from;
  for (const planned of plan.letters) {
    const checked = verification.to.get(letterKey(planned.target.type, planned.target.key, planned.templateKey));
    if (checked) destinations.set(planned, { ...destinations.get(planned)!, addressLines: checked });
  }

  // 6. Only attorney-approved letter text is mailed or printed for a client.
  const templateKeys = [...new Set(plan.letters.map((l) => l.templateKey))];
  let letterVersions: LetterVersion[];
  try {
    letterVersions = await (options.deps?.loadLetterVersions ?? approvedLetterVersions)(db, templateKeys);
  } catch (error) {
    await reportError(error, { where: "rounds/send:letter_versions", userId });
    return refuse(500, "Could not read the approved letter texts. Nothing was sent.");
  }
  const approval = lettersMayBeMailed(templateKeys, letterVersions);
  if (!approval.ok) return refuse(409, approval.message, "letters_not_approved");

  // The round row: the client's draft, or the team's, made now.
  if (!round) {
    const { data: created, error } = await db
      .from("attack_rounds")
      .insert({ user_id: userId, round_number: roundNumber, status: "draft" })
      .select("id, round_number, status")
      .single();
    if (error || !created) {
      // Two sends at once: the other one made it. Read it and go on only if it is still a draft.
      const again = await rows(db.from("attack_rounds").select("id, round_number, status").eq("user_id", userId).eq("round_number", roundNumber), "attack_rounds");
      round = again[0] ?? null;
      if (!round) throw new Error(`attack_rounds: ${error?.message ?? "insert returned no row"}`);
      if (round.status !== "draft") return refuse(409, `Round already ${String(round.status)}`, "already_sent");
    } else {
      round = created as Row;
    }
  }
  const roundId = String(round.id);

  // Enclosures: bureaus expect ID + proof of address with a mailed dispute.
  // Each uploaded photo is attached as its own page, and only what is attached
  // is listed under "Enclosures" in the letter. The print provider fetches the
  // photos through links that expire after a day. A printed round lists the
  // documents the team puts in the envelope.
  const docs = await rows(db.from("identity_documents").select("kind, storage_path").eq("user_id", userId), "identity_documents");
  const enclosurePages: EnclosurePage[] = [];
  if (via === "mail") {
    for (const doc of docs) {
      // An ITIN client's number document is the IRS letter, never called a Social Security card (aftercare/itin.ts).
      const label = enclosureLabelFor(String(doc.kind), parseIdType(profileRow.id_type), ENCLOSURE_LABELS);
      const path = String(doc.storage_path);
      if (!label || !isAttachableImage(path)) continue;
      const { data: signed } = await db.storage.from("identity-docs").createSignedUrl(path, 24 * 60 * 60);
      if (signed?.signedUrl) enclosurePages.push({ label, url: signed.signedUrl });
    }
  }
  const enclosures =
    via === "mail"
      ? enclosurePages.map((page) => page.label)
      : (["government_id", "proof_of_address"] as const).filter((kind) => docs.some((d) => d.kind === kind)).map((kind) => ENCLOSURE_LABELS[kind]!);

  // A previous attempt may have stopped part-way. Its letters are reused, never duplicated.
  const priorLetters = await rows(
    db.from("letters").select("id, target_type, target_key, template_key, status").eq("user_id", userId).eq("round_id", roundId),
    "letters",
  );
  const priorByKey = new Map(priorLetters.map((l) => [letterKey(String(l.target_type), String(l.target_key), String(l.template_key)), l]));

  const mailedLetters: SentLetter[] = [];
  for (const planned of plan.letters) {
    const key = letterKey(planned.target.type, planned.target.key, planned.templateKey);
    const prior = priorByKey.get(key);
    if (prior && prior.status !== "draft") {
      mailedLetters.push({ id: String(prior.id), target: planned.target.name, stage: planned.stage });
      continue;
    }
    const destination = destinations.get(planned)!;
    const target = { ...planned.target, name: destination.name, addressLines: destination.addressLines };
    // The class chosen on the send screen, else the one for this kind of letter (mail/classes.ts).
    const mailClass = options.mailClasses?.[key] ?? defaultMailClass(planned.templateKey, planned.target.type);

    const letterItems = planned.itemFingerprints
      .map((fp) => items.find((i) => i.fingerprint === fp))
      .filter((i): i is ReportItem => Boolean(i));

    // The approved version of this letter (or version 1, only when LETTERS_ALLOW_UNAPPROVED=1).
    const version = resolveLetter(planned.templateKey, letterVersions);
    const baseBody = renderResolved(version, {
      user,
      target,
      items: letterItems,
      date: now.toISOString(),
      roundNumber,
      enclosures,
      itemReasons,
      itemDetails,
    });
    // A printed letter is printed exactly as the console shows it; the mail service gets the reworded one.
    const body = via === "mail" ? await vary(baseBody) : baseBody;

    const letterFields = {
      user_id: userId,
      round_id: roundId,
      target_type: planned.target.type,
      target_key: planned.target.key,
      target_name: target.name,
      target_address_lines: target.addressLines,
      template_key: planned.templateKey,
      // Which version and which exact text it was rendered from (migration 0019).
      template_version: version.version,
      template_hash: version.contentHash,
      escalation_stage: planned.stage,
      body,
      status: "draft",
      mail_class: mailClass,
    };
    const { data: letterRow, error: letterError } = prior
      ? await db.from("letters").update(letterFields).eq("id", String(prior.id)).select("id").single()
      : await db.from("letters").insert(letterFields).select("id").single();
    if (letterError || !letterRow) {
      return refuse(500, letterError?.message ?? "Could not save letter", undefined, { mailed: mailedLetters });
    }
    const letterId = String((letterRow as Row).id);
    const font = pickFont(letterId);

    let sent: { provider: "lob" | "simulated" | "print"; externalId: string | null; trackingNumber: string | null; status: "queued" | "mailed" };
    if (via === "print") {
      sent = { provider: "print", externalId: null, trackingNumber: null, status: "mailed" };
    } else {
      try {
        const result = await mail({
          to: { name: target.name, addressLines: target.addressLines },
          // The return address is the client's own: the letter is theirs (see lob.ts).
          from: { name: user.fullName, addressLines: user.addressLines },
          // The letter is plain text and is escaped, so a creditor name can never
          // be read as markup by the print renderer.
          bodyHtml: letterHtml({ body, fontFamily: font.family, sizePt: font.sizePt, enclosures: enclosurePages }),
          idempotencyKey: letterId,
          mailClass,
          description: `Round ${roundNumber} letter ${letterId}`,
          metadata: { letter_id: letterId, round: String(roundNumber) },
        });
        // Without a Lob key nothing reached a post office: "simulated".
        sent = { provider: result.provider === "lob" ? "lob" : "simulated", externalId: result.externalId, trackingNumber: result.trackingNumber, status: "queued" };
      } catch (error) {
        if (error instanceof MailAddressError) {
          // An address that cannot be read is not a mail-service failure: it is
          // refused before anything is sent, and someone has to fix the address.
          return refuse(422, error.message, `address_${error.which}`, { mailed: mailedLetters });
        }
        // The mail provider refused this letter. Leave it as a draft, tell the
        // operator, and stop: the round stays a draft so it can be sent again.
        // On the retry, letters that already went out are skipped and this one
        // reuses its row.
        await reportError(error, { where: "rounds/send:mail", userId, extra: { letterId } });
        return refuse(502, "A letter could not be sent to the mail service. Nothing was lost; please try again.", "mail_failed", { mailed: mailedLetters });
      }
    }

    const { error: updateError } = await db
      .from("letters")
      .update({
        font_family: font.family,
        lob_id: sent.externalId,
        status: sent.status,
        mailed_at: now.toISOString(),
        // Tracking (migration 0013).
        mail_provider: sent.provider,
        mail_status: "in_transit",
        tracking_number: sent.trackingNumber,
        mail_updated_at: now.toISOString(),
      })
      .eq("id", letterId);
    if (updateError) throw new Error(`letters: ${updateError.message}`);

    if (letterItems.length > 0) {
      const { error: itemsError } = await db.from("letter_items").insert(
        letterItems.flatMap((i) => {
          const row = itemRowByFp.get(i.fingerprint);
          return row ? [{ letter_id: letterId, item_id: String(row.id), escalation_stage: planned.stage }] : [];
        }),
      );
      if (itemsError) throw new Error(`letter_items: ${itemsError.message}`);
    }
    mailedLetters.push({ id: letterId, target: planned.target.name, stage: planned.stage });
  }

  const nextDue = new Date(now.getTime() + ROUND_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  const { error: roundError } = await db
    .from("attack_rounds")
    .update({
      status: "mailed",
      approved_at: now.toISOString(),
      mailed_at: now.toISOString(),
      next_round_due_at: nextDue.toISOString(),
      // Who sent it and how (migration 0014). The client's own approval has no teammate.
      ...(sender.kind === "staff" ? { sent_by: sender.userId ?? null, sent_by_name: sender.name ?? null, mail_via: via } : {}),
    })
    .eq("id", roundId);
  if (roundError) throw new Error(`attack_rounds: ${roundError.message}`);

  await db.from("events").insert({
    user_id: userId,
    kind: sender.kind === "staff" ? "round_sent" : "attack_approved",
    payload: { roundNumber, letterCount: mailedLetters.length, ...(sender.kind === "staff" ? { by: sender.userId ?? null, via } : {}) },
  });

  if (profileRow.phone_e164) {
    await whatsapp(String(profileRow.phone_e164), {
      kind: "letters_mailed",
      roundNumber,
      letterCount: mailedLetters.length,
    }).catch(() => undefined);
  }

  return { ok: true, roundNumber, letters: mailedLetters, nextRoundDueAt: nextDue.toISOString() };
}

