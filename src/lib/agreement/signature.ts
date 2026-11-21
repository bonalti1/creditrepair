// The typed signature. The client signs by typing their full legal name; when
// the profile already has a name, the two have to be recognisably the same
// person. The comparison forgives what people really type on a phone: no
// accents, different capitals, a second surname or a middle name left out.

/** "María-José  HERNÁNDEZ" → ["maria", "jose", "hernandez"]. */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/[\s'-]+/)
    .filter((token) => token.length > 0);
}

/** A full name: at least a first name and a surname, letters only, of a believable length. */
export function isFullName(name: string): boolean {
  const clean = name.trim();
  if (clean.length < 3 || clean.length > 120) return false;
  if (/[^\p{L}\p{M}\s.'-]/u.test(clean)) return false;
  const tokens = nameTokens(clean);
  return tokens.length >= 2 && tokens.some((t) => t.length >= 2);
}

/**
 * True when the typed name and the name on the profile are reasonably the same:
 * every word of the shorter one appears in the longer one, and they share at
 * least two words (or all of them, when the profile has a single word).
 * With no name on the profile there is nothing to compare, and it matches.
 */
export function signerNameMatches(typed: string, profileName: string | null | undefined): boolean {
  const profile = nameTokens(profileName ?? "");
  if (profile.length === 0) return true;
  const signed = nameTokens(typed);
  if (signed.length === 0) return false;
  const [shorter, longer] = signed.length <= profile.length ? [signed, profile] : [profile, signed];
  const pool = [...longer];
  for (const token of shorter) {
    const at = pool.indexOf(token);
    if (at === -1) return false;
    pool.splice(at, 1);
  }
  return shorter.length >= Math.min(2, profile.length);
}
