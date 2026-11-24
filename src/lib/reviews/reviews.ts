import { BRAND } from "../brand";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import type { StaffClient } from "../staff/types";

// The review engine: asking every client, once, to leave a public review on
// the platforms the owner configured (Google Business Profile, Trustpilot,
// BBB), and the team's view of what was asked and what the platforms show.
//
// The compliance design, and why (docs/REVIEWS.md has the sources):
//
//   1. No incentive of any kind. Nothing is offered, given, credited or
//      entered for a review, positive or negative. The FTC rule bans
//      incentives conditioned on a sentiment (16 C.F.R. § 465.4); Google,
//      Trustpilot and BBB ban incentives altogether, so we follow the
//      stricter rule. The referral credit (billing, migration 0026) is for a
//      referral, never mentioned with a review and never tied to one. Every
//      word we send is checked for incentive language (reviewCopyProblems).
//   2. No review gating. Who is asked never depends on how they feel. The
//      milestones (REVIEW_MILESTONES) are moments every client who stays
//      reaches: the first new report after round 1 WHATEVER IT SHOWS (not
//      "only if something changed": that would pick clients by outcome), a
//      person they referred signing up, the end of their service. The pulse
//      ("¿Cómo vamos?") shows the SAME review links after every face; a sad or
//      neutral face is also offered a direct line to the team, never INSTEAD
//      of the links. reviewRequestDue takes no sentiment at all, and a held
//      client is asked like anyone else (a hold must not become a way to keep
//      an unhappy client from being asked). There is no per-client "do not
//      ask" switch, by design. Asking only happy customers is what the FTC's
//      Endorsement Guides (16 C.F.R. § 255.2(e)) call distorting what
//      consumers think, Google calls "selectively soliciting positive reviews"
//      and Trustpilot's "invite all or none" forbids.
//   3. No suppression. We never ask anyone to take a review down or change
//      it, threaten, or hide negative ones (16 C.F.R. § 465.7); the contract
//      has no non-disparagement clause (Consumer Review Fairness Act,
//      15 U.S.C. § 45b; a test reads the agreement).
//   4. No fake, staff or insider reviews. Only clients are asked (never the
//      team: § 465.2 fake reviews, § 465.5 insider reviews without disclosure).
//      The console says so, and the reply drafter answers reviews, it never
//      writes them.
//   5. Once per client, in their language, through the autopilot's own rules:
//      opt-out, quiet hours, the daily cap, the dedupe key, WhatsApp then
//      email, never SMS.
//   6. Replies to public reviews (reply.ts) carry no private information (a
//      reply that confirms someone is a client of a credit repair company is
//      already private information) and no promise; a person posts them.

export const REVIEW_PLATFORMS = ["google", "trustpilot", "bbb"] as const;
export type ReviewPlatformKey = (typeof REVIEW_PLATFORMS)[number];

export const PLATFORM_NAME: Record<ReviewPlatformKey, string> = {
  google: "Google",
  trustpilot: "Trustpilot",
  bbb: "BBB",
};

export const PLATFORM_LONG_NAME: Record<ReviewPlatformKey, { es: string; en: string }> = {
  google: { es: "Perfil de Negocio en Google", en: "Google Business Profile" },
  trustpilot: { es: "Trustpilot", en: "Trustpilot" },
  bbb: { es: "Better Business Bureau (BBB)", en: "Better Business Bureau (BBB)" },
};

/** The hosts a review link may point at, per platform. Anything else is refused. */
export const PLATFORM_HOSTS: Record<ReviewPlatformKey, readonly string[]> = {
  google: ["g.page", "google.com", "www.google.com", "search.google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl"],
  trustpilot: ["trustpilot.com", "www.trustpilot.com"],
  bbb: ["bbb.org", "www.bbb.org"],
};

export interface ReviewPlatform {
  key: ReviewPlatformKey;
  /** Where a client writes the review. Null until the owner sets it. */
  url: string | null;
  enabled: boolean;
  /** Typed in by a person from the platform's own page (we do not read their APIs). 1.0–5.0. */
  rating: number | null;
  reviewCount: number | null;
  ratingUpdatedAt: string | null;
  ratingUpdatedBy: string | null;
}

export const REVIEW_MILESTONES = ["pulse_answered", "first_results", "referral_signed", "program_finished"] as const;
export type ReviewMilestone = (typeof REVIEW_MILESTONES)[number];

