import type { SupabaseClient } from "@supabase/supabase-js";
import { recordResolution } from "../autopilot/resolutions";
import { queueStatus } from "../autopilot/store";
import { mailLetter } from "../integrations/lob";
import { verifyWithLob } from "../integrations/lobVerify";
import { ENCLOSURE_LABELS, isAttachableImage, letterHtml, type EnclosurePage } from "../letters/enclosures";
import { pickFont } from "../letters/fonts";
import { reportError } from "../observability/errors";
import { workGate } from "../rounds/send";
import { resolveFurnisherAddress } from "./furnishers";
import { decideReturn, type ReturnDecision } from "./returns";
import { furnisherFromRow } from "./server";
import { markFurnisherAddressBad, requestAddressConfirmation, verifyAddress, type Verifier } from "./verifyServer";

// Returned letters, handled by the autopilot run before anyone looks
// (returns.ts decides; this file reads, re-checks, re-mails and records).
//
// The re-mail is the same letter (its approved text, as it was mailed) in a
// new letters row of the SAME round, pointing at the one that came back
// (letters.remail_of). The database allows one re-mail per letter and never a
// re-mail of a re-mail (migration 0022). Lob's idempotency key is the new
// row's id, so a run that stops half way and runs again mails it once.
// Billing never sees a new round: one charge per round (charges.round_id is
// unique), and a round whose letters all came back is charged only once a
// letter of it is on its way again (charges_guard_returned counts the re-mail).
//
// Only with automatic sending on (the owner's switch, autopilot settings) and
// never for a client on hold, who cancelled, asked to end the service, or has
// an unpaid charge (the same gate as a round: rounds/send.ts workGate).

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export interface ReturnsDeps {
  verifier?: Verifier;
  mailLetter?: typeof mailLetter;
}

export interface ReturnsSummary {
  looked: number;
  remailed: Array<{ userId: string; letterId: string; remailId: string }>;
  askedClient: number;
  furnisherMarked: number;
  toPerson: number;
  errors: number;
}

/** Once per letter and outcome: what the system decided about a returned letter, for the activity log and so the run does not repeat itself. */
async function recordDecisionOnce(db: SupabaseClient, userId: string, letterId: string, decision: ReturnDecision): Promise<boolean> {
  const { data } = await db.from("events").select("id, payload").eq("user_id", userId).eq("kind", "letter_return_reviewed").eq("payload->>letterId", letterId);
  if (((data as Row[] | null) ?? []).some((r) => (r.payload as Row | null)?.action === decision.action)) return false;
  await db.from("events").insert({ user_id: userId, kind: "letter_return_reviewed", payload: { letterId, action: decision.action, why: decision.why } });
  return true;
}

async function enclosuresFor(db: SupabaseClient, userId: string): Promise<EnclosurePage[]> {
  const { data } = await db.from("identity_documents").select("kind, storage_path").eq("user_id", userId);
  const pages: EnclosurePage[] = [];
  for (const doc of (data as Row[] | null) ?? []) {
    const label = ENCLOSURE_LABELS[text(doc.kind)];
    const path = text(doc.storage_path);
    if (!label || !isAttachableImage(path)) continue;
    const { data: signed } = await db.storage.from("identity-docs").createSignedUrl(path, 24 * 60 * 60);
    if (signed?.signedUrl) pages.push({ label, url: signed.signedUrl });
  }
  return pages;
}

/**
 * Sends a returned letter again, once. Reuses a re-mail row a previous run
 * created and could not mail (same id, same idempotency key). Returns the
 * re-mail's id, or null when it could not go.
 */
