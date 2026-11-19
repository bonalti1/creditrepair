import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAttackPlan, ROUND_CYCLE_DAYS, type ItemHistory } from "@/lib/domain/attack";
import type { EscalationStage, ItemFlag, ReportItem, UserProfile } from "@/lib/domain/types";
import { renderLetter } from "@/lib/letters/templates";
import { varyLetterWording } from "@/lib/letters/variation";
import { pickFont } from "@/lib/letters/fonts";
import { mailLetter } from "@/lib/integrations/lob";
import { sendWhatsApp } from "@/lib/integrations/whatsapp";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveActingUser } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/errors";
import { ENCLOSURE_LABELS, isAttachableImage, letterHtml, type EnclosurePage } from "@/lib/letters/enclosures";
import { loadMonitoringState, monitoringMessageEs } from "@/lib/monitoring/subscription";

// The DIY moment (spec §4.2, legally load-bearing): the USER reviews the attack
// and presses the button. Only then do we render, print, and mail letters.
// Server-side invariant enforced here, independently of the UI: every item in
// every letter must carry a logged accuracy attestation (Armor #2). If any item
// lacks one, the whole approval is rejected.

const bodySchema = z.object({
  userId: z.string().uuid().optional(),
  roundNumber: z.number().int().positive(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { roundNumber } = parsed.data;

  const acting = await resolveActingUser(req, parsed.data.userId);
  if (!acting) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { userId } = acting;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const { data: round } = await db
    .from("attack_rounds")
    .select("id, status")
    .eq("user_id", userId)
    .eq("round_number", roundNumber)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.status !== "draft") {
    return NextResponse.json({ error: `Round already ${round.status}` }, { status: 409 });
  }

  // Letters go out on current information only: same rule as the builder.
  const monitoring = await loadMonitoringState(db, userId);
  if (!monitoring.active) {
    return NextResponse.json({ error: monitoringMessageEs(monitoring), reason: monitoring.reason }, { status: 402 });
  }

  const [{ data: profileRow }, { data: itemRows }, { data: flagRows }] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).single(),
    db.from("report_items").select("*").eq("user_id", userId).eq("status", "active"),
    db.from("item_flags").select("*").eq("user_id", userId),
  ]);
  if (!profileRow) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const user: UserProfile = {
    id: userId,
    fullName: profileRow.full_name,
    addressLines: profileRow.address_lines ?? [],
    locale: profileRow.locale ?? "es",
    goal: profileRow.goal,
  };

  const itemRowByFp = new Map((itemRows ?? []).map((r) => [r.fingerprint as string, r]));
  const itemIdToFp = new Map((itemRows ?? []).map((r) => [r.id as string, r.fingerprint as string]));
  const items: ReportItem[] = (itemRows ?? []).map((r) => ({
    fingerprint: r.fingerprint,
    bureau: r.bureau,
    category: r.category,
    name: r.name,
    furnisher: r.furnisher,
    data: r.data,
    negative: r.negative,
  }));

  const flags: ItemFlag[] = (flagRows ?? []).flatMap((f) => {
    const fp = itemIdToFp.get(f.item_id);
    return fp ? [{ fingerprint: fp, reason: f.reason, attested: f.attested, attestedAt: f.attested_at }] : [];
  });
  const attestedFps = new Set(flags.filter((f) => f.attested && f.attestedAt).map((f) => f.fingerprint));

  // Rebuild history the same way the build route does, then rebuild the plan
  // server-side — the client never supplies the plan it approves.
  const history: ItemHistory = {};
  const { data: mailedLetterItems } = await db
    .from("letter_items")
    .select("escalation_stage, item_id, letters!inner(user_id, status, round_id)")
    .eq("letters.user_id", userId)
    // Earlier rounds only: letters already sent in THIS round (a retried
    // approval) must not push their items up the escalation ladder.
    .neq("letters.round_id", round.id)
    .in("letters.status", ["queued", "mailed", "delivered"]);
  const rank: Record<EscalationStage, number> = { dispute: 1, mov: 2, furnisher_direct: 3 };
  for (const li of mailedLetterItems ?? []) {
    const fp = itemIdToFp.get(li.item_id);
    const stage = li.escalation_stage as EscalationStage;
    if (!fp || !(stage in rank)) continue;
    if (!history[fp] || rank[stage] > rank[history[fp]!]) history[fp] = stage;
  }

  const plan = buildAttackPlan({ roundNumber, items, flags, history });
  if (plan.letters.length === 0) {
    return NextResponse.json({ error: "Nothing to send: no attested items for this round." }, { status: 422 });
  }

  // Attestation invariant — checked again against raw plan contents.
  for (const letter of plan.letters) {
    for (const fp of letter.itemFingerprints) {
      if (!attestedFps.has(fp)) {
        return NextResponse.json(
          { error: `Item ${fp} has no logged accuracy attestation; approval rejected.` },
          { status: 422 },
        );
      }
    }
  }

  // Enclosures: bureaus expect ID + proof of address with a mailed dispute.
  // Each uploaded photo is attached as its own page, and only what is attached
  // is listed under "Enclosures" in the letter. The print provider fetches the
  // photos through links that expire after a day.
  const { data: docs } = await db.from("identity_documents").select("kind, storage_path").eq("user_id", userId);
  const enclosurePages: EnclosurePage[] = [];
  for (const doc of docs ?? []) {
    const label = ENCLOSURE_LABELS[doc.kind as string];
    const path = doc.storage_path as string;
    if (!label || !isAttachableImage(path)) continue;
    const { data: signed } = await db.storage.from("identity-docs").createSignedUrl(path, 24 * 60 * 60);
    if (signed?.signedUrl) enclosurePages.push({ label, url: signed.signedUrl });
  }
  const enclosures = enclosurePages.map((page) => page.label);

  // A previous attempt may have stopped part-way (mail provider error). Letters
  // from that attempt are reused, never duplicated: one that already reached the
  // mail service is skipped, and an unsent draft keeps its row so its
  // idempotency key stays the same.
  const { data: priorLetters } = await db
    .from("letters")
    .select("id, target_type, target_key, template_key, status")
    .eq("user_id", userId)
    .eq("round_id", round.id);
  const letterKey = (targetType: string, targetKey: string, templateKey: string) =>
    `${targetType}|${targetKey}|${templateKey}`;
  const priorByKey = new Map(
    (priorLetters ?? []).map((l) => [letterKey(l.target_type, l.target_key, l.template_key), l]),
  );

  const now = new Date();
  const mailedLetters = [];
  for (const planned of plan.letters) {
    const prior = priorByKey.get(letterKey(planned.target.type, planned.target.key, planned.templateKey));
    if (prior && prior.status !== "draft") {
      mailedLetters.push({ id: prior.id as string, target: planned.target.name, stage: planned.stage });
      continue;
    }

    const letterItems = planned.itemFingerprints
      .map((fp) => items.find((i) => i.fingerprint === fp))
      .filter((i): i is ReportItem => Boolean(i));

    const baseBody = renderLetter(planned.templateKey, {
      user,
      target: planned.target,
      items: letterItems,
      date: now.toISOString(),
      roundNumber,
      enclosures,
    });
    const body = await varyLetterWording(baseBody);

    const letterFields = {
      user_id: userId,
      round_id: round.id,
      target_type: planned.target.type,
      target_key: planned.target.key,
      target_name: planned.target.name,
      target_address_lines: planned.target.addressLines,
      template_key: planned.templateKey,
      escalation_stage: planned.stage,
      body,
      status: "draft",
    };
    const { data: letterRow, error: letterError } = prior
      ? await db.from("letters").update(letterFields).eq("id", prior.id).select("id").single()
      : await db.from("letters").insert(letterFields).select("id").single();
    if (letterError || !letterRow) {
      return NextResponse.json({ error: letterError?.message ?? "Could not save letter" }, { status: 500 });
    }

    const font = pickFont(letterRow.id);
    let mail;
    try {
      mail = await mailLetter({
        to: { name: planned.target.name, addressLines: planned.target.addressLines },
        from: { name: user.fullName, addressLines: user.addressLines },
        // The letter is plain text and is escaped, so a creditor name or a
        // user-typed reason can never be read as markup by the print renderer.
        bodyHtml: letterHtml({ body, fontFamily: font.family, sizePt: font.sizePt, enclosures: enclosurePages }),
        idempotencyKey: letterRow.id,
      });
    } catch (error) {
      // The mail provider refused this letter. Leave it as a draft, tell the
      // operator, and stop: the round stays in "draft" so the user can approve
      // again. On the retry, letters that already went out are skipped and this
      // one reuses its row (see priorByKey above).
      await reportError(error, { where: "api/attacks/approve:mail", userId, extra: { letterId: letterRow.id } });
      return NextResponse.json(
        { error: "A letter could not be sent to the mail service. Nothing was lost; please try again.", mailed: mailedLetters },
        { status: 502 },
      );
    }

    await db
      .from("letters")
      .update({ font_family: font.family, lob_id: mail.externalId, status: "queued", mailed_at: now.toISOString() })
      .eq("id", letterRow.id);

    if (letterItems.length > 0) {
      await db.from("letter_items").insert(
        letterItems.flatMap((i) => {
          const row = itemRowByFp.get(i.fingerprint);
          return row ? [{ letter_id: letterRow.id, item_id: row.id, escalation_stage: planned.stage }] : [];
        }),
      );
    }
    mailedLetters.push({ id: letterRow.id, target: planned.target.name, stage: planned.stage });
  }

  const nextDue = new Date(now.getTime() + ROUND_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  await db
    .from("attack_rounds")
    .update({
      status: "mailed",
      approved_at: now.toISOString(),
      mailed_at: now.toISOString(),
      next_round_due_at: nextDue.toISOString(),
    })
    .eq("id", round.id);

  await db.from("events").insert({
    user_id: userId,
    kind: "attack_approved",
    payload: { roundNumber, letterCount: mailedLetters.length },
  });

  if (profileRow.phone_e164) {
    await sendWhatsApp(profileRow.phone_e164, {
      kind: "letters_mailed",
      roundNumber,
      letterCount: mailedLetters.length,
    }).catch(() => undefined);
  }

  return NextResponse.json({ approved: true, letters: mailedLetters, nextRoundDueAt: nextDue.toISOString() });
}
