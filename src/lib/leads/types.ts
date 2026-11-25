// The lead inbox's records (migration 0034), as the console reads them. One
// lead per prospect conversation, keyed by the phone. Pure types, shared by
// the server (inboxServer.ts), the demo (demo.ts) and the screens.

/** Where a lead first came from. First touch wins: never overwritten. */
export const LEAD_SOURCES = ["whatsapp", "highlevel", "partner", "signup_chat", "manual", "household"] as const;
export type LeadSourceKind = (typeof LEAD_SOURCES)[number];

/** The stages a PERSON may put a lead in. */
export const PERSON_STAGES = ["new", "contacted", "qualified", "not_interested", "closed_lost", "archived"] as const;
export type PersonStage = (typeof PERSON_STAGES)[number];

/**
 * The pipeline as the console shows it: New → Contacted → Qualified → Invited
 * → Signed, plus Not interested, Closed-lost and Archived. "Invited" and
 * "Signed" are never chosen: they are facts (the invitation went out, the
 * agreement was signed).
 */
export const PIPELINE = ["new", "contacted", "qualified", "invited", "signed", "not_interested", "closed_lost", "archived"] as const;
export type LeadStage = (typeof PIPELINE)[number];

export interface LeadFirstTouch {
  channel?: string;
  campaign?: string | null;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string } | null;
  partnerId?: string | null;
  partnerName?: string | null;
  partnerCode?: string | null;
  /** The chat signup's case reference ("CR-7KQ4M"). */
  caseRef?: string | null;
}

export interface Lead {
  id: string;
  phone: string;
  /** As the lead gave it (a form, a partner, sales); null for a number that only wrote on WhatsApp. */
  name: string | null;
  /** The language to write to them in: saved, else the language they wrote in. Null when unknown (English is used). */
  locale: "en" | "es" | null;
  source: LeadSourceKind;
  firstTouch: LeadFirstTouch;
  prospectId: string | null;
  /** The salesperson's handle; null: nobody yet. */
  salesperson: string | null;
  assignedAt: string | null;
  /** The stage a person chose. */
  stage: PersonStage;
  stageAt: string | null;
  invitedAt: string | null;
  signedAt: string | null;
  clientUserId: string | null;
  lastInboundAt: string | null;
  /** The last answer by a person or the AI after an inbound message. */
  lastReplyAt: string | null;
  lastHumanAt: string | null;
  firstHumanReplyAt: string | null;
  lastMessage: { at: string; role: "user" | "assistant"; source: "journey" | "coach" | "human"; excerpt: string } | null;
  createdAt: string;
  /** The number said STOP (and not START since). */
  optedOutAt: string | null;
  /** HighLevel's contact, when the lead came from there. */
  highlevelContactId?: string | null;
  goal?: string | null;
  state?: string | null;
  /** The chat signup (/registro): where they are, and whether they asked for a person. */
  signup?: { caseRef: string; step: string; wantsPerson: boolean } | null;
  /** The newest automatic hand-off that no person has answered yet. */
  handoff?: { at: string; reason: HandoffReason } | null;
}

/** A message in the conversation. */
export interface LeadMessage {
  id: string;
  at: string;
  role: "user" | "assistant";
  /** journey: Alti's fixed greeting · coach: Alti (AI) · human: a teammate · highlevel: read from HighLevel, not ours. */
  source: "journey" | "coach" | "human" | "highlevel";
  authorName?: string | null;
  text: string;
}

export interface LeadNote {
  id: string;
  at: string;
  author: string;
  text: string;
}

export interface LeadStageEvent {
  id: string;
  at: string;
  from: PersonStage | null;
  to: PersonStage;
  by: string;
}

export type HandoffReason = "complaint" | "billing" | "legal" | "wants_person" | "results" | "personal_data" | "no_fact" | "guardrails";

export interface LeadAutoMessage {
  id: string;
  at: string;
  kind: "greeting" | "faq" | "signup_link" | "handoff";
  status: "claimed" | "sent" | "failed" | "handed_off";
  reason: string | null;
  body: string | null;
}

export interface LeadThread {
  lead: Lead;
  messages: LeadMessage[];
  notes: LeadNote[];
  stageEvents: LeadStageEvent[];
  autoMessages: LeadAutoMessage[];
  /** Messages read from HighLevel's Conversations API, when that provider is on. */
  external?: { provider: "highlevel"; ok: boolean; note?: string } | null;
}

/** The lead autopilot's switch and numbers (lead_autopilot_settings). Off by default. */
export interface LeadAutopilotSettings {
  enabled: boolean;
  replyDelaySeconds: number;
  perLeadDailyCap: number;
  dailyCap: number;
  quietStartHour: number;
  quietEndHour: number;
  sendSignupLink: boolean;
  enabledAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_LEAD_AUTOPILOT: LeadAutopilotSettings = {
  enabled: false,
  replyDelaySeconds: 120,
  perLeadDailyCap: 3,
  dailyCap: 40,
  quietStartHour: 21,
  quietEndHour: 8,
  sendSignupLink: true,
  enabledAt: null,
  updatedAt: null,
  updatedBy: null,
};

export const AUTOPILOT_LIMITS = {
  replyDelaySeconds: [30, 3600],
  perLeadDailyCap: [1, 10],
  dailyCap: [1, 500],
  hour: [0, 23],
} as const;
