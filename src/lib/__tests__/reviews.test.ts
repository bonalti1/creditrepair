import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agreementDocuments } from "../agreement/documents";
import { resolveTerms } from "../agreement/terms";
import { statusMessage } from "../autopilot/status";
import { renderTemplate, STATUS_TEMPLATES } from "../autopilot/templates";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { draftReviewReply, fallbackReply, replyProblems } from "../reviews/reply";
import {
  ALL_MILESTONES_ON,
  afterPulseFace,
  EMPTY_PLATFORMS,
  livePlatforms,
  overallRating,
  platformUrlProblem,
  reachedMilestones,
  REVIEW_COPY,
  reviewCopyProblems,
  reviewRequestDue,
  reviewRequestSummary,
  type ReviewPlatform,
  type ReviewSettings,
} from "../reviews/reviews";
import { DEMO_PLATFORMS } from "../reviews/store";
import { buildDemoClients } from "../staff/demoClients";
import type { StaffClient } from "../staff/types";
import type { PulseRow } from "../pulse/pulse";

// The review engine (src/lib/reviews): who is asked, and when, never depends
// on how they feel (no review gating, 16 C.F.R. § 255.2(e); Google, Trustpilot,
// BBB); nothing is offered for a review (16 C.F.R. § 465.4, and the platforms);
// nothing asks to take one down (§ 465.7); replies carry no private
// information and no promise.

const NOW = new Date("2026-11-24T18:00:00Z");
const ON: ReviewSettings = { requestsEnabled: true, milestones: ALL_MILESTONES_ON, updatedAt: null, updatedBy: null };
const clients = buildDemoClients(NOW);
// A client whose round 1 answers are in (the first new report after round 1).
const withResults = clients.find((c) => c.rounds.some((r) => r.number === 1 && r.status === "responded") && !c.agreementCancelledAt && !c.optOut)!;
const pulse = (rating: 1 | 2 | 3): PulseRow => ({ userId: withResults.id, moment: "first_round_mailed", rating, comment: rating === 1 ? "Nadie me contesta." : null, createdAt: "2026-11-20T18:00:00Z" });
const due = (client: StaffClient, extra: Partial<Parameters<typeof reviewRequestDue>[0]> = {}) =>
  reviewRequestDue({ client, settings: ON, platforms: DEMO_PLATFORMS, alreadyAsked: false, ...extra });

