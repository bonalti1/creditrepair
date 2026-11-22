import type { StaffRound } from "../staff/types";

/**
 * The round's letters in one short key: who each goes to, which template,
 * and which items. A change in any of them is a different round to review,
 * and its review window starts again.
 */
export function roundPlanKey(round: Pick<StaffRound, "letters">): string {
  const text = round.letters
    .map((l) => `${l.recipient.type}:${l.recipient.key}:${l.templateKey}:${l.items.map((i) => i.fingerprint).sort().join(",")}`)
    .sort()
    .join("|");
  // FNV-1a, 32-bit: short and stable, not a security measure.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `p${hash.toString(16).padStart(8, "0")}${round.letters.length}`;
}
