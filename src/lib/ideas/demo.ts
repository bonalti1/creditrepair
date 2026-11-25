import { formatSignal, type SignalUnit } from "./signals";
import type { AltiRun, BasedOn, Idea, IdeaProposal } from "./types";

// The demo's ideas board (no database): made-up ideas by the demo team, in
// every status, and Alti's SAMPLE proposals with sample numbers. Kept in this
// browser; the screen labels all of it as sample data. Nothing here calls a
// model.

const KEY = "credalti.demo.ideas.v1";
const DAY = 86_400_000;

export interface DemoIdeasState {
  ideas: Idea[];
  proposals: IdeaProposal[];
  runs: AltiRun[];
}

const at = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString();
const n = (key: string, value: number, unit: SignalUnit): BasedOn => ({ key, value, unit, display: formatSignal(value, unit) });

function idea(now: Date, partial: Partial<Idea> & Pick<Idea, "id" | "title" | "why" | "department" | "metric" | "expectedEffect" | "effort" | "status">, createdDaysAgo: number, by: [string, string]): Idea {
  return {
    source: "team",
    proposalId: null,
    createdBy: by[0],
    createdByName: by[1],
    createdAt: at(now, createdDaysAgo),
    updatedAt: at(now, Math.max(0, createdDaysAgo - 2)),
    approvedByName: null,
    approvedAt: null,
    testDays: null,
    testStartedAt: null,
    testEndsAt: null,
    decidedByName: null,
    decidedAt: null,
    resultNote: null,
    ...partial,
  };
}

const CARMEN: [string, string] = ["carmen", "Carmen Ruiz"];
const MARTA: [string, string] = ["marta", "Marta Leal"];
const ANA: [string, string] = ["ana", "Ana Prieto"];
const LUIS: [string, string] = ["luis", "Luis Ortega"];

export function seedDemoIdeas(now: Date): DemoIdeasState {
  const ideas: Idea[] = [
    idea(now, { id: "i-01", title: "Answer new WhatsApp leads within 15 minutes during business hours", why: "Leads who wait more than an hour rarely answer back. A shared rota for the first reply would cover lunch and the late afternoon.", department: "leads", metric: "lead_first_reply", expectedEffect: "The median first reply goes down", effort: "S", status: "new" }, 3, ANA),
    idea(now, { id: "i-02", title: "Send the documents checklist the same day the agreement is signed", why: "Clients who upload their ID late push the first round back. One clear message right after signing, with the app link, could help.", department: "clients", metric: "days_to_first_round", expectedEffect: "Fewer days from signing to the first round", effort: "S", status: "new" }, 1, MARTA),
    idea(now, { id: "i-03", title: "Offer bank debit (ACH) first on the payment step", why: "Card fees are higher and cards expire. Showing bank debit first, with the card one tap away, may lower failed payments.", department: "money", metric: "ach_share", expectedEffect: "A bigger share paid by bank debit", effort: "M", status: "approved", approvedByName: "Carmen Ruiz", approvedAt: at(now, 4) }, 9, CARMEN),
    idea(now, { id: "i-04", title: "Weekly short video answering one real client question", why: "Questions in the chat repeat. A short weekly video in English and Spanish could answer them before people ask.", department: "content", metric: "content_posted_week", expectedEffect: "More posts each week, steadily", effort: "M", status: "testing", approvedByName: "Carmen Ruiz", approvedAt: at(now, 12), testDays: 21, testStartedAt: at(now, 10), testEndsAt: at(now, -11) }, 15, LUIS),
    idea(now, { id: "i-05", title: "Call-free follow-up: a second WhatsApp message on day two", why: "Many leads read the first message and go quiet. A friendly second message with the approved template, no pressure, may bring some back.", department: "leads", metric: "lead_contacted_rate", expectedEffect: "More leads contacted", effort: "S", status: "testing", approvedByName: "Carmen Ruiz", approvedAt: at(now, 30), testDays: 14, testStartedAt: at(now, 16), testEndsAt: at(now, 2) }, 33, ANA),
    idea(now, { id: "i-06", title: "Print and mail rounds twice a week instead of daily", why: "Batching the print run saves a person's time and envelopes without making clients wait much longer.", department: "letters", metric: "human_minutes_per_active", expectedEffect: "Fewer minutes of a person's time per client", effort: "S", status: "kept", approvedByName: "Carmen Ruiz", approvedAt: at(now, 70), testDays: 28, testStartedAt: at(now, 66), testEndsAt: at(now, 38), decidedByName: "Carmen Ruiz", decidedAt: at(now, 36), resultNote: "Kept. Minutes per active client went down and no round went out late. Tuesdays and Fridays work best for the mail pickup." }, 75, MARTA),
    idea(now, { id: "i-07", title: "Payment reminder by email the day before a charge", why: "Some declines happen because the client forgot the date. A plain reminder by email (never SMS) gives them time to update the card.", department: "money", metric: "failed_payments", expectedEffect: "Fewer failed payments", effort: "S", status: "kept", approvedByName: "Carmen Ruiz", approvedAt: at(now, 55), testDays: 30, testStartedAt: at(now, 52), testEndsAt: at(now, 22), decidedByName: "Carmen Ruiz", decidedAt: at(now, 20), resultNote: "Kept. Failed payments went down over the month; clients said the reminder helped. Keep the wording factual, no amounts in the subject line." }, 60, CARMEN),
    idea(now, { id: "i-08", title: "Partner newsletter every Monday", why: "Partners forget to refer when they don't hear from us. A short Monday update could keep Credalti in mind.", department: "partners", metric: "partner_referrals_week", expectedEffect: "More partner referrals each week", effort: "M", status: "dropped", approvedByName: "Carmen Ruiz", approvedAt: at(now, 90), testDays: 28, testStartedAt: at(now, 85), testEndsAt: at(now, 57), decidedByName: "Carmen Ruiz", decidedAt: at(now, 55), resultNote: "Dropped. Referrals did not move and two partners asked for less email. The milestone notices they already get are enough." }, 95, LUIS),
    idea(now, { id: "i-09", title: "A countdown banner on the signup page", why: "Someone suggested adding urgency to the signup page.", department: "content", metric: "conversion", expectedEffect: "More signups", effort: "S", status: "declined", decidedByName: "Carmen Ruiz", decidedAt: at(now, 6), resultNote: "Not now: no pressure tactics. The house rules say nobody is pushed to sign." }, 8, ANA),
  ];
  const runs: AltiRun[] = [{ id: "r-01", createdAt: at(now, 2), trigger: "cron", byName: "", status: "ok", proposed: 3, dropped: 1 }];
  const proposals: IdeaProposal[] = SAMPLE_PROPOSALS.slice(0, 3).map((p, i) => ({ ...p, id: `p-0${i + 1}`, runId: "r-01", status: "open", ideaId: null, createdAt: at(now, 2) }));
  return { ideas, proposals, runs };
}