describe("reviews: who is asked (no gating)", () => {
  it("asks at the first new report after round 1, whatever the report shows", () => {
    expect(withResults).toBeDefined();
    expect(due(withResults)).toBe("first_results");
    // No results recorded on the round (nothing changed): asked the same.
    const nothingChanged = { ...withResults, rounds: withResults.rounds.map((r) => ({ ...r, results: [] })) };
    expect(due(nothingChanged)).toBe("first_results");
  });

  it("the pulse face plays no part: a sad, a neutral and a happy client are asked the same", () => {
    const asked = ([1, 2, 3] as const).map((rating) => due({ ...withResults, pulses: [pulse(rating)] }));
    expect(asked).toEqual(["first_results", "first_results", "first_results"]);
    // And the function cannot even be given a sentiment: its input has no such field.
    expect(Object.keys({ client: 0, settings: 0, platforms: 0, alreadyAsked: 0, referralSigned: 0 })).not.toContain("rating");
  });

  it("a held client is asked like anyone else (a hold must not become a way not to ask)", () => {
    const held = { ...withResults, holds: [{ id: "h1", at: "2026-11-20T00:00:00Z", by: "marta", reason: "Está molesto, hablar primero" }] };
    expect(due(held)).toBe("first_results");
  });

  it("once per client, ever", () => {
    expect(due(withResults, { alreadyAsked: true })).toBeNull();
  });

  it("not while asking is off, with no site set up, after a cancellation, or after an opt-out", () => {
    expect(due(withResults, { settings: { ...ON, requestsEnabled: false } })).toBeNull();
    expect(due(withResults, { platforms: EMPTY_PLATFORMS })).toBeNull();
    expect(due({ ...withResults, agreementCancelledAt: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(due({ ...withResults, optOut: { at: "2026-11-01T00:00:00Z", keyword: "BAJA", channel: "whatsapp" } })).toBeNull();
  });

  it("turning a milestone off moves the ask to the next one; it never excludes the client", () => {
    const ended = { ...withResults, serviceEndRequestedAt: "2026-11-23T00:00:00Z" };
    expect(due(ended, { settings: { ...ON, milestones: { ...ALL_MILESTONES_ON, first_results: false } } })).toBe("program_finished");
    expect(due(withResults, { referralSigned: true, settings: { ...ON, milestones: { ...ALL_MILESTONES_ON, first_results: false } } })).toBe("referral_signed");
  });

  it("the milestones are facts every client who stays reaches", () => {
    const fresh = clients.find((c) => c.rounds.length === 0 && c.agreementSignedAt && !c.agreementCancelledAt)!;
    expect(reachedMilestones(fresh, false)).toEqual([]);
    expect(reachedMilestones({ ...fresh, serviceEndRequestedAt: "2026-11-23T00:00:00Z" }, true)).toEqual(["referral_signed", "program_finished"]);
  });

  it("after the pulse: the SAME review links after every face; a sad or neutral face also gets the line to the team", () => {
    for (const rating of [1, 2, 3] as const) expect(afterPulseFace(rating, "first_round_mailed", true).reviewLinks).toBe(true);
    expect(afterPulseFace(1, "first_round_mailed", true).talkToTeam).toBe(true);
    expect(afterPulseFace(2, "first_answer", true).talkToTeam).toBe(true);
    expect(afterPulseFace(3, "first_answer", true).talkToTeam).toBe(false);
    // Right after signing there is no service to review yet; a sad face still gets the team.
    expect(afterPulseFace(1, "agreement_signed", true)).toEqual({ reviewLinks: false, talkToTeam: true });
    expect(afterPulseFace(3, "agreement_signed", true).reviewLinks).toBe(false);
  });

  it("the pulse component renders the links outside any face condition", () => {
    const source = readFileSync("src/components/Pulse.tsx", "utf8");
    // One rule decides (afterPulseFace); the unhappy branch renders the same ReviewSiteButtons.
    expect(source).toMatch(/afterPulseFace\(rating, moment/);
    expect(source.match(/<ReviewSiteButtons/g)).toHaveLength(2);
  });

  it("there is no per-client switch to skip the ask, anywhere in the schema or the code", () => {
    // The schema itself, without its comments (which explain why these are missing).
    const sql = readFileSync("supabase/migrations/0029_reviews.sql", "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/do_not_ask|exclude|skip_review|sentiment|rating\s+integer/i);
    const server = readFileSync("src/lib/reviews/server.ts", "utf8");
    // The run never reads how anyone answered the pulse.
    expect(server).not.toMatch(/client_pulses|\.pulses\b|pulse\.rating/);
  });
});

describe("reviews: the words", () => {
  it("the request, in English and Spanish: good or bad, nothing in exchange, passes the claim rules", () => {
    for (const locale of ["en", "es"] as const) {
      const m = statusMessage("u1", "Rosa", locale, { kind: "review_request", milestone: "first_results" }, "https://app.credalti.com");
      expect(m.dedupeKey).toBe("status:u1:review_request");
      expect(m.link).toBe(`https://app.credalti.com/opina?lang=${locale}`);
      expect(m.body).toContain(m.link);
      expect(checkClaimGuardrails(m.body)).toEqual([]);
      expect(checkMarketingCopy(m.body)).toEqual([]);
      expect(reviewCopyProblems(m.body)).toEqual([]);
    }
    expect(STATUS_TEMPLATES.review_request.body.en).toMatch(/good or bad/);
    expect(STATUS_TEMPLATES.review_request.body.en).toMatch(/We give nothing in exchange/);
    expect(STATUS_TEMPLATES.review_request.body.es).toMatch(/buena o mala/);
    expect(STATUS_TEMPLATES.review_request.body.es).toMatch(/No damos nada a cambio/);
    // The automated-message footer with STOP / BAJA, like every automatic message.
    expect(renderTemplate(STATUS_TEMPLATES.review_request, "en", ["Rosa", "x"])).toMatch(/Reply STOP/);
  });

  it("every piece of review copy on the screens passes too", () => {
    for (const locale of ["en", "es"] as const) {
      const c = REVIEW_COPY[locale];
      for (const text of [c.pageTitle, c.pageIntro, c.noIncentive, c.talkTitle, c.talkBody, c.pulseHappy, c.pulseUnhappy, c.pulseUnhappyLinks, c.staffNote, c.leave("Google")]) {
        expect(reviewCopyProblems(text), text).toEqual([]);
      }
    }
  });

  it("catches incentive and gating language", () => {
    expect(reviewCopyProblems("Leave a review and get a $10 gift card")).toEqual(expect.arrayContaining([expect.stringMatching(/^incentive:/)]));
    expect(reviewCopyProblems("Deja tu reseña y entra al sorteo")).toEqual(expect.arrayContaining([expect.stringMatching(/^incentive:/)]));
    expect(reviewCopyProblems("If you're happy with us, leave a 5-star review")).toEqual(expect.arrayContaining([expect.stringMatching(/^gating:/)]));
    expect(reviewCopyProblems("Si estás contento, déjanos 5 estrellas")).toEqual(expect.arrayContaining([expect.stringMatching(/^gating:/)]));
    expect(reviewCopyProblems("Tell others we remove negative items")).toEqual(expect.arrayContaining([expect.stringMatching(/^claim:/)]));
  });

  it("the agreement has no clause that limits reviews (Consumer Review Fairness Act)", () => {
    for (const locale of ["en", "es"] as const) {
      const text = JSON.stringify(agreementDocuments(locale, resolveTerms({})));
      expect(text).not.toMatch(/disparag|defam|difam|rese[nñ]a|online review|public review|reviews? (of|about) (us|our|the company)|no publicar|not to post|not post/i);
    }
  });
});

describe("reviews: sites and numbers", () => {
  it("a link must be https on the platform's own host", () => {
    expect(platformUrlProblem("google", "https://g.page/r/abc/review")).toBeNull();
    expect(platformUrlProblem("google", "https://search.google.com/local/writereview?placeid=x")).toBeNull();
    expect(platformUrlProblem("trustpilot", "https://www.trustpilot.com/evaluate/credalti.com")).toBeNull();
    expect(platformUrlProblem("bbb", "https://www.bbb.org/us/tx/houston/profile/x")).toBeNull();
    expect(platformUrlProblem("google", "http://g.page/r/abc")).toBe("not_https");
    expect(platformUrlProblem("trustpilot", "https://trustpilot.com.evil.example/x")).toBe("wrong_host");
    expect(platformUrlProblem("bbb", "https://example.com/bbb.org")).toBe("wrong_host");
    expect(platformUrlProblem("bbb", "not a url")).toBe("not_a_url");
  });

  it("every enabled site with a link, always in the same order", () => {
    const mixed: ReviewPlatform[] = [
      { ...DEMO_PLATFORMS[2]! },
      { ...DEMO_PLATFORMS[0]!, enabled: false },
      { ...DEMO_PLATFORMS[1]! },
    ];
    expect(livePlatforms(mixed).map((p) => p.key)).toEqual(["trustpilot", "bbb"]);
  });

  it("the dashboard number: the ratings weighted by review count", () => {
    const r = overallRating(DEMO_PLATFORMS);
    // (4.8 × 212 + 4.6 × 87) / 299 = 4.74
    expect(r).toEqual({ rating: 4.74, reviews: 299, platforms: 2 });
    expect(overallRating(EMPTY_PLATFORMS).rating).toBeNull();
  });

  it("counts the asks by milestone and channel", () => {
    const s = reviewRequestSummary(
      [
        { userId: "a", milestone: "first_results", channel: "whatsapp_or_email", at: "2026-11-20T00:00:00Z" },
        { userId: "b", milestone: "pulse_answered", channel: "in_app", at: "2026-09-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(s).toMatchObject({ total: 2, last30Days: 1, byChannel: { whatsapp_or_email: 1, in_app: 1 } });
    expect(s.byMilestone.first_results).toBe(1);
  });
});

describe("reviews: AltiBot's reply drafts", () => {
  const input = { review: "They never answered my calls and my Equifax letter was wrong.", stars: 1, reviewerName: "Rosa Martínez", platform: "google", locale: "en" as const };

  it("refuses private details, promises and asking to take the review down", () => {
    expect(replyProblems("Hi Rosa, we checked your case and your round 2 letters to Equifax went out on 11/03.")).toEqual(
      expect.arrayContaining([expect.stringMatching(/^private:/)]),
    );
    expect(replyProblems("We'll refund your last payment.")).toEqual(expect.arrayContaining([expect.stringMatching(/^promise:/)]));
    expect(replyProblems("Please remove your review once we talk.")).toEqual(expect.arrayContaining([expect.stringMatching(/^suppression:/)]));
    expect(replyProblems("Esto es difamación; nuestro abogado te contactará.")).toEqual(expect.arrayContaining([expect.stringMatching(/^suppression:/)]));
    expect(replyProblems("We remove negative items for you.")).toEqual(expect.arrayContaining([expect.stringMatching(/^claim:/)]));
  });

  it("the safe fallback passes every rule, in both languages, and uses only a first name", () => {
    for (const locale of ["en", "es"] as const) {
      for (const stars of [1, 3, 5]) {
        const reply = fallbackReply({ stars, name: "Rosa Martínez", locale });
        expect(replyProblems(reply), reply).toEqual([]);
        expect(reply).not.toMatch(/Martínez/);
      }
    }
  });

  it("without a model: the fallback, said so", async () => {
    const out = await draftReviewReply(input, null);
    expect(out).toMatchObject({ source: "fallback", reason: "not_configured" });
    expect(replyProblems(out.draft)).toEqual([]);
  });

  it("a draft that breaks a rule is written again once with the reasons; then the fallback", async () => {
    const seen: string[] = [];
    const bad = async (call: { user: string }) => {
      seen.push(call.user);
      return { reply: "Hi Rosa, your Equifax letter in round 1 went out fine. We'll refund you.", problem: null };
    };
    const out = await draftReviewReply(input, bad);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/no se puede publicar por/);
    expect(out.source).toBe("fallback");
    expect(out.reason).toBe("failed_checks");

    let n = 0;
    const fixes = async () => ({ reply: n++ === 0 ? "We will refund you." : "Hi Rosa, thank you for writing. We read it carefully. Please reach us through the contact details on our website and a person on our team will help.", problem: null });
    const ok = await draftReviewReply(input, fixes);
    expect(ok.source).toBe("model");
    expect(replyProblems(ok.draft)).toEqual([]);
  });
});