export interface ReviewSettings {
  /** Asking by WhatsApp / email at the milestones. Off until an administrator turns it on. */
  requestsEnabled: boolean;
  /** Each milestone on or off. A milestone off delays the ask to the next one; nobody is excluded by it. */
  milestones: Record<ReviewMilestone, boolean>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const ALL_MILESTONES_ON = Object.fromEntries(REVIEW_MILESTONES.map((m) => [m, true])) as Record<ReviewMilestone, boolean>;

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { requestsEnabled: false, milestones: ALL_MILESTONES_ON, updatedAt: null, updatedBy: null };

export const EMPTY_PLATFORMS: ReviewPlatform[] = REVIEW_PLATFORMS.map((key) => ({
  key,
  url: null,
  enabled: false,
  rating: null,
  reviewCount: null,
  ratingUpdatedAt: null,
  ratingUpdatedBy: null,
}));

/** One ask on record (review_requests): once per client, whatever the channel. */
export interface ReviewRequestRecord {
  userId: string;
  milestone: ReviewMilestone;
  channel: "whatsapp_or_email" | "in_app";
  at: string;
}

// ── Links ───────────────────────────────────────────────────────────────

/** Why a review link is refused, or null when it may be saved: https, on the platform's own host. */
export function platformUrlProblem(key: ReviewPlatformKey, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "not_a_url";
  }
  if (parsed.protocol !== "https:") return "not_https";
  const host = parsed.hostname.toLowerCase();
  const ok = PLATFORM_HOSTS[key].some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? null : "wrong_host";
}

/** The platforms a client is shown: enabled, with a link. Always in the same order, all of them, to everyone. */
export function livePlatforms(platforms: readonly ReviewPlatform[]): ReviewPlatform[] {
  return REVIEW_PLATFORMS.flatMap((key) => platforms.filter((p) => p.key === key && p.enabled && p.url && !platformUrlProblem(key, p.url)));
}

// ── Who is asked, and when ──────────────────────────────────────────────

export interface ReviewDueInput {
  client: StaffClient;
  settings: ReviewSettings;
  platforms: readonly ReviewPlatform[];
  /** A request is already on record for this client (any channel). */
  alreadyAsked: boolean;
  /** Someone this client referred has signed their agreement (client_referrals). */
  referralSigned?: boolean;
}

/**
 * The milestone to ask at now, or null. Deliberately takes NO sentiment: no
 * pulse rating, no comment, no outcome, no hold. Everyone who reaches a
 * milestone is asked the same way (the no-gating rule, above).
 */
export function reviewRequestDue(input: ReviewDueInput): ReviewMilestone | null {
  const { client, settings, platforms } = input;
  if (!settings.requestsEnabled || input.alreadyAsked) return null;
  if (livePlatforms(platforms).length === 0) return null;
  // A client who cancelled inside the window gets no automatic message (autopilot rule); the
  // links stay on the public page for anyone.
  if (client.agreementCancelledAt || !client.agreementSignedAt) return null;
  if (client.optOut) return null;
  for (const milestone of reachedMilestones(client, input.referralSigned ?? false)) {
    if (milestone !== "pulse_answered" && settings.milestones[milestone]) return milestone;
  }
  return null;
}

/** The milestones a client has reached, in the order they are considered. Pure facts; no sentiment. */
export function reachedMilestones(client: StaffClient, referralSigned: boolean): ReviewMilestone[] {
  const out: ReviewMilestone[] = [];
  if ((client.pulses ?? []).some((p) => PULSE_MOMENTS_WITH_LINKS.includes(p.moment))) out.push("pulse_answered");
  const first = client.rounds.find((r) => r.number === 1);
  // The first new report after round 1, whatever it shows.
  if (first?.mailedAt && (first.respondedAt || first.status === "responded")) out.push("first_results");
  if (referralSigned) out.push("referral_signed");
  if (client.serviceEndRequestedAt && !client.agreementCancelledAt) out.push("program_finished");
  return out;
}

/**
 * The pulse moments after which the review links are shown in the app (to
 * every face). Not right after signing: a review is about the service, and
 * none has been given yet.
 */
export const PULSE_MOMENTS_WITH_LINKS: readonly string[] = ["first_round_mailed", "first_answer"];

/**
 * What the pulse shows after a face (components/Pulse.tsx). The review links
 * do not depend on the face: every face gets them (at the moments that show
 * links). A sad or neutral face ALSO gets the direct line to the team.
 */
