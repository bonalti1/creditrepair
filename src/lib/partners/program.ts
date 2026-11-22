// "Comisiones a socios": the program-wide switch for referral fees (migration
// 0023, partner_program_changes). OFF until an administrator turns it on and
// confirms the attorney approved paying referral fees (RESPA Section 8 for
// realtors and loan officers, Texas Finance Code ch. 393). While it is off:
//   - no commission terms can be set and no amount can be recorded (the
//     database refuses both, whatever the server code does);
//   - partners see no commission figures, and the partner terms, the signup
//     page and the "Cómo funciona" page say the program has no referral fees;
//   - the business dashboard hides the commission figures.

export interface PartnerProgram {
  commissionsEnabled: boolean;
  /** The newest change, if there was one. */
  changedAt: string | null;
  changedBy: string | null;
  attorneyName: string | null;
  /** "2026-11-20" */
  attorneyApprovedOn: string | null;
}

export const PROGRAM_OFF: PartnerProgram = { commissionsEnabled: false, changedAt: null, changedBy: null, attorneyName: null, attorneyApprovedOn: null };

export interface ProgramChangeInput {
  enabled: boolean;
  attorneyName?: string | null;
  attorneyApprovedOn?: string | null;
  /** "El abogado aprobó pagar comisiones a socios": ticked by the administrator. */
  confirmed?: boolean;
}

export type ProgramChangeCheck =
  | { ok: true; value: { enabled: boolean; attorneyName: string | null; attorneyApprovedOn: string | null; confirmed: boolean } }
  | { ok: false; message: string };

/** Turning it off needs nothing; turning it on needs the attorney's name, the day they approved it, and the confirmation. */
export function checkProgramChange(input: ProgramChangeInput, now: Date = new Date()): ProgramChangeCheck {
  if (!input.enabled) return { ok: true, value: { enabled: false, attorneyName: null, attorneyApprovedOn: null, confirmed: false } };
  const name = (input.attorneyName ?? "").replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
  if (name.length < 3 || name.length > 120) return { ok: false, message: "Escribe el nombre del abogado que lo aprobó." };
  const day = (input.attorneyApprovedOn ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return { ok: false, message: "Escribe la fecha de la aprobación." };
  if (Date.parse(`${day}T00:00:00Z`) > now.getTime()) return { ok: false, message: "La fecha de la aprobación no puede ser futura." };
  if (input.confirmed !== true) return { ok: false, message: "Confirma que el abogado aprobó pagar comisiones a socios." };
  return { ok: true, value: { enabled: true, attorneyName: name, attorneyApprovedOn: day, confirmed: true } };
}

/** The newest row of partner_program_changes as the program, or OFF. */
export function programFromRow(row: Record<string, unknown> | null | undefined, handleOf: (id: string) => string | null = () => null): PartnerProgram {
  if (!row) return PROGRAM_OFF;
  const day = row.attorney_approved_on;
  return {
    commissionsEnabled: row.commissions_enabled === true,
    changedAt: typeof row.changed_at === "string" ? row.changed_at : row.changed_at instanceof Date ? row.changed_at.toISOString() : null,
    changedBy: (typeof row.changed_by_name === "string" && row.changed_by_name) || (row.changed_by ? handleOf(String(row.changed_by)) : null),
    attorneyName: typeof row.attorney_name === "string" ? row.attorney_name : null,
    attorneyApprovedOn: typeof day === "string" ? day.slice(0, 10) : day instanceof Date ? day.toISOString().slice(0, 10) : null,
  };
}

/** What a partner or a prospect reads about fees, ES and EN. */
export const NO_FEES_LINE: Record<"es" | "en", string> = {
  es: "Por ahora, el programa de socios no paga comisiones por referir.",
  en: "For now, the partner program pays no referral fees.",
};
