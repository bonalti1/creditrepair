import { NextResponse } from "next/server";
import { z } from "zod";
import { existingFrom, matchSalesperson, planImport, sensitiveColumns, shortName, summarize, type Mapping } from "@/lib/fulfillment/crcImport";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";

// Importing from Credit Repair Cloud (/equipo/importar; migration 0041;
// docs/FULFILLMENT.md "Moving from Credit Repair Cloud"). Administrators only:
// requireCapability("clients.import").
//
//   GET  the import log (each batch and what happened to each row), and the
//        phones and emails already on file, so the browser's dry run shows the
//        same duplicates the server will find.
//   POST import {kind, fileName, fileSha256, rows, mapping, includeInactive, locale}
//        The browser already dropped the SSN and birth-date columns; they are
//        dropped AGAIN here (sensitiveColumns), and an SSN-like number in any
//        other cell is blanked, before anything is stored. The dry run is
//        repeated here against the database: only "create" rows are written.
//        Clients and leads become prospects (source crc_import) with an
//        invitation to prepare: they finish onboarding in Credalti and sign
//        Credalti's own agreement. Nothing is charged (no charge can exist
//        without a mailed round: billing's triggers). Affiliates become an
//        invitation to apply as a partner (they accept the partner rules themselves).
//   POST undo {batchId}  removes that batch's people who have not been invited
//        and have no account yet; the others stay, and the log says how many.

type Row = Record<string, unknown>;

