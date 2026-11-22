import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from "./copy";
import { REFERRAL_CODE } from "./rules";

// Referral attribution for a partner's link (/r/<code>) and an invitation
// carrying a partner's code.
//
// The link sets a first-party cookie, `credalti_socio=<code>`, for 60 days
// (REFERRAL_COOKIE_DAYS), path "/", SameSite=Lax, Secure in production. It is
// not HttpOnly: it holds only the public code, and the landing page may read
// it. When that browser's person creates an account, the onboarding route
// reads the cookie (or the code from the invitation link) and credits the
// partner on the profile (profiles.referred_partner_id), with the service role:
//   - only an APPROVED partner's code counts;
//   - first touch: a client who already has a partner keeps them;
//   - a prospect's partner, carried over at conversion (staff/server.ts
//     convertProspect), comes first, because it runs before this.

export const REFERRAL_COOKIE_MAX_AGE = REFERRAL_COOKIE_DAYS * 24 * 60 * 60;

/** The code in a Cookie header, if it is well formed. */
export function referralCodeFromCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === REFERRAL_COOKIE) {
      const value = decodeURIComponent(rest.join("=")).trim().toLowerCase();
      return REFERRAL_CODE.test(value) ? value : null;
    }
  }
  return null;
}

/** The Set-Cookie options for the referral cookie. */
export function referralCookie(code: string, secure: boolean) {
  return { name: REFERRAL_COOKIE, value: code, maxAge: REFERRAL_COOKIE_MAX_AGE, path: "/", sameSite: "lax" as const, secure, httpOnly: false };
}

/** Credits an approved partner on the client's profile, if they have none. Service role. True when written. */
export async function creditPartner(db: SupabaseClient, userId: string, code: string): Promise<boolean> {
  if (!REFERRAL_CODE.test(code)) return false;
  const { data: partner } = await db.from("partners").select("id").eq("referral_code", code).eq("status", "approved").maybeSingle();
  if (!partner) return false;
  const { data: profile } = await db.from("profiles").select("referred_partner_id").eq("id", userId).maybeSingle();
  if (!profile || profile.referred_partner_id) return false;
  const { error } = await db.from("profiles").update({ referred_partner_id: partner.id }).eq("id", userId).is("referred_partner_id", null);
  return !error;
}