export async function remailLetter(
  db: SupabaseClient,
  original: Row,
  to: string[],
  from: { name: string; addressLines: string[] },
  now: Date,
  deps: ReturnsDeps = {},
): Promise<string | null> {
  const userId = text(original.user_id);
  const { data: existing } = await db.from("letters").select("id, status").eq("remail_of", text(original.id));
  let row = ((existing as Row[] | null) ?? [])[0] ?? null;
  if (row && row.status !== "draft") return text(row.id);
  if (!row) {
    const { data: created, error } = await db
      .from("letters")
      .insert({
        user_id: userId,
        round_id: text(original.round_id),
        target_type: text(original.target_type),
        target_key: text(original.target_key),
        target_name: text(original.target_name),
        target_address_lines: to,
        template_key: text(original.template_key),
        escalation_stage: text(original.escalation_stage),
        body: text(original.body),
        status: "draft",
        mail_class: text(original.mail_class) || "first_class",
        ...(original.template_version != null ? { template_version: original.template_version } : {}),
        ...(original.template_hash != null ? { template_hash: original.template_hash } : {}),
        remail_of: text(original.id),
      })
      .select("id, status")
      .single();
    if (error || !created) {
      // Another run made it first (the unique re-mail), or the database refused: nothing is mailed here.
      if (error?.code === "23505") return null;
      throw new Error(`letters: ${error?.message ?? "insert returned no row"}`);
    }
    row = created as Row;
    const { data: items } = await db.from("letter_items").select("item_id, escalation_stage").eq("letter_id", text(original.id));
    const copies = ((items as Row[] | null) ?? []).map((i) => ({ letter_id: text(row!.id), item_id: text(i.item_id), escalation_stage: text(i.escalation_stage) }));
    if (copies.length > 0) await db.from("letter_items").insert(copies);
  }
  const remailId = text(row.id);
  const font = pickFont(remailId);
  const mailClass = (text(original.mail_class) || "first_class") as "first_class" | "certified" | "certified_return_receipt";
  const result = await (deps.mailLetter ?? mailLetter)({
    to: { name: text(original.target_name), addressLines: to },
    from,
    bodyHtml: letterHtml({ body: text(original.body), fontFamily: font.family, sizePt: font.sizePt, enclosures: await enclosuresFor(db, userId) }),
    idempotencyKey: remailId,
    mailClass,
    description: `Re-mail of letter ${text(original.id)}`,
    metadata: { letter_id: remailId, remail_of: text(original.id) },
  });
  const { error: updateError } = await db
    .from("letters")
    .update({
      font_family: font.family,
      lob_id: result.externalId,
      status: "queued",
      mailed_at: now.toISOString(),
      mail_provider: result.provider === "lob" ? "lob" : "simulated",
      mail_status: "in_transit",
      tracking_number: result.trackingNumber,
      mail_updated_at: now.toISOString(),
    })
    .eq("id", remailId);
  if (updateError) throw new Error(`letters: ${updateError.message}`);
  return remailId;
}

/**
 * Every returned letter not yet settled: re-check its addresses, decide
 * (returns.ts), and act. Safe to run twice: a re-mail is once per letter (the
 * database), a confirmation request is once while open, the decision is
 * recorded once.
 */