type SampleProposal = Omit<IdeaProposal, "id" | "runId" | "status" | "ideaId" | "createdAt">;

/** Alti's sample proposals in the demo: realistic words, sample numbers, the same shape as the real ones. */
export const SAMPLE_PROPOSALS: readonly SampleProposal[] = [
  {
    title: "Reply to every waiting lead before the end of the day",
    why: "Most leads reach a person, but the first reply often comes hours later. Covering the afternoon gap with a second person on the inbox may lift how many leads are contacted.",
    department: "leads",
    metric: "lead_first_reply",
    expectedEffect: "The median first reply goes down, and contacted goes up",
    effort: "S",
    testDays: 14,
    basedOn: [n("lead_first_reply", 185, "minutes"), n("lead_contacted_rate", 0.62, "percent"), n("leads_week", 23, "count")],
  },
  {
    title: "Remind signed clients to upload their ID on day one",
    why: "The time from signing to the first round is longer than the review window needs. Most of the wait is missing documents, which a same-day reminder by WhatsApp or email could shorten.",
    department: "clients",
    metric: "days_to_first_round",
    expectedEffect: "Fewer days from signing to the first round",
    effort: "S",
    testDays: 21,
    basedOn: [n("days_to_first_round", 9.4, "days"), n("signed", 11, "count")],
  },
  {
    title: "Ask clients with a failed card to switch to bank debit",
    why: "Failed payments are the biggest money notice, and only a small share pays by bank debit. A plain note offering bank debit when a card fails may recover more payments.",
    department: "money",
    metric: "recovered_payments",
    expectedEffect: "More payments recovered after a decline",
    effort: "M",
    testDays: 30,
    basedOn: [n("failed_payments", 6, "count"), n("recovered_payments", 2, "count"), n("ach_share", 0.18, "percent")],
  },
  {
    title: "Turn the most asked client question into a short weekly post",
    why: "Posting is uneven week to week while the same questions come in. One planned answer post a week keeps the calendar steady and saves the team from typing it again.",
    department: "content",
    metric: "content_posted_week",
    expectedEffect: "Posts each week become steady",
    effort: "M",
    testDays: 28,
    basedOn: [n("content_posted_week", 1, "count"), n("content_scheduled_week", 2, "count")],
  },
  {
    title: "Check in with active clients at the halfway point of a round",
    why: "Cancellations cluster while clients wait on the bureaus. A short factual update halfway through the wait, by the channel they chose, may keep them informed.",
    department: "support",
    metric: "cancelled",
    expectedEffect: "Fewer cancellations",
    effort: "S",
    testDays: 45,
    basedOn: [n("cancelled", 3, "count"), n("active_clients", 42, "count"), n("churn", 0.07, "percent")],
  },
];

export function readDemoIdeas(now: Date): DemoIdeasState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoIdeasState;
  } catch {
    // Fall back to the example.
  }
  return seedDemoIdeas(now);
}

export function writeDemoIdeas(state: DemoIdeasState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // This visit only.
  }
}

export function resetDemoIdeas(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
