import { z } from "zod";
import { containsTaxpayerNumber } from "../aftercare/itin";
import { sanitizeAttribution } from "../ads/capture";
import { isStateCode, stateStatus } from "../compliance/states";
import { cleanPersonName, normalizeEmail, normalizePhone } from "../staff/team";
import { GOALS, TIMELINES, type RegistrantGoal, type RegistrantTimeline, type Served } from "./types";

// What the public registration form sends (POST /api/webinars), checked on
// the server before anything is written. The phone is the registration's key
// (one per number per webinar). The state decides how they are served:
// Texas is served; any other state may register to learn and is marked out
// of state; Georgia is refused with the "restricted" explanation (it never
// opens: src/lib/compliance/stateRules.ts).

export const registerBodySchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
    firstName: z.string().max(80),
    lastName: z.string().max(80).nullable().optional(),
    phone: z.string().max(30),
    email: z.string().max(254).nullable().optional(),
    state: z.string().max(2),
    locale: z.enum(["en", "es"]),
    goal: z.enum(GOALS),
    timeline: z.enum(TIMELINES),
    question: z.string().max(500).nullable().optional(),
    remindersConsent: z.boolean(),
    consentVersion: z.string().max(40),
    // An ad link's marketing tags (src/lib/ads/capture.ts), checked again by sanitizeAttribution.
    attribution: z.unknown().optional(),
  })
  .strict();

export type RegisterBody = z.infer<typeof registerBodySchema>;

export type RegisterProblem = "firstName" | "phone" | "email" | "state" | "question" | "georgia";

export interface CleanRegistration {
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  state: string;
  served: Served;
  locale: "en" | "es";
  goal: RegistrantGoal;
  timeline: RegistrantTimeline;
  question: string | null;
  remindersConsent: boolean;
  attribution: ReturnType<typeof sanitizeAttribution>;
}

/** How a state is served for a webinar: Texas, out of state (may learn), or refused (Georgia). */
export function servedFor(state: string): Served | "refused" {
  if (state === "TX") return "texas";
  // Georgia (and any state the law restricts) is "blocked" whatever is switched on /equipo/estados.
  return stateStatus(state) === "blocked" ? "refused" : "out_of_state";
}

/** The form's answers, tidied, or the fields to fix. */
export function cleanRegistration(body: RegisterBody): { ok: true; value: CleanRegistration } | { ok: false; problems: RegisterProblem[] } {
  const problems: RegisterProblem[] = [];
  const firstName = cleanPersonName(body.firstName, 60);
  if (!firstName) problems.push("firstName");
  const lastRaw = (body.lastName ?? "").trim();
  const lastName = lastRaw ? cleanPersonName(lastRaw, 80) : null;
  const phone = normalizePhone(body.phone);
  if (!phone) problems.push("phone");
  const emailRaw = (body.email ?? "").trim();
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && !email) problems.push("email");
  const state = body.state.toUpperCase();
  if (!isStateCode(state)) problems.push("state");
  const question = (body.question ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  // No account or Social Security numbers in a free-text field.
  if (question && (containsTaxpayerNumber(question) || /\d{8,}/.test(question.replace(/[\s-]/g, "")))) problems.push("question");
  const served = isStateCode(state) ? servedFor(state) : null;
  if (served === "refused") problems.push("georgia");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      firstName: firstName!,
      lastName: lastRaw && lastName ? lastName : null,
      phone: phone!,
      email,
      state,
      served: served as Served,
      locale: body.locale,
      goal: body.goal,
      timeline: body.timeline,
      question,
      remindersConsent: body.remindersConsent,
      attribution: sanitizeAttribution(body.attribution),
    },
  };
}

/** "Rosa G.": all a teammate without leads.work sees of a registrant. */
export function shortName(first: string, last: string | null): string {
  const f = first.trim().split(/\s+/)[0] ?? "";
  const l = (last ?? "").trim();
  return l ? `${f} ${l.charAt(0).toUpperCase()}.` : f;
}
