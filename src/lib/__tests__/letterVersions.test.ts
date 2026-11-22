import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIMARY_BUREAUS } from "@/lib/domain/bureaus";
import type { ReportItem } from "@/lib/domain/types";
import { getLetterMeta, LETTER_CATALOGUE, ORIGINAL_TEMPLATE_KEYS } from "@/lib/letters/library";
import { buildLetterPacket, PACKET_DETAILS, renderSampleLetter, sampleLetterContext } from "@/lib/letters/packet";
import { renderLetter, TEMPLATES } from "@/lib/letters/templates";
import type { LetterContext } from "@/lib/letters/parts";
import { variationProblems } from "@/lib/letters/variation";
import { diffSources, diffStats, diffText, hasChanges } from "@/lib/letters/versions/diff";
import { buildPendingPacketMarkdown, pendingPacketEntries } from "@/lib/letters/versions/packet";
import { lettersBodySchema } from "@/lib/letters/versions/server";
import { allowedChips, builtinSource, chipsUsed, renderSource, requiredChips, type LetterSource } from "@/lib/letters/versions/source";
import { validateLetterSource } from "@/lib/letters/versions/validate";
import {
  builtinHash,
  contentHash,
  intact,
  lettersMayBeMailed,
  planDecision,
  planDiscard,
  planDraft,
  planSend,
  renderResolved,
  renderWithVersions,
  resolveLetter,
  type DecisionInput,
  type LetterVersion,
} from "@/lib/letters/versions/versions";
import { can, STAFF_ROLES } from "@/lib/staff/permissions";
import { staffLetterText } from "@/lib/staff/letters";
import type { StaffClient, StaffLetter, StaffRound } from "@/lib/staff/types";

// The letter editor's rules, without a database: version 1 read back from the
// templates exactly, the checks a new text must pass, the versions' life
// (draft → with the attorney → approved / rejected), which text is mailed, the
// readiness rule, the comparison, and the attorney's packet.

