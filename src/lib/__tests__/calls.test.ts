import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChannelAvailability } from "@/lib/autopilot/types";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { CALL_CONSENT, callConsentHash, callsEnabled, QUESTIONS_ONLY, STAFF_CALL_RULES, usPhone } from "@/lib/calls/config";
import { demoWindows } from "@/lib/calls/demo";
import { CALL_TEMPLATES, callDedupeKey, planCallMessages, renderCallMessage, type BookingForMessages, type CallMessageContext } from "@/lib/calls/messages";
import { callQueue, type CallBooking } from "@/lib/calls/queue";
import { openSlots, slotProblem, slotsByDay, slotTime, windowFromRequest, zonedToUtc, zoneLabel, type CallWindow } from "@/lib/calls/slots";
import { longSentences } from "@/lib/ux/plainLanguage";

// Calls with a person (docs/SIGNUP-CHAT.md): off by default; slots from the
// team's hours on the person's clock; TCPA consent; questions only, said
// everywhere; confirmations and reminders by WhatsApp or email only, under
// opt-out, quiet hours and dedupe; the staff queue with the case reference.

const H = 3_600_000;
const NOW = new Date("2026-12-01T15:00:00Z"); // Tuesday 9:00 a.m. in Texas (CST)
const WINDOW: CallWindow = { id: "w1", startsAt: "2026-12-02T16:00:00Z", endsAt: "2026-12-02T18:00:00Z", slotMinutes: 20, timeZone: "America/Chicago", createdByName: "Ana", removedAt: null };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const code = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CALLS_ENABLED;
});

