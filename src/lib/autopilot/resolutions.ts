import type { SupabaseClient } from "@supabase/supabase-js";
import type { SelfResolution, StaffClient } from "../staff/types";

// "Resuelto solo": what the system settled by itself that used to wait for a
// person. One row per fact (autopilot_resolutions, migration 0022), written
// where it happens, counted on the staff home ("Esta semana el sistema
// resolvió N cosas por su cuenta") so the team sees what it no longer does.

export const RESOLUTION_KINDS = ["address_corrected", "address_confirmed", "letter_remailed", "payment_fixed", "document_reuploaded", "furnisher_matched"] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

/** For the staff home: what each kind of fix used to cost a person. */
export const RESOLUTION_LABEL: Record<ResolutionKind, string> = {
  address_corrected: "Direcciones corregidas con los datos del correo",
  address_confirmed: "Direcciones confirmadas por el cliente",
  letter_remailed: "Cartas devueltas enviadas de nuevo",
  payment_fixed: "Pagos resueltos por el cliente",
  document_reuploaded: "Documentos subidos de nuevo",
  furnisher_matched: "Acreedores encontrados en la libreta",
};

/** The same, for the staff console in English. */
export const RESOLUTION_LABEL_EN: Record<ResolutionKind, string> = {
  address_corrected: "Addresses corrected with the post office's data",
  address_confirmed: "Addresses confirmed by the client",
  letter_remailed: "Returned letters mailed again",
  payment_fixed: "Payments fixed by the client",
  document_reuploaded: "Documents uploaded again",
  furnisher_matched: "Creditors found in the address book",
};

type Detail = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** One line for the team, from a row's kind and detail. */
export function resolutionText(kind: ResolutionKind, detail: Detail): string {
  switch (kind) {
    case "address_corrected":
      return `El correo escribió la dirección ${detail.subject === "client" ? "del cliente" : `de ${s(detail.name) || "un destinatario"}`} a su manera (${s(detail.lines)}); se usó así.`;
    case "address_confirmed":
      return "El cliente confirmó su dirección desde el enlace del sistema.";
    case "letter_remailed":
      return `La carta devuelta para ${s(detail.recipient) || "un destinatario"} salió de nuevo a la dirección corregida (misma ronda, sin otro cobro).`;
    case "payment_fixed":
      return `El cobro de la ronda ${s(detail.roundNumber)} pasó después de un rechazo${detail.afterCardUpdate ? ", al actualizar su tarjeta" : ""}.`;
    case "document_reuploaded":
      return `Subió de nuevo su ${detail.kind === "government_id" ? "identificación" : "comprobante de domicilio"} y la revisión automática lo aceptó.`;
    case "furnisher_matched":
      return `La libreta ya tenía a ${s(detail.company)} con otro nombre.`;
  }
}

export function resolutionFromRow(row: Record<string, unknown>): SelfResolution | null {
  const kind = RESOLUTION_KINDS.find((k) => k === row.kind);
  if (!kind) return null;
  const at = typeof row.at === "string" ? new Date(row.at).toISOString() : null;
  if (!at) return null;
  return { id: s(row.id), kind, at, text: resolutionText(kind, (row.detail as Detail | null) ?? {}) };
}

/** Records one fix, once (its dedupe key). Never throws: a record that could not be written must not undo the fix. */
export async function recordResolution(
  db: SupabaseClient,
  input: { userId: string | null; kind: ResolutionKind; detail?: Detail; dedupeKey: string; at?: Date },
): Promise<"recorded" | "duplicate" | "skipped"> {
  try {
    const { error } = await db.from("autopilot_resolutions").insert({
      user_id: input.userId,
      kind: input.kind,
      detail: input.detail ?? {},
      dedupe_key: input.dedupeKey.slice(0, 240),
      ...(input.at ? { at: input.at.toISOString() } : {}),
    });
    if (!error) return "recorded";
    if (error.code === "23505") return "duplicate";
    return "skipped";
  } catch {
    return "skipped";
  }
}

export interface ResolvedSummary {
  total: number;
  byKind: Array<{ kind: ResolutionKind; count: number }>;
}

/** What the system resolved between `from` and `to`, across clients: "Esta semana el sistema resolvió N cosas por su cuenta". */
export function resolvedBetween(clients: readonly StaffClient[], from: Date, to: Date): ResolvedSummary {
  const counts = new Map<ResolutionKind, number>();
  for (const client of clients) {
    for (const r of client.resolutions ?? []) {
      if (r.at < from.toISOString() || r.at > to.toISOString()) continue;
      counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    }
  }
  const byKind = RESOLUTION_KINDS.flatMap((kind) => (counts.get(kind) ? [{ kind, count: counts.get(kind)! }] : []));
  return { total: byKind.reduce((n, k) => n + k.count, 0), byKind };
}