export async function handleReturnedLetters(db: SupabaseClient, now: Date, options: { roundsEnabled: boolean; heldUserIds: ReadonlySet<string> }, deps: ReturnsDeps = {}): Promise<ReturnsSummary> {
  const summary: ReturnsSummary = { looked: 0, remailed: [], askedClient: 0, furnisherMarked: 0, toPerson: 0, errors: 0 };
  const verifier = deps.verifier ?? ((l: readonly string[]) => verifyWithLob(l));
  const { data, error } = await db.from("letters").select("*").in("mail_status", ["returned", "undeliverable"]);
  if (error) {
    // A database without migration 0022 (no remail_of): nothing to do here.
    return summary;
  }
  const returned = (data as Row[] | null) ?? [];
  if (returned.length === 0) return summary;
  const { data: remailRows } = await db.from("letters").select("id, remail_of, status").in("remail_of", returned.map((l) => text(l.id)));
  const remailed = new Map(((remailRows as Row[] | null) ?? []).map((r) => [text(r.remail_of), r]));
  const { data: bookRows } = await db.from("furnishers").select("*");
  const book = ((bookRows as Row[] | null) ?? []).map(furnisherFromRow);

  for (const letter of returned) {
    const userId = text(letter.user_id);
    const letterId = text(letter.id);
    const prior = remailed.get(letterId);
    // Settled: re-mailed already (a draft re-mail is retried below, under the same key).
    if (prior && prior.status !== "draft") continue;
    if (options.heldUserIds.has(userId)) continue;
    summary.looked += 1;
    try {
      // The same gate as any mailing: agreement, cancellation, end of service, unpaid charge.
      const blocked = await workGate(db, userId, now);
      if (blocked) continue;

      const { data: profile } = await db.from("profiles").select("full_name, address_lines").eq("id", userId).maybeSingle();
      const clientLines = lines((profile as Row | null)?.address_lines);
      const clientName = text((profile as Row | null)?.full_name);
      const { data: confirmations } = await db.from("address_confirmations").select("*").eq("user_id", userId).eq("letter_id", letterId);
      const conf = ((confirmations as Row[] | null) ?? []).sort((a, b) => text(b.requested_at).localeCompare(text(a.requested_at)))[0] ?? null;
      // Waiting on the client's answer: nothing to do yet.
      if (conf && !conf.confirmed_at && !conf.closed_at) continue;
      // The return address the letter carried, when the client has changed it since (their answer to a request about this letter).
      const sentFrom = conf?.confirmed_at ? lines(conf.input_lines) : null;

      const sentTo = lines(letter.target_address_lines);
      const type = text(letter.target_type) as "bureau" | "secondary_bureau" | "furnisher";
      let target = sentTo;
      let entryId: string | null = null;
      if (type === "furnisher") {
        const resolved = resolveFurnisherAddress(book, text(letter.target_name));
        if (resolved.ok) target = resolved.addressLines;
        entryId = resolved.entry?.id ?? null;
      }
      const targetCheck = await verifyAddress(db, { lines: target, subject: type === "furnisher" ? "furnisher" : "bureau", subjectKey: entryId ?? text(letter.target_key), userId, letterId, fresh: true }, verifier, now);
      const clientCheck = await verifyAddress(db, { lines: clientLines, subject: "client", subjectKey: userId, userId, letterId, fresh: true }, verifier, now);
      const decision = decideReturn({
        reason: text(letter.return_reason) || null,
        alreadyRemailed: Boolean(letter.remail_of),
        recipientType: type,
        recipientName: text(letter.target_name),
        sentTo,
        target,
        targetCheck,
        clientLines,
        clientCheck,
        sentFrom,
      });

      if (decision.action === "remail") {
        if (!options.roundsEnabled) {
          // The owner has not turned on mailing by the system: a person sends it, with the corrected address on record.
          if (await recordDecisionOnce(db, userId, letterId, { action: "person", why: `${decision.why} El envío automático está apagado: lo envía una persona.` })) summary.toPerson += 1;
          continue;
        }
        const remailId = await remailLetter(db, letter, decision.to, { name: clientName, addressLines: decision.from }, now, deps);
        if (!remailId) continue;
        summary.remailed.push({ userId, letterId, remailId });
        await db.from("events").insert({ user_id: userId, kind: "letter_remailed", payload: { letterId, remailId, why: decision.why } });
        await recordResolution(db, { userId, kind: "letter_remailed", detail: { letterId, remailId, recipient: text(letter.target_name) }, dedupeKey: `letter_remailed:${letterId}`, at: now });
        const { data: round } = await db.from("attack_rounds").select("round_number").eq("id", text(letter.round_id)).maybeSingle();
        await queueStatus(db, userId, { kind: "letter_remailed", letterId, recipient: text(letter.target_name), roundNumber: Number((round as Row | null)?.round_number ?? 0) || 1 }, now);
      } else if (decision.action === "ask_client") {
        const asked = await requestAddressConfirmation(db, { userId, reason: "returned_letter", check: decision.check, inputLines: clientLines, letterId }, now);
        if (asked === "requested") summary.askedClient += 1;
        await recordDecisionOnce(db, userId, letterId, decision);
      } else if (decision.action === "furnisher_bad") {
        if (entryId && (await markFurnisherAddressBad(db, entryId, `El correo devolvió una carta (${text(letter.return_reason)}) y no confirma la dirección.`, now))) summary.furnisherMarked += 1;
        await recordDecisionOnce(db, userId, letterId, decision);
      } else if (await recordDecisionOnce(db, userId, letterId, decision)) {
        summary.toPerson += 1;
      }
    } catch (err) {
      summary.errors += 1;
      await reportError(err, { where: "mail/returns", userId, extra: { letterId } });
    }
  }
  return summary;
}