export function afterPulseFace(rating: 1 | 2 | 3, moment: string, platformsSetUp: boolean): { reviewLinks: boolean; talkToTeam: boolean } {
  return { reviewLinks: platformsSetUp && PULSE_MOMENTS_WITH_LINKS.includes(moment), talkToTeam: rating < 3 };
}

// ── The team's numbers ──────────────────────────────────────────────────

/**
 * The dashboard number: the average of the platforms' ratings, weighted by
 * their review counts (each platform counted once when a count is missing).
 * Typed in by a person from each platform's own page; null with none.
 */
export function overallRating(platforms: readonly ReviewPlatform[]): { rating: number | null; reviews: number; platforms: number } {
  const rated = platforms.filter((p) => p.enabled && typeof p.rating === "number" && p.rating >= 1 && p.rating <= 5);
  if (rated.length === 0) return { rating: null, reviews: 0, platforms: 0 };
  const weight = (p: ReviewPlatform) => (p.reviewCount && p.reviewCount > 0 ? p.reviewCount : 1);
  const total = rated.reduce((s, p) => s + weight(p), 0);
  const avg = rated.reduce((s, p) => s + p.rating! * weight(p), 0) / total;
  return { rating: Math.round(avg * 100) / 100, reviews: rated.reduce((s, p) => s + (p.reviewCount ?? 0), 0), platforms: rated.length };
}

export interface ReviewRequestSummary {
  total: number;
  byMilestone: Record<ReviewMilestone, number>;
  byChannel: Record<ReviewRequestRecord["channel"], number>;
  last30Days: number;
}

export function reviewRequestSummary(rows: readonly ReviewRequestRecord[], now: Date): ReviewRequestSummary {
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return {
    total: rows.length,
    byMilestone: Object.fromEntries(REVIEW_MILESTONES.map((m) => [m, rows.filter((r) => r.milestone === m).length])) as Record<ReviewMilestone, number>,
    byChannel: { whatsapp_or_email: rows.filter((r) => r.channel === "whatsapp_or_email").length, in_app: rows.filter((r) => r.channel === "in_app").length },
    last30Days: rows.filter((r) => Date.parse(r.at) >= since).length,
  };
}

// ── Reading ratings from the platforms (optional, not built) ─────────────

/**
 * A hook for reading a platform's rating by API instead of typing it in.
 * NOT IMPLEMENTED: each needs an account and its own terms.
 *   - Google: Business Profile APIs (My Business Account Management +
 *     reviews via accounts.locations.reviews), OAuth as the profile's owner,
 *     with Google's API access approval.
 *   - Trustpilot: the Business Units API (public business-unit info and
 *     reviews), an API key from a Trustpilot business account.
 *   - BBB: no public rating API is known; the rating stays typed in.
 * An implementation returns what the platform says, with the time it was
 * read; the page shows it as "read from the platform" instead of "typed in".
 * Until then the console keeps the manual rating.
 */
export interface ReviewRatingProvider {
  platform: ReviewPlatformKey;
  /** Needs credentials the owner sets on the server; never in the browser. */
  configured(): boolean;
  fetchRating(): Promise<{ rating: number; reviewCount: number; asOf: string }>;
}

export const RATING_PROVIDERS: Partial<Record<ReviewPlatformKey, ReviewRatingProvider>> = {};

// ── The words ───────────────────────────────────────────────────────────

/**
 * Incentive or gating language that must never appear in anything we send
 * about reviews. Matched case-insensitively.
 */