describe("calls: off by default", () => {
  it("is on only when the owner sets the flag", () => {
    expect(callsEnabled(undefined)).toBe(false);
    expect(callsEnabled("")).toBe(false);
    expect(callsEnabled("0")).toBe(false);
    expect(callsEnabled("yes")).toBe(false);
    expect(callsEnabled("1")).toBe(true);
    expect(callsEnabled("true")).toBe(true);
    expect(callsEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_CALLS_ENABLED = "1";
    expect(callsEnabled()).toBe(true);
  });

  it("every way in checks the flag", () => {
    for (const file of ["src/app/api/calls/route.ts", "src/app/api/staff/calls/route.ts", "src/app/registro/llamada/page.tsx", "src/app/equipo/llamadas/page.tsx", "src/lib/staff/nav.ts", "src/lib/calls/useCalls.ts", "src/app/registro/page.tsx", "src/app/api/cron/autopilot/route.ts"]) {
      expect(code(file), file).toMatch(/callsEnabled\(\)/);
    }
    // .env.example documents it, off.
    expect(readFileSync(".env.example", "utf8")).toMatch(/^NEXT_PUBLIC_CALLS_ENABLED=$/m);
  });
});

describe("calls: slots from the team's hours", () => {
  it("cuts a window into slots, minus what is booked, from an hour from now", () => {
    const slots = openSlots([WINDOW], ["2026-12-02T16:20:00Z"], NOW);
    expect(slots.map((s) => s.start)).toEqual(["2026-12-02T16:00:00.000Z", "2026-12-02T16:40:00.000Z", "2026-12-02T17:00:00.000Z", "2026-12-02T17:20:00.000Z", "2026-12-02T17:40:00.000Z"]);
    expect(slots[0]!.end).toBe("2026-12-02T16:20:00.000Z");
    // Too soon: a slot starting within the hour is not offered.
    expect(openSlots([WINDOW], [], new Date("2026-12-02T15:30:00Z"))[0]!.start).toBe("2026-12-02T16:40:00.000Z");
    // A removed window offers nothing; two windows over the same time offer it once.
    expect(openSlots([{ ...WINDOW, removedAt: "2026-12-01T10:00:00Z" }], [], NOW)).toEqual([]);
    expect(openSlots([WINDOW, { ...WINDOW, id: "w2" }], [], NOW)).toHaveLength(6);
  });

  it("checks a requested slot like the database does", () => {
    expect(slotProblem({ windowId: "w1", start: "2026-12-02T16:40:00Z" }, [WINDOW], [], NOW)).toBeNull();
    expect(slotProblem({ windowId: "w9", start: "2026-12-02T16:40:00Z" }, [WINDOW], [], NOW)).toBe("unknown_window");
    expect(slotProblem({ windowId: "w1", start: "2026-12-02T16:45:00Z" }, [WINDOW], [], NOW)).toBe("not_a_slot");
    expect(slotProblem({ windowId: "w1", start: "2026-12-02T17:40:00Z" }, [WINDOW], [], NOW)).toBeNull();
    expect(slotProblem({ windowId: "w1", start: "2026-12-02T18:00:00Z" }, [WINDOW], [], NOW)).toBe("not_a_slot");
    expect(slotProblem({ windowId: "w1", start: "2026-12-02T16:40:00Z" }, [WINDOW], ["2026-12-02T16:40:00.000Z"], NOW)).toBe("taken");
    expect(slotProblem({ windowId: "w1", start: "2026-12-02T16:00:00Z" }, [WINDOW], [], new Date("2026-12-02T15:30:00Z"))).toBe("too_soon");
  });

  it("turns the team's wall clock into UTC, on both sides of daylight saving", () => {
    expect(zonedToUtc("2026-12-02", "10:00", "America/Chicago")!.toISOString()).toBe("2026-12-02T16:00:00.000Z");
    expect(zonedToUtc("2026-07-15", "10:00", "America/Chicago")!.toISOString()).toBe("2026-07-15T15:00:00.000Z");
    expect(zonedToUtc("2026-12-02", "10:00", "America/New_York")!.toISOString()).toBe("2026-12-02T15:00:00.000Z");
    expect(zonedToUtc("2026-13-02", "10:00", "America/Chicago")).toBeNull();
    expect(windowFromRequest({ day: "2026-12-02", from: "10:00", to: "12:00", slotMinutes: 20, timeZone: "America/Chicago" }, NOW)).toEqual({ ok: true, startsAt: WINDOW.startsAt.replace("Z", ".000Z"), endsAt: WINDOW.endsAt.replace("Z", ".000Z") });
    const bad = windowFromRequest({ day: "2026-11-30", from: "12:00", to: "10:00", slotMinutes: 25, timeZone: "America/Chicago" }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toEqual(expect.arrayContaining(["slot_length", "end_before_start", "in_the_past"]));
    const long = windowFromRequest({ day: "2026-12-02", from: "06:00", to: "20:00", slotMinutes: 30, timeZone: "America/Chicago" }, NOW);
    expect(long.ok === false && long.problems).toEqual(["too_long"]);
  });

  it("shows times on the person's clock, Texas by default", () => {
    expect(slotTime(WINDOW.startsAt, "America/Chicago", "en")).toBe("10:00 AM");
    expect(slotTime(WINDOW.startsAt, "America/New_York", "en")).toBe("11:00 AM");
    expect(zoneLabel(WINDOW.startsAt, "America/Chicago", "en")).toBe("CST");
    expect(zoneLabel(WINDOW.startsAt, "America/Chicago", "es")).toBe("hora del centro");
    // A late slot in Texas is the next day nowhere in the US, but grouping follows the clock shown.
    expect(slotsByDay(openSlots([WINDOW], [], NOW), "America/Chicago").map((d) => d.day)).toEqual(["2026-12-02"]);
    // The demo offers weekdays only.
    for (const w of demoWindows(NOW)) expect([1, 2, 3, 4, 5]).toContain(new Date(w.startsAt).getUTCDay());
  });
});

describe("calls: consent and the rule", () => {
  it("asks for express consent to be called at that number, not as a condition", () => {
    expect(CALL_CONSENT.en).toMatch(/call me at this number/);
    expect(CALL_CONSENT.en).toMatch(/not a condition of buying anything/);
    expect(CALL_CONSENT.es).toMatch(/No es una condición para comprar nada/);
    expect(callConsentHash("en")).toMatch(/^[0-9a-f]{64}$/);
    expect(callConsentHash("en")).not.toBe(callConsentHash("es"));
    expect(callConsentHash("en")).toBe(callConsentHash("en"));
    const page = code("src/components/signup/CallBooking.tsx");
    // Its own box, never pre-ticked.
    expect(page).toMatch(/useState\(false\);\n[\s\S]*data-testid="call-consent"/);
    expect(page).not.toMatch(/defaultChecked/);
  });

  it("says the call is for questions only, on the booking page, in the messages and to the team", () => {
    expect(QUESTIONS_ONLY.en.body).toMatch(/Signing up and any payment happen afterwards, in writing, in the app\. Never on the call\./);
    expect(QUESTIONS_ONLY.es.body).toMatch(/El registro y cualquier pago se hacen después, por escrito, en la app\. Nunca en la llamada\./);
    expect(STAFF_CALL_RULES.en.join(" ")).toMatch(/310\.4\(a\)\(2\)[\s\S]*310\.6\(b\)\(5\)/);
    expect(STAFF_CALL_RULES.es.join(" ")).toMatch(/310\.4\(a\)\(2\)[\s\S]*310\.6\(b\)\(5\)/);
    expect(code("src/components/signup/CallBooking.tsx")).toMatch(/data-testid="questions-only"/);
    expect(code("src/components/staff/CallsScreen.tsx")).toMatch(/STAFF_CALL_RULES\[locale\]/);
    for (const locale of ["en", "es"] as const) {
      for (const kind of ["confirmation", "reminder"] as const) expect(CALL_TEMPLATES[kind].body[locale]).toContain(QUESTIONS_ONLY[locale].short);
    }
    // The attorney's question is on record.
    const sales = readFileSync("docs/SALES-FLOW.md", "utf8");
    const questions = sales.slice(sales.indexOf("## Open questions for the attorney"));
    expect(questions).toMatch(/310\.4\(a\)\(2\)/);
    expect(questions).toMatch(/310\.6\(b\)\(5\)/);
  });

  it("every word a person reads passes the claim rules", () => {
    const lines = [
      CALL_CONSENT.en,
      CALL_CONSENT.es,
      ...Object.values(QUESTIONS_ONLY.en).filter((v) => typeof v === "string"),
      ...Object.values(QUESTIONS_ONLY.es).filter((v) => typeof v === "string"),
      ...(["en", "es"] as const).flatMap((l) => [renderCallMessage("confirmation", l, ["Rosa", "Wednesday, December 2", "10:00 AM (CST)", "CR-7KQ4M"]), renderCallMessage("reminder", l, ["Rosa", "10:00 AM (CST)", "CR-7KQ4M"])]),
    ];
    for (const line of lines) {
      expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
      expect(line, line).not.toMatch(/\bfree\b|gratis/i);
    }
    expect(longSentences(lines.map((l) => l.split("\n\n")[0]!)).map((s) => s.sentence)).toEqual([]);
  });

  it("takes US numbers only", () => {
    expect(usPhone("(713) 555-1234")).toBe("+17135551234");
    expect(usPhone("+1 713 555 1234")).toBe("+17135551234");
    expect(usPhone("555-1234")).toBeNull();
    expect(usPhone("(013) 555-1234")).toBeNull();
  });
});

describe("calls: confirmation and reminder", () => {
  const booking = (over: Partial<BookingForMessages> = {}): BookingForMessages => ({
    id: "b1",
    firstName: "Rosa",
    phone: "+17135550142",
    email: null,
    userId: null,
    confirmChannel: "whatsapp",
    locale: "es",
    timeZone: "America/Chicago",
    slotStart: "2026-12-02T17:00:00Z",
    createdAt: NOW.toISOString(),
    caseRef: "CR-7KQ4M",
    status: "booked",
    ...over,
  });
  const WA: ChannelAvailability = { whatsapp: true, email: true, approvedTemplates: ["credalti_llamada_confirmada", "credalti_llamada_recordatorio"], simulated: false };
  const ctx = (over: Partial<CallMessageContext> = {}): CallMessageContext => ({ quiet: { quietStartHour: 21, quietEndHour: 8 }, optedOut: false, written: new Set(), channels: WA, ...over });

  it("confirms at once on WhatsApp, with the case number, the time on the person's clock and the rule", () => {
    const [m, ...rest] = planCallMessages(booking(), NOW, ctx());
    expect(rest).toEqual([]);
    expect(m!.kind).toBe("confirmation");
    expect(m!.channel).toBe("whatsapp");
    expect(m!.mode).toBe("template");
    expect(m!.dedupeKey).toBe(callDedupeKey("b1", "confirmation"));
    expect(m!.body).toContain("CR-7KQ4M");
    expect(m!.body).toMatch(/miércoles, 2 de diciembre a las 11:00 a\.\s?m\. \(hora del centro\)/);
    expect(m!.body).toContain(QUESTIONS_ONLY.es.short);
    expect(m!.body).toMatch(/responde BAJA/);
  });

  it("sends each message once, the reminder three hours before, and nothing after the call", () => {
    const written = new Set([callDedupeKey("b1", "confirmation")]);
    expect(planCallMessages(booking(), NOW, ctx({ written }))).toEqual([]);
    const before = new Date("2026-12-02T14:00:00Z"); // 8:00 a.m. Texas, 3 h before
    const [r] = planCallMessages(booking(), before, ctx({ written }));
    expect(r!.kind).toBe("reminder");
    expect(planCallMessages(booking(), before, ctx({ written: new Set([...written, callDedupeKey("b1", "reminder")]) }))).toEqual([]);
    expect(planCallMessages(booking(), new Date("2026-12-02T17:05:00Z"), ctx())).toEqual([]);
    expect(planCallMessages(booking({ status: "cancelled" }), NOW, ctx())).toEqual([]);
    // No reminder before the confirmation went.
    expect(planCallMessages(booking(), before, ctx()).map((m) => m.kind)).toEqual(["confirmation"]);
  });

  it("respects an opt-out and quiet hours on the person's clock", () => {
    expect(planCallMessages(booking(), NOW, ctx({ optedOut: true }))).toEqual([]);
    const night = new Date("2026-12-02T04:00:00Z"); // 10:00 p.m. Texas
    expect(planCallMessages(booking({ createdAt: night.toISOString() }), night, ctx())).toEqual([]);
    // In the morning it goes.
    expect(planCallMessages(booking({ createdAt: night.toISOString() }), new Date("2026-12-02T14:05:00Z"), ctx())[0]!.kind).toBe("confirmation");
    // A reminder that would land in quiet hours right before an early call is skipped.
    const early = booking({ slotStart: "2026-12-02T14:20:00Z" }); // 8:20 a.m.
    expect(planCallMessages(early, new Date("2026-12-02T14:00:00Z"), ctx({ written: new Set([callDedupeKey("b1", "confirmation")]) }))).toEqual([]);
  });

  it("goes by WhatsApp or email only, never SMS, and email needs an account", () => {
    expect(planCallMessages(booking({ confirmChannel: "email", email: "rosa@example.com" }), NOW, ctx())[0]!.channel).toBe("whatsapp");
    expect(planCallMessages(booking({ confirmChannel: "email", email: "rosa@example.com", userId: "u1" }), NOW, ctx())[0]!.channel).toBe("email");
    // WhatsApp outside the 24-hour window needs the approved template; without it and without email, nothing goes.
    expect(planCallMessages(booking(), NOW, ctx({ channels: { ...WA, approvedTemplates: [], email: false } }))).toEqual([]);
    expect(planCallMessages(booking({ lastInboundAt: NOW.toISOString() }), NOW, ctx({ channels: { ...WA, approvedTemplates: [] } }))[0]!.mode).toBe("text");
    const sources = [...files("src/lib/calls"), "src/app/api/calls/route.ts", "src/app/api/staff/calls/route.ts"];
    for (const file of sources) expect(code(file), file).not.toMatch(/twilio|sendSms|"sms"|sms:/i);
    const sql = readFileSync("supabase/migrations/0032_calls.sql", "utf8");
    expect(sql).toMatch(/confirm_channel text not null check \(confirm_channel in \('whatsapp', 'email'\)\)/);
    expect(sql).toMatch(/channel text not null check \(channel in \('whatsapp', 'email'\)\)/);
    for (const t of Object.values(CALL_TEMPLATES)) expect(t.name).toMatch(/^[a-z0-9_]{1,512}$/);
  });
});

describe("calls: the team's queue", () => {
  const b = (over: Partial<CallBooking>): CallBooking => ({
    id: "b1",
    windowId: "w1",
    slotStart: "2026-12-02T17:00:00.000Z",
    slotEnd: "2026-12-02T17:20:00.000Z",
    caseRef: "CR-7KQ4M",
    userId: null,
    firstName: "Rosa",
    phone: "+17135550142",
    email: null,
    confirmChannel: "whatsapp",
    locale: "es",
    timeZone: "America/Chicago",
    state: "TX",
    question: "¿Cuánto tarda?",
    status: "booked",
    createdAt: NOW.toISOString(),
    closedAt: null,
    closedByName: null,
    staffNote: null,
    messages: [{ kind: "confirmation", channel: "whatsapp", status: "sent", sentAt: NOW.toISOString() }],
    ...over,
  });

  it("lists booked calls soonest first, with the case reference, the rule and a call button", () => {
    const items = callQueue([b({ id: "b2", slotStart: "2026-12-03T17:00:00.000Z", caseRef: null, firstName: "Luis" }), b({}), b({ id: "b3", status: "completed" })], NOW, "en");
    expect(items.map((i) => i.booking.id)).toEqual(["b1", "b2"]);
    expect(items[0]!.title).toBe("Call Rosa · CR-7KQ4M");
    expect(items[0]!.when).toBe("Wednesday, December 2, 11:00 AM (CST)");
    expect(items[0]!.tried).toBe("Confirmation by WhatsApp.");
    expect(items[0]!.rule).toMatch(/^Questions only\. Do not sign anyone up, ask for payment details or quote a price on the call\.$/);
    expect(items[0]!.action).toEqual({ kind: "call", href: "tel:+17135550142", label: "Call" });
    expect(items[1]!.tried).toBe("Confirmation by WhatsApp.");
    expect(callQueue([b({})], NOW, "es")[0]!.title).toBe("Llamar a Rosa · CR-7KQ4M");
  });

  it("keeps a past call a while, to be closed, then drops it", () => {
    expect(callQueue([b({})], new Date("2026-12-02T18:00:00Z"))[0]!.overdue).toBe(true);
    expect(callQueue([b({})], new Date("2026-12-03T06:00:00Z"))).toEqual([]);
    // Shown on the person's clock too when it differs from Texas.
    expect(callQueue([b({ timeZone: "America/New_York" })], NOW, "en")[0]!.when).toMatch(/their time 12:00 PM \(EST\)/);
  });

  it("appears on the team's home only when calls are on", () => {
    const home = code("src/app/equipo/page.tsx");
    expect(home).toMatch(/<HomeCalls allowed=\{can\("calls\.manage"\)\} now=\{now\} \/>/);
    expect(code("src/components/staff/CallsQueue.tsx")).toMatch(/if \(!calls\.enabled \|\| !allowed \|\| !calls\.ready\) return null;/);
  });
});
