import type { ContentPiece } from "./types";

/**
 * What sales sees: approved partner material only, to read, copy and download
 * (the database's "sales reads approved partner material" policy says the same).
 */
export function partnerMaterialOf(pieces: readonly ContentPiece[]): ContentPiece[] {
  return pieces.filter((p) => (p.audience === "partners" || p.type === "partner") && ["approved", "scheduled", "posted", "measured"].includes(p.status));
}