const INCENTIVE = [
  /\b(discount|coupon|gift|gift\s*card|reward|prize|raffle|sweepstake|giveaway|free\s+(month|service|round)|credit\s+toward|cash|refund|points)\b/i,
  /\b(descuento|cup[oó]n|regalo|tarjeta\s+de\s+regalo|recompensa|premio|rifa|sorteo|gratis|mes\s+gratis|cr[eé]dito\s+a\s+tu|reembolso|bono)\b/i,
  /\$\s*\d/,
];
const GATING = [
  /\b(if|only\s+if)\s+you('re|\s+are)\s+(happy|satisfied|pleased)\b/i,
  /\b5[\s-]?stars?\b|\bfive[\s-]stars?\b/i,
  /\bsi\s+(est[aá]s|qued[oó]|quedaste)\s+(content[oa]|satisfech[oa]|feliz)\b/i,
  /\b5\s+estrellas\b|\bcinco\s+estrellas\b/i,
  /\b(positive|positiva)\s+(review|rese[nñ]a)\b|\brese[nñ]a\s+positiva\b/i,
];

/** Everything wrong with a piece of review copy: the claim rules, incentives, gating. Empty when it may be used. */
export function reviewCopyProblems(text: string): string[] {
  const problems = [...checkClaimGuardrails(text), ...checkMarketingCopy(text)].map((v) => `claim:${v.rule}`);
  for (const p of INCENTIVE) if (p.test(text)) problems.push(`incentive:${text.match(p)![0]}`);
  for (const p of GATING) if (p.test(text)) problems.push(`gating:${text.match(p)![0]}`);
  return problems;
}

export type L = "es" | "en";

/** The app's public page with the links (no sign-in): /opina. */
export const REVIEW_PAGE_PATH = "/opina";

export const REVIEW_COPY = {
  es: {
    pageTitle: "Cuéntanos cómo te ha ido",
    pageIntro: `Si eres o fuiste cliente de ${BRAND.name}, puedes dejar una reseña pública, buena o mala, en cualquiera de estos sitios. Tu opinión honesta ayuda a otras personas a decidir.`,
    noIncentive: "No damos nada a cambio de una reseña, y dejarla o no, no cambia en nada tu servicio.",
    talkTitle: "¿Algo no está bien?",
    talkBody: "Una persona del equipo te escucha y te responde. Puedes escribirnos aquí aunque también dejes una reseña.",
    talkCta: "Hablar con el equipo",
    leave: (name: string) => `Dejar una reseña en ${name}`,
    none: "Todavía no hay sitios de reseñas configurados.",
    pulseHappy: "Gracias. Si quieres, puedes contarlo en una reseña pública. Buena o mala, tu opinión honesta ayuda a otras personas.",
    pulseUnhappy: "Lamentamos que no vaya bien. Una persona del equipo puede ayudarte: escríbenos y te respondemos.",
    pulseUnhappyLinks: "También puedes dejar una reseña pública, buena o mala, cuando quieras:",
    staffNote: "Solo clientes. Nadie del equipo, ni familiares, escribe reseñas de la empresa.",
  },
  en: {
    pageTitle: "Tell us how it has gone",
    pageIntro: `If you are or were a ${BRAND.name} client, you can leave a public review, good or bad, on any of these sites. Your honest opinion helps other people decide.`,
    noIncentive: "We give nothing in exchange for a review, and leaving one or not changes nothing about your service.",
    talkTitle: "Something not right?",
    talkBody: "A person on the team listens and gets back to you. You can write to us here even if you also leave a review.",
    talkCta: "Talk to the team",
    leave: (name: string) => `Leave a review on ${name}`,
    none: "No review sites are set up yet.",
    pulseHappy: "Thank you. If you like, you can say so in a public review. Good or bad, your honest opinion helps other people.",
    pulseUnhappy: "We are sorry it is not going well. A person on the team can help: write to us and we will get back to you.",
    pulseUnhappyLinks: "You can also leave a public review, good or bad, whenever you want:",
    staffNote: "Clients only. Nobody on the team, and no relatives, writes reviews of the company.",
  },
} as const;

export const MILESTONE_LABEL: Record<L, Record<ReviewMilestone, { title: string; detail: string }>> = {
  es: {
    pulse_answered: { title: "Al contestar «¿Cómo vamos?»", detail: "Después de las primeras cartas o la primera respuesta, con cualquier carita. Las mismas ligas para todos; si la carita es triste o neutral, también la línea directa con el equipo. Se muestra en la app, no se envía mensaje." },
    first_results: { title: "Primer reporte nuevo después de la ronda 1", detail: "Diga lo que diga el reporte. No solo cuando algo cambió: eso sería escoger a quién preguntar según el resultado." },
    referral_signed: { title: "Alguien que refirió firmó", detail: "A quien refirió, si todavía no se le pidió. Sin relación con el crédito por referido." },
    program_finished: { title: "Termina su servicio", detail: "Cuando el cliente pide terminar el servicio, con el resultado que haya tenido." },
  },
  en: {
    pulse_answered: { title: "When answering “How are we doing?”", detail: "After the first letters or the first answer, with any face. The same links for everyone; a sad or neutral face also gets the direct line to the team. Shown in the app; no message is sent." },
    first_results: { title: "First new report after round 1", detail: "Whatever the report shows. Not only when something changed: that would pick whom to ask by outcome." },
    referral_signed: { title: "Someone they referred signed", detail: "The person who referred, if not asked yet. Unrelated to the referral credit." },
    program_finished: { title: "Their service ends", detail: "When the client asks to end the service, whatever their results were." },
  },
};