const MAX_ROWS = 5000;

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("import"),
      kind: z.enum(["clients", "leads", "affiliates"]),
      fileName: z.string().min(1).max(200),
      fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
      rows: z.array(z.array(z.string().max(500)).max(80)).min(1).max(MAX_ROWS + 1),
      mapping: z.record(z.string(), z.number().int().min(0).max(79)),
      includeInactive: z.boolean(),
      locale: z.enum(["en", "es"]),
    })
    .strict(),
  z.object({ action: z.literal("undo"), batchId: z.string().uuid() }).strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-import-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("clients.import");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  try {
    const [batches, rows, invites, prospects, profiles, partners] = await Promise.all([
      db.from("crc_import_batches").select("*").order("created_at", { ascending: false }).limit(50),
      db.from("crc_import_rows").select("id, batch_id, line, outcome, short_name, crc_status, reasons, prospect_id"),
      db.from("crc_affiliate_invites").select("*"),
      db.from("prospects").select("id, phone_e164, email, invited_at, converted_user_id, lost_at, first_name, state, salesperson, locale, import_batch_id"),
      db.from("profiles").select("id, phone_e164"),
      db.from("partners").select("phone_e164, email"),
    ]);
    for (const r of [batches, rows, invites, prospects, profiles, partners]) if (r.error) throw new Error(r.error.message);
    const p = (prospects.data as Row[] | null) ?? [];
    const open = p.filter((x) => !x.converted_user_id && !x.lost_at);
    return NextResponse.json({
      batches: (batches.data as Row[] | null) ?? [],
      rows: (rows.data as Row[] | null) ?? [],
      invites: (invites.data as Row[] | null) ?? [],
      imported: p.filter((x) => x.import_batch_id),
      existing: {
        prospects: open.map((x) => ({ phone: x.phone_e164 ?? null, email: x.email ?? null })),
        clients: [
          ...((profiles.data as Row[] | null) ?? []).map((x) => ({ phone: x.phone_e164 ?? null, email: null })),
          ...p.filter((x) => x.converted_user_id).map((x) => ({ phone: x.phone_e164 ?? null, email: x.email ?? null })),
        ],
        partners: ((partners.data as Row[] | null) ?? []).map((x) => ({ phone: x.phone_e164 ?? null, email: x.email ?? null })),
      },
    });
  } catch (error) {
    await reportError(error, { where: "api/staff/import:read", userId: member.userId });
    return NextResponse.json({ error: "Could not read the import log." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-import", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 3_000_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const allowed = await requireCapability("clients.import");
  if (!allowed.ok) return allowed.response;
  const { db, member } = allowed;
  const input = parsed.data;
  try {
    if (input.action === "undo") return await undo(db, input.batchId, member.name);

    // Drop the sensitive columns again, whatever the browser sent.
    const header = input.rows[0]!;
    const dropped = new Set(sensitiveColumns(header));
    const keep = header.map((_, i) => i).filter((i) => !dropped.has(i));
    const rows = input.rows.map((r) => keep.map((i) => r[i] ?? ""));
    const remap = new Map(keep.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const mapping: Mapping = Object.fromEntries(Object.entries(input.mapping).flatMap(([field, i]) => (remap.has(i) ? [[field, remap.get(i)!]] : [])));
    const droppedNames = [...dropped].map((i) => header[i]!.slice(0, 60));

    const { data: same } = await db.from("crc_import_batches").select("id").eq("kind", input.kind).eq("file_sha256", input.fileSha256).is("undone_at", null).maybeSingle();
    if (same) return NextResponse.json({ error: "This file was imported already.", code: "same_file" }, { status: 409 });

    const [prospects, profiles, partners, staff] = await Promise.all([
      db.from("prospects").select("phone_e164, email, converted_user_id, lost_at"),
      db.from("profiles").select("phone_e164"),
      db.from("partners").select("phone_e164, email"),
      db.from("staff_members").select("handle, display_name, role, active"),
    ]);
    const p = (prospects.data as Row[] | null) ?? [];
    const existing = existingFrom({
      prospects: p.filter((x) => !x.converted_user_id && !x.lost_at).map((x) => ({ phone: (x.phone_e164 as string) ?? null, email: (x.email as string) ?? null })),
      clients: [
        ...((profiles.data as Row[] | null) ?? []).map((x) => ({ phone: (x.phone_e164 as string) ?? null, email: null })),
        ...p.filter((x) => x.converted_user_id).map((x) => ({ phone: (x.phone_e164 as string) ?? null, email: (x.email as string) ?? null })),
      ],
      partners: ((partners.data as Row[] | null) ?? []).map((x) => ({ phone: (x.phone_e164 as string) ?? null, email: (x.email as string) ?? null })),
    });
    const plan = planImport(rows, mapping, input.kind, existing, { includeInactive: input.includeInactive });
    const members = ((staff.data as Row[] | null) ?? []).map((m) => ({ handle: String(m.handle ?? ""), name: String(m.display_name ?? ""), role: String(m.role), active: m.active === true }));

    const { data: batch, error: batchError } = await db
      .from("crc_import_batches")
      .insert({
        kind: input.kind,
        file_name: input.fileName,
        file_sha256: input.fileSha256,
        dropped_columns: droppedNames,
        mapping: Object.fromEntries(Object.entries(mapping).map(([f, i]) => [f, rows[0]![i as number] ?? ""])),
        row_count: plan.length,
        created_by: member.userId,
        created_by_name: member.name.slice(0, 80),
      })
      .select("id")
      .single();
    if (batchError) throw new Error(batchError.message);
    const batchId = String((batch as Row).id);

    let created = 0;
    const logRows: Row[] = [];
    for (const row of plan) {
      let outcome: string = row.outcome === "create" ? "created" : row.outcome;
      let prospectId: string | null = null;
      const reasons = [...row.reasons];
      if (row.outcome === "create") {
        if (input.kind === "affiliates") {
          const { error } = await db.from("crc_affiliate_invites").insert({
            batch_id: batchId,
            name: `${row.firstName} ${row.lastName}`.trim().slice(0, 80),
            company: row.company,
            phone_e164: row.phoneE164,
            email: row.email,
          });
          if (error) {
            outcome = "problem";
            reasons.push("duplicate_in_file");
          } else created += 1;
        } else {
          const { data, error } = await db
            .from("prospects")
            .insert({
              first_name: row.firstName,
              last_name: row.lastName,
              phone_e164: row.phoneE164,
              email: row.email,
              state: row.state,
              goal: "general",
              salesperson: matchSalesperson(row.assignedTo, members, member.handle),
              created_by: member.userId,
              source: "crc_import",
              source_detail: {
                firstTouch: { channel: "crc_import", batch: batchId },
                crc: { status: row.status, statusText: row.statusText, added: row.added, referredBy: row.referredBy, city: row.city },
              },
              locale: input.locale,
              import_batch_id: batchId,
            })
            .select("id")
            .single();
          // A phone that became a lead between the dry run and now: a duplicate, not an error.
          if (error) {
            outcome = "duplicate";
            reasons.unshift("duplicate_prospect");
          } else {
            prospectId = String((data as Row).id);
            created += 1;
          }
        }
      }
      logRows.push({
        batch_id: batchId,
        line: row.line,
        outcome,
        short_name: shortName(row),
        crc_status: row.statusText,
        reasons,
        prospect_id: prospectId,
      });
    }
    for (let i = 0; i < logRows.length; i += 500) {
      const { error } = await db.from("crc_import_rows").insert(logRows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    const summary = summarize(plan);
    await db.from("crc_import_batches").update({ created_count: created, skipped_count: plan.length - created }).eq("id", batchId);
    return NextResponse.json({ ok: true, batchId, created, summary, dropped: droppedNames });
  } catch (error) {
    await reportError(error, { where: `api/staff/import:${input.action}`, userId: member.userId });
    return NextResponse.json({ error: "Could not import the file." }, { status: 500 });
  }
}

async function undo(db: import("@supabase/supabase-js").SupabaseClient, batchId: string, by: string) {
  const { data: batch } = await db.from("crc_import_batches").select("id, kind, undone_at").eq("id", batchId).maybeSingle();
  if (!batch) return NextResponse.json({ error: "No such import" }, { status: 404 });
  if ((batch as Row).undone_at) return NextResponse.json({ error: "Already undone", code: "already_undone" }, { status: 409 });
  let kept = 0;
  if ((batch as Row).kind === "affiliates") {
    const { data: invites } = await db.from("crc_affiliate_invites").select("id, invited_at").eq("batch_id", batchId);
    for (const inv of (invites as Row[] | null) ?? []) {
      if (inv.invited_at) {
        kept += 1;
        continue;
      }
      await db.from("crc_affiliate_invites").delete().eq("id", inv.id);
    }
  } else {
    const { data: people } = await db.from("prospects").select("id, invited_at, converted_user_id").eq("import_batch_id", batchId);
    for (const person of (people as Row[] | null) ?? []) {
      // Someone invited or with an account stays: they may already be talking with us.
      if (person.invited_at || person.converted_user_id) {
        kept += 1;
        await db.from("crc_import_rows").update({ outcome: "kept" }).eq("batch_id", batchId).eq("prospect_id", person.id);
        continue;
      }
      await db.from("leads").delete().eq("prospect_id", person.id).eq("source", "crc_import").is("last_inbound_at", null);
      const { error } = await db.from("prospects").delete().eq("id", person.id);
      // A teammate already wrote a note or a household link about them: kept.
      if (error) {
        kept += 1;
        await db.from("crc_import_rows").update({ outcome: "kept" }).eq("batch_id", batchId).eq("prospect_id", person.id);
      }
    }
  }
  // Every row still "created" was removed (its prospect_id went to null with it).
  await db.from("crc_import_rows").update({ outcome: "undone" }).eq("batch_id", batchId).eq("outcome", "created");
  const { error } = await db.from("crc_import_batches").update({ undone_at: new Date().toISOString(), undone_by_name: by.slice(0, 80), undo_kept: kept }).eq("id", batchId);
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true, kept });
}