const KEYS = Object.keys(TEMPLATES);
const NOW = new Date("2026-11-22T15:00:00.000Z");
let next = 0;
const id = () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`;
const codes = (key: string, source: LetterSource) => validateLetterSource(key, source).errors.map((e) => e.code);
const warnings = (key: string, source: LetterSource) => validateLetterSource(key, source).warnings.map((e) => e.code);

const items: ReportItem[] = [
  { fingerprint: "fp-a", bureau: "equifax", category: "tradeline", name: "Northgate Bank", data: { accountNumberMasked: "****4821", status: "charged off" }, negative: true },
  { fingerprint: "fp-b", bureau: "equifax", category: "tradeline", name: "Summit Recovery", data: { date: "2025-01-02" }, negative: true },
];
const context = (overrides: Partial<LetterContext> = {}): LetterContext => ({
  user: { id: "u1", fullName: "María Fernanda López", addressLines: ["456 Calle Real", "Houston, TX 77002"], locale: "es" },
  target: PRIMARY_BUREAUS.equifax,
  items,
  date: "2026-07-02T12:00:00.000Z",
  roundNumber: 2,
  ...overrides,
});
const CONTEXTS: Array<[string, LetterContext]> = [
  ["bare", context()],
  ["details", context({ details: "The balance shown is $0 since March." })],
  ["enclosures", context({ enclosures: ["Copy of government-issued photo ID", "Proof of address (utility bill / bank statement)"] })],
  ["reasons", context({ itemReasons: { "fp-a": "not_mine", "fp-b": "other" } })],
  ["everything", context({ details: "My own words.", enclosures: ["Copy of government-issued photo ID"], itemReasons: { "fp-a": "wrong_balance" } })],
  ["one item", context({ items: [items[0]!], itemReasons: { "fp-a": "never_late" } })],
];

const decide = (decision: DecisionInput["decision"], extra: Partial<DecisionInput> = {}): DecisionInput => ({
  decision,
  attorneyName: "Lic. Laura Benítez",
  decidedOn: "2026-11-20",
  note: decision === "rejected" ? "Quiten la última frase." : "",
  confirmed: true,
  ...extra,
});

/** A letter taken through the whole flow: edited, sent, approved. */
function approvedEdit(key: string, edit: (body: string) => string): LetterVersion[] {
  const builtin = builtinSource(key);
  const draft = planDraft([], { templateKey: key, subject: builtin.subject, body: edit(builtin.body) }, "Carmen", NOW, id);
  if (!draft.ok) throw new Error(JSON.stringify(draft.problems));
  const sent = planSend([draft.value.version], key, "Carmen", NOW, id);
  if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
  const approved = planDecision([sent.value.version], sent.value.version.id, decide("approved"), "Carmen", NOW);
  if (!approved.ok) throw new Error(JSON.stringify(approved.problems));
  return [approved.value];
}

describe("version 1 is the letter in code, read back exactly", () => {
  it("covers every template in the library", () => {
    expect(KEYS.length).toBe(LETTER_CATALOGUE.length);
    for (const key of KEYS) expect(builtinSource(key).body.length).toBeGreaterThan(50);
  });

  it.each(KEYS)("%s: the text renders the same letter as the template, character for character", (key) => {
    const source = builtinSource(key);
    for (const [, ctx] of CONTEXTS) expect(renderSource(key, source, ctx)).toBe(renderLetter(key, ctx));
  });

  it.each(KEYS)("%s: passes every check, and keeps the client's parts as chips", (key) => {
    const source = builtinSource(key);
    expect(validateLetterSource(key, source)).toMatchObject({ ok: true, errors: [], warnings: [] });
    const meta = getLetterMeta(key)!;
    if (meta.appliesTo.length > 0) expect(requiredChips(key)).toContain("partidas");
    else expect(chipsUsed(source)).not.toContain("partidas");
    expect(source.body).not.toMatch(/Sincerely|To Whom It May Concern|⁣/);
  });

  it("marks the client's own words, and the fallback printed without them", () => {
    expect(builtinSource("bureau_not_my_account").body).toContain("The specifics are as follows: {detalles}");
    const statement = builtinSource("bureau_consumer_statement").body;
    expect(statement).toContain("My statement is: {detalles}");
    expect(statement).toContain("{sin_detalles} Please tell me how you would like to receive the wording of my statement");
    expect(builtinSource("bureau_wrong_balance").body).toContain("{frase_adjuntos}");
    expect(requiredChips("dispute_611_accounts")).toEqual(["partidas"]);
    expect(allowedChips("dispute_611_accounts")).toEqual(["partidas", "frase_adjuntos", "nombre", "destinatario"]);
  });

  it("the library packet is unchanged by the editor's refactor", () => {
    const meta = getLetterMeta("bureau_never_late")!;
    expect(renderSampleLetter(meta)).toBe(renderLetter(meta.key, sampleLetterContext(meta)));
    expect(renderSampleLetter(meta)).toContain(PACKET_DETAILS);
    expect(readFileSync("docs/LETTER-LIBRARY.md", "utf8")).toBe(buildLetterPacket());
  });
});

describe("what a new version must pass", () => {
  const KEY = "bureau_not_my_account";
  const base = builtinSource(KEY);
  const withBody = (body: string): LetterSource => ({ subject: base.subject, body });

  it("keeps the client's attested items and own words", () => {
    expect(codes(KEY, withBody(base.body.replace("{partidas}", "")))).toContain("chip_missing");
    expect(codes(KEY, withBody(base.body.replace("{detalles}", "")))).toContain("chip_missing");
    expect(codes(KEY, withBody(`${base.body}\n\n{partidas}`))).toContain("chip_twice");
    expect(codes(KEY, withBody(base.body.replace("\n\n{partidas}", " {partidas}")))).toContain("items_alone");
  });

  it("refuses unknown chips, stray braces, and chips the letter does not take", () => {
    expect(codes(KEY, withBody(`${base.body}\n\nMy account {cuenta} is wrong.`))).toContain("chip_unknown");
    expect(codes(KEY, withBody(`${base.body}\n\nI paid {in full.`))).toContain("brace");
    expect(codes("dispute_611_accounts", { ...builtinSource("dispute_611_accounts"), body: `${builtinSource("dispute_611_accounts").body}\n\nMy words: {detalles}` })).toContain("chip_not_here");
    expect(codes(KEY, { subject: "Dispute for {nombre}", body: base.body })).toContain("subject_chip");
    // The optional chips are fine anywhere.
    expect(codes(KEY, withBody(`${base.body}\n\nThis letter is from {nombre} to {destinatario}.`))).toEqual([]);
  });

  it("refuses a promise of results, the company's name, Spanish text and a hand-written frame", () => {
    expect(codes(KEY, withBody(`${base.body}\n\nThis guarantees deletion of these items.`))).toContain("guardrail");
    expect(codes(KEY, withBody(`${base.body}\n\nWe will remove these accounts.`))).toContain("guardrail");
    expect(codes(KEY, withBody(`${base.body}\n\nWe guarantee results within 30 days.`))).toContain("guardrail");
    expect(codes(KEY, withBody(`${base.body}\n\nCredalti prepared this letter on behalf of the consumer.`))).toContain("company_named");
    expect(codes(KEY, withBody(`${base.body}\n\nGracias por su atención.`))).toContain("not_english");
    expect(codes(KEY, withBody(`To Whom It May Concern:\n\n${base.body}`))).toContain("frame");
    expect(codes(KEY, withBody(`${base.body}\n\nSincerely, the consumer`))).toContain("frame");
    expect(codes(KEY, withBody(`${base.body}\n\n- another line that looks like an item`))).toContain("dash_line");
    expect(codes(KEY, withBody("{partidas}\n\n{detalles}"))).toContain("first_person");
    expect(codes(KEY, { subject: "", body: base.body })).toContain("subject_empty");
  });

  it("warns, without refusing, when a citation is dropped or an enclosure is claimed in free text", () => {
    const noCitation = withBody(base.body.replace("Under Section 611 of the Fair Credit Reporting Act (15 U.S.C. § 1681i), I ask", "I ask"));
    expect(codes(KEY, noCitation)).toEqual([]);
    expect(warnings(KEY, noCitation)).toContain("citation_dropped");
    expect(warnings(KEY, withBody(`${base.body}\n\nI have enclosed my bank statements.`))).toContain("enclosure_claim");
  });
});

describe("the versions of a letter", () => {
  const KEY = "personal_info_cleanup";
  const builtin = builtinSource(KEY);
  const edited = { templateKey: KEY, subject: builtin.subject, body: builtin.body.replace("I am writing to request", "I am writing to ask") };

  it("a draft is version 2, based on version 1; saving again rewrites it; no change and bad text are refused", () => {
    const first = planDraft([], edited, "Carmen", NOW, id);
    expect(first.ok && first.value.version).toMatchObject({ version: 2, basedOn: 1, status: "draft", origin: "edited", variables: ["partidas"] });
    if (!first.ok) return;
    const second = planDraft([first.value.version], { ...edited, body: `${edited.body}\n\nThank you.` }, "Carmen", NOW, id);
    expect(second.ok && second.value.replaces?.id).toBe(first.value.version.id);
    expect(planDraft([], { templateKey: KEY, ...builtin }, "Carmen", NOW, id)).toMatchObject({ ok: false, status: 422 });
    expect(planDraft([], { ...edited, body: "We fix credit." }, "Carmen", NOW, id)).toMatchObject({ ok: false, status: 422 });
    expect(planDraft([], { ...edited, templateKey: "made_up" }, "Carmen", NOW, id)).toMatchObject({ ok: false, status: 404 });
  });

  it("sending freezes the draft; with no draft, version 1 itself is sent once", () => {
    const draft = planDraft([], edited, "Carmen", NOW, id);
    if (!draft.ok) throw new Error();
    const sent = planSend([draft.value.version], KEY, "Carmen", NOW, id);
    expect(sent.ok && sent.value).toMatchObject({ isNew: false, version: { status: "sent", sentByName: "Carmen" } });
    const builtinSent = planSend([], KEY, "Carmen", NOW, id);
    expect(builtinSent.ok && builtinSent.value.version).toMatchObject({ version: 1, origin: "builtin", status: "sent", contentHash: builtinHash(KEY) });
    if (!builtinSent.ok) return;
    expect(planSend([builtinSent.value.version], KEY, "Carmen", NOW, id)).toMatchObject({ ok: false, status: 409 });
    expect(planDiscard([builtinSent.value.version], builtinSent.value.version.id)).toMatchObject({ ok: false, status: 409 });
  });

  it("the decision: confirmed as the attorney's, with the attorney's name and a real date; a rejection says why", () => {
    const sent = planSend([], KEY, "Carmen", NOW, id);
    if (!sent.ok) throw new Error();
    const v = [sent.value.version];
    const vid = sent.value.version.id;
    expect(planDecision(v, vid, decide("approved", { confirmed: false }), "Carmen", NOW)).toMatchObject({ ok: false, problems: [{ code: "not_confirmed" }] });
    expect(planDecision(v, vid, decide("approved", { attorneyName: " " }), "Carmen", NOW)).toMatchObject({ ok: false, problems: [{ code: "attorney_name" }] });
    expect(planDecision(v, vid, decide("approved", { decidedOn: "2027-01-01" }), "Carmen", NOW)).toMatchObject({ ok: false, problems: [{ code: "decided_on_future" }] });
    expect(planDecision(v, vid, decide("approved", { decidedOn: "ayer" }), "Carmen", NOW)).toMatchObject({ ok: false, problems: [{ code: "decided_on" }] });
    expect(planDecision(v, vid, decide("rejected", { note: "" }), "Carmen", NOW)).toMatchObject({ ok: false, problems: [{ code: "note_missing" }] });
    const approved = planDecision(v, vid, decide("approved"), "Carmen", NOW);
    expect(approved.ok && approved.value).toMatchObject({ status: "approved", approvedBy: "Lic. Laura Benítez", approvedAt: "2026-11-20", recordedByName: "Carmen" });
    if (!approved.ok) return;
    expect(planDecision([approved.value], vid, decide("rejected"), "Carmen", NOW)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("which text is mailed", () => {
  const KEY = "dispute_611_accounts";
  const NEW_LINE = "I am disputing the following accounts, which I believe are inaccurate, unverifiable, or outdated:";
  const edit = (body: string) => body.replace(/^I am exercising.*outdated:$/m, NEW_LINE);

  it("with nothing approved: version 1, unapproved", () => {
    expect(resolveLetter(KEY, [])).toMatchObject({ version: 1, origin: "builtin", approved: false, contentHash: builtinHash(KEY) });
  });

  it("the newest approved version, rendered from its own text; drafts and versions with the attorney do not count", () => {
    const versions = approvedEdit(KEY, edit);
    const resolved = resolveLetter(KEY, versions);
    expect(resolved).toMatchObject({ version: 2, approved: true, approvedBy: "Lic. Laura Benítez" });
    const letter = renderResolved(resolved, context());
    expect(letter).toContain(NEW_LINE);
    expect(letter).not.toContain("I am exercising my right");
    // The frame is the same as every letter's: what the wording checks rely on.
    expect(variationProblems(renderLetter(KEY, context()), letter).filter((p) => p !== "length changed too much" && !p.startsWith("citation"))).toEqual([]);
    // A newer draft or a version with the attorney changes nothing.
    const draft = planDraft(versions, { templateKey: KEY, subject: "Something else", body: builtinSource(KEY).body }, "Carmen", NOW, id);
    if (!draft.ok) throw new Error(JSON.stringify(draft.problems));
    expect(resolveLetter(KEY, [...versions, draft.value.version]).version).toBe(2);
  });

  it("an approval whose text was changed afterwards does not count", () => {
    const [approved] = approvedEdit(KEY, edit);
    const tampered = { ...approved!, body: approved!.body.replace("accounts", "debts") };
    expect(intact(tampered)).toBe(false);
    expect(resolveLetter(KEY, [tampered]).approved).toBe(false);
  });

  it("version 1's approval follows the text in code: a changed template needs a new approval", () => {
    const sent = planSend([], KEY, "Carmen", NOW, id);
    if (!sent.ok) throw new Error();
    const approved = planDecision([sent.value.version], sent.value.version.id, decide("approved"), "Carmen", NOW);
    if (!approved.ok) throw new Error();
    expect(resolveLetter(KEY, [approved.value]).approved).toBe(true);
    // As if a developer changed the template after the approval: the stored text no longer matches the code.
    const body = approved.value.body.replace("I believe", "I think");
    const stale = { ...approved.value, body, contentHash: contentHash(KEY, { subject: approved.value.subject, body }) };
    expect(intact(stale)).toBe(false);
    expect(resolveLetter(KEY, [stale])).toMatchObject({ approved: false, version: 1 });
  });

  it("the readiness rule: every letter of the round approved, or LETTERS_ALLOW_UNAPPROVED=1", () => {
    const versions = approvedEdit(KEY, edit);
    expect(lettersMayBeMailed([KEY], versions, {})).toEqual({ ok: true, allowedUnapproved: [] });
    const blocked = lettersMayBeMailed([KEY, "mov_request", KEY], versions, {});
    expect(blocked).toMatchObject({ ok: false, unapproved: ["mov_request"] });
    if (!blocked.ok) expect(blocked.message).toMatch(/abogado/);
    expect(lettersMayBeMailed(["mov_request"], [], { LETTERS_ALLOW_UNAPPROVED: "1" })).toEqual({ ok: true, allowedUnapproved: ["mov_request"] });
    expect(lettersMayBeMailed(["mov_request"], [], { LETTERS_ALLOW_UNAPPROVED: "true" }).ok).toBe(false);
  });

  it("the console's previews and printed letters use the approved text", () => {
    const versions = approvedEdit(KEY, edit);
    const client = { id: "c1", firstName: "Rosa", lastName: "Martínez", addressLines: ["1 Main St", "Houston, TX 77002"], documents: ["government_id"] } as unknown as StaffClient;
    const round = { number: 2, mailedAt: null } as unknown as StaffRound;
    const letter = { templateKey: KEY, recipient: PRIMARY_BUREAUS.equifax, items, itemReasons: {} } as unknown as StaffLetter;
    expect(staffLetterText(client, round, letter, NOW, versions)).toContain(NEW_LINE);
    expect(staffLetterText(client, round, letter, NOW)).toContain("I am exercising my right");
    expect(renderWithVersions(KEY, context(), undefined)).toBe(renderLetter(KEY, context()));
  });
});

describe("the comparison and the attorney's packet", () => {
  it("compares word by word and never splits a chip", () => {
    const parts = diffText("Please send me the results.\n\n{partidas}", "Please mail me the written results.\n\n{partidas}");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text.trim())).toEqual(["send"]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual(["mail", "written"]);
    expect(parts.some((p) => p.kind !== "same" && p.text.includes("{"))).toBe(false);
    expect(diffStats(parts)).toEqual({ added: 2, removed: 1 });
    expect(hasChanges(diffText("same", "same"))).toBe(false);
    const both = diffSources({ subject: "A", body: "x" }, { subject: "B", body: "x" });
    expect(hasChanges(both.subject) && !hasChanges(both.body)).toBe(true);
  });

  it("lists the versions with the attorney, with their changes, the full letter and the decision line", () => {
    const KEY = "bureau_never_late";
    const builtin = builtinSource(KEY);
    const draft = planDraft([], { templateKey: KEY, subject: builtin.subject, body: builtin.body.replace("I made those payments on time", "I paid on time every month") }, "Carmen", NOW, id);
    if (!draft.ok) throw new Error(JSON.stringify(draft.problems));
    const sent = planSend([draft.value.version], KEY, "Carmen", NOW, id);
    const v1 = planSend([], "mov_request", "Carmen", NOW, id);
    if (!sent.ok || !v1.ok) throw new Error();
    const entries = pendingPacketEntries([sent.value.version, v1.value.version]);
    expect(entries.map((e) => [e.meta.key, e.version.version])).toEqual([
      ["bureau_never_late", 2],
      ["mov_request", 1],
    ]);
    expect(entries[0]!.changes!.body.filter((p) => p.kind === "added").map((p) => p.text).join("")).toContain("paid");
    expect(entries[0]!.letter).toContain("I paid on time every month");
    expect(entries[1]!.changes).toBeNull();
    const markdown = buildPendingPacketMarkdown(entries);
    expect(markdown).toContain("Attorney decision: ☐ approve");
    expect(markdown).toContain(sent.value.version.contentHash);
    expect(markdown).toContain("<ins>");
    expect(markdown).not.toMatch(/\{partidas\}|\{detalles\}/);
    expect(markdown).toContain("[the items the client disputed");
  });
});

describe("no disguise, no new doors", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const EDITOR_FILES = [...files("src/lib/letters/versions"), ...files("src/app/equipo/cartas"), ...files("src/components/staff/letters"), ...files("src/app/api/staff/letters")];

  it("the editor never turns on font rotation or AI rewording", () => {
    for (const file of EDITOR_FILES) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/pickFont|FONT_ROTATION|varyLetterWording|LETTER_FONT_ROTATION|LETTER_AI_REWORDING|rewordingEnabled/);
    }
    expect(readFileSync("src/components/staff/letters/LetterParts.tsx", "utf8")).toMatch(/DEFAULT_LETTER_FONT/);
  });

  it("editing letters is for an administrator only; the shared mailing code applies the readiness rule", () => {
    expect(STAFF_ROLES.filter((role) => can(role, "letters.edit"))).toEqual(["admin"]);
    const send = readFileSync("src/lib/rounds/send.ts", "utf8");
    expect(send.indexOf("lettersMayBeMailed(")).toBeGreaterThan(0);
    expect(send.indexOf("lettersMayBeMailed(")).toBeLessThan(send.indexOf('.from("attack_rounds")\n      .insert'));
    expect(send).toMatch(/template_hash: version\.contentHash/);
    for (const file of files("src/app/api/staff/letters")) expect(readFileSync(file, "utf8"), file).toMatch(/requireCapability\("(letters\.edit|case\.view)"\)/);
  });

  it("the editor's body is strict", () => {
    expect(lettersBodySchema.safeParse({ action: "save_draft", templateKey: "mov_request", subject: "x", body: "y" }).success).toBe(true);
    expect(lettersBodySchema.safeParse({ action: "save_draft", templateKey: "mov_request", subject: "x", body: "y", status: "approved" }).success).toBe(false);
    expect(lettersBodySchema.safeParse({ action: "approve", id: "x" }).success).toBe(false);
    expect(lettersBodySchema.safeParse({ action: "send_to_attorney", templateKeys: ["Bad Key"] }).success).toBe(false);
  });

  it("every original letter the round engine uses is in the editor", () => {
    for (const key of ORIGINAL_TEMPLATE_KEYS) expect(getLetterMeta(key), key).toBeDefined();
  });
});
