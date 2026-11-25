import { existsSync, readFileSync } from "node:fs";
import { checkMarketingCopy } from "../compliance/guardrails";
import { APPROVED_LINES, CLAIM_RULES, contrastRatio, KIT_COLOURS, KIT_CONTRAST, KIT_DOWNLOADS, KIT_SPECS } from "../content/brandKit";
import { describe, expect, it } from "vitest";
import { ASSIST_SCHEMA, checkDraft, closestTemplate, parseAssistOutput, templateDraft, writeWithAlti, type AssistCaller } from "../content/assist";
import { assetLinkProblem, checkAsset, sniffAsset } from "../content/assets";
import { addDays, monthGrid, piecesByDay, weekDays, zonedInstant } from "../content/calendar";
import { approvalBlockers, blockingIssues, checklistFor, checkPiece, checkText } from "../content/check";
import { buildDemoContent } from "../content/demo";
import { approvalHolds, canonicalJson, pieceHash, sha256Hex } from "../content/hash";
import { AUDIENCE_LABEL, CHANNEL_LABEL, METRIC_LABEL, STATUS_HINT, STATUS_LABEL, THEME_LABEL, TYPE_LABEL } from "../content/labels";
import { attributeLeads, pieceResults, resultEntryProblem, themeResults } from "../content/results";
import { applyContentAction, canMove, filterPieces, type ContentAction } from "../content/rules";
import { contentBodySchema } from "../content/schemas";
import { CONTENT_TEMPLATES } from "../content/templates";
import { campaignCodeFor, emptyCopy, trackedLink, type ContentPiece } from "../content/types";
import { can, CAPABILITIES, CAPABILITY_LABELS, rolesThatCan } from "../staff/permissions";
import { MORE_NAV } from "../staff/nav";

// The content hub (docs/CONTENT.md): the checks, the approval rules, the
// templates, Alti's assistant (mocked model), results and the calendar.

const NOW = new Date("2026-12-07T16:00:00.000Z");

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  const first = applyContentAction([], { action: "create", id: "pc_test000001", title: "A test piece", type: "short_video", channels: ["instagram"], language: "both", audience: "consumers", theme: "myths" }, "marta", NOW);
  if (!first.ok) throw new Error("create failed");
  return { ...first.piece, ...over };
}

const goodCopy = () => JSON.parse(JSON.stringify(CONTENT_TEMPLATES.find((t) => t.id === "myth-fact")!.copy)) as ContentPiece["copy"];
const ticked: ContentPiece["checklist"] = { logo: true, colours: true, fonts: true, altiLabel: true, altibotCameo: true, languagesMatch: true, captions: true };

describe("content: the checks", () => {
  it("every template passes every check, blocking or not, in both languages", () => {
    expect(CONTENT_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    for (const t of CONTENT_TEMPLATES) {
      const p = piece({ type: t.type, audience: t.audience, theme: t.theme, channels: t.channels, characters: t.characters, copy: t.copy });
      expect(checkPiece(p).map((i) => `${i.id} ${i.match ?? ""}`), t.id).toEqual([]);
      for (const beat of t.structure) for (const lang of ["en", "es"] as const) expect(beat[lang].length, t.id).toBeGreaterThan(5);
    }
    const ids = CONTENT_TEMPLATES.map((t) => t.id);
    for (const required of ["myth-fact", "fcra-30s", "dispute-letter", "itin-spanish", "partner-good-hands", "aftercare-building"]) expect(ids).toContain(required);
  });

  it("blocks promises, 'free', points, prices, pressure and outcome words, with a plain explanation in both languages", () => {
    const cases: Array<[string, string]> = [
      ["Fix your credit FREE in 30 days!", "no-free"],
      ["+100 points in 30 days", "no-score-visuals"],
      ["We remove the negative items from your report.", "diy-positioning"],
      ["Guaranteed results.", "no-outcome-words"],
      ["Only $49 a month.", "no-price"],
      ["Act now, spots left!", "no-pressure"],
      ["¡Arregla tu crédito hoy!", "no-outcome-promise"],
      ["¡Solo hoy! Última oportunidad.", "no-pressure"],
      ["Eliminamos lo negativo de tu reporte.", "diy-positioning"],
      ["Disputamos todo lo negativo por ti.", "client-decides"],
      ["Money-back guarantee.", "no-money-back"],
      ["Before and after: see the difference.", "no-score-visuals"],
      ["AltiBot explains your report.", "altibot-speaks"],
    ];
    for (const [text, rule] of cases) {
      const lang = /[¡ñá]|Eliminamos|Disputamos/.test(text) ? "es" : "en";
      const found = checkText(text, "caption", lang);
      const hit = found.find((i) => i.rule === rule);
      expect(hit, `${text} → ${rule} (got ${found.map((i) => i.rule).join(",")})`).toBeDefined();
      expect(hit!.severity).toBe("block");
      expect(hit!.explain.en.length).toBeGreaterThan(20);
      expect(hit!.explain.es.length).toBeGreaterThan(20);
      expect(hit!.fix.en.length).toBeGreaterThan(5);
    }
  });

  it("lets plain denials and process words through", () => {
    for (const text of ["We do not guarantee results.", "No garantizamos resultados.", "Our team prepares and mails the letters for you.", "You can dispute on your own, at no cost."]) {
      expect(blockingIssues(checkText(text, "caption", /garant/.test(text) ? "es" : "en")), text).toEqual([]);
    }
  });

  it("asks for 'results vary', the monitoring commission, the partner-fee line, Alti's AI label and both languages", () => {
    const rules = (p: ContentPiece) => checkPiece(p).map((i) => i.rule);
    const copy = goodCopy();
    copy.caption.en = copy.caption.en.replace(" Results vary.", "");
    expect(rules(piece({ copy }))).toContain("results-vary");
    const monitoring = goodCopy();
    monitoring.caption.en += " You need credit monitoring.";
    monitoring.caption.es += " Necesitas monitoreo de crédito.";
    expect(rules(piece({ copy: monitoring }))).toContain("monitoring-disclosure");
    monitoring.caption.en += " Credalti earns a commission from the monitoring service.";
    monitoring.caption.es += " Credalti recibe una comisión del servicio de monitoreo.";
    expect(rules(piece({ copy: monitoring }))).not.toContain("monitoring-disclosure");
    expect(rules(piece({ copy: goodCopy(), audience: "partners" }))).toContain("partner-paid");
    expect(rules(piece({ copy: goodCopy(), characters: ["alti"] }))).toContain("alti-label");
    const oneSided = goodCopy();
    oneSided.cta.es = "";
    expect(checkPiece(piece({ copy: oneSided })).find((i) => i.rule === "missing-translation")).toMatchObject({ field: "cta", lang: "es", severity: "block" });
    const numbers = goodCopy();
    numbers.caption.es = numbers.caption.es.replace("tres", "3");
    expect(checkPiece(piece({ copy: numbers })).find((i) => i.rule === "numbers-differ")?.severity).toBe("warn");
    expect(rules(piece({ copy: emptyCopy() }))).toContain("empty");
    expect(rules(piece({ copy: goodCopy(), links: ["http://credalti.example"] }))).toContain("link-not-https");
  });

  it("asks for alt text on every image of a picture piece", () => {
    const img = { id: "as_img000001", kind: "upload" as const, ref: "pc_test000001/as_img000001.png", name: "slide.png", mediaType: "image/png", bytes: 1000, altText: "", addedBy: "marta", addedAt: NOW.toISOString() };
    const p = piece({ type: "carousel", copy: goodCopy(), assets: [img] });
    expect(checkPiece(p).map((i) => i.rule)).toContain("alt-text");
    expect(checklistFor(p).find((c) => c.key === "altText")).toMatchObject({ applies: true, mode: "auto", done: false });
    expect(checkPiece({ ...p, assets: [{ ...img, altText: "A navy card with the words Myth and Fact." }] }).map((i) => i.rule)).not.toContain("alt-text");
  });

  it("the checklist applies by piece: captions on video, AltiBot only when he appears, the language match only for both", () => {
    const video = checklistFor(piece({ copy: goodCopy() }));
    expect(video.find((c) => c.key === "captions")!.applies).toBe(true);
    expect(video.find((c) => c.key === "altibotCameo")!.applies).toBe(false);
    expect(video.find((c) => c.key === "languagesMatch")!.applies).toBe(true);
    const en = checklistFor(piece({ copy: goodCopy(), language: "en", type: "image", characters: ["altibot"] }));
    expect(en.find((c) => c.key === "captions")!.applies).toBe(false);
    expect(en.find((c) => c.key === "languagesMatch")!.applies).toBe(false);
    expect(en.find((c) => c.key === "altibotCameo")!.applies).toBe(true);
  });
});

describe("content: approval", () => {
  const act = (p: ContentPiece, action: ContentAction, by = "marta") => applyContentAction([p], action, by, NOW);

  it("cannot approve with blocking issues or an open checklist; can once both are clear", () => {
    const bad = piece({ status: "review", copy: { ...goodCopy(), hook: { en: "Fix your credit FREE!", es: "¡Arregla tu crédito GRATIS!" } }, checklist: ticked });
    expect(act(bad, { action: "approve", id: bad.id }, "carmen")).toMatchObject({ ok: false, code: "blocked" });
    expect(approvalBlockers(bad).map((b) => b.code)).toEqual(["blocking_issues"]);
    const open = piece({ status: "review", copy: goodCopy(), checklist: {} });
    expect(approvalBlockers(open).map((b) => b.code)).toEqual(["checklist_open"]);
    const good = piece({ status: "review", copy: goodCopy(), checklist: ticked });
    const approved = act(good, { action: "approve", id: good.id }, "carmen");
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.piece.status).toBe("approved");
      expect(approved.piece.approval).toMatchObject({ by: "carmen", hash: pieceHash(good) });
      expect(approved.events.map((e) => e.kind)).toEqual(["checked", "approved"]);
      expect(approvalHolds(approved.piece)).toBe(true);
    }
  });

  it("only a piece in review is approved, and 'move' never approves or posts", () => {
    const p = piece({ status: "in_production", copy: goodCopy(), checklist: ticked });
    expect(act(p, { action: "approve", id: p.id }, "carmen")).toMatchObject({ ok: false, code: "not_in_review" });
    for (const to of ["approved", "scheduled", "posted", "measured", "review"] as const) expect(canMove("in_production", to), to).toBe(false);
    expect(act(p, { action: "move", id: p.id, to: "approved" })).toMatchObject({ ok: false });
  });

  it("an edit after approval drops the approval and sends the piece back to review", () => {
    const good = piece({ status: "review", copy: goodCopy(), checklist: ticked });
    const approved = act(good, { action: "approve", id: good.id }, "carmen");
    if (!approved.ok) throw new Error("approve");
    const scheduled = { ...approved.piece, status: "scheduled" as const };
    const edited = act(scheduled, { action: "update", id: good.id, patch: { copy: { hook: { en: "A new hook.", es: "Un gancho nuevo." } } } });
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.piece.status).toBe("review");
      expect(edited.piece.approval).toBeNull();
      expect(edited.piece.checklist).toEqual({});
      expect(edited.events.map((e) => e.kind)).toContain("approval_reset");
    }
    // A change that does not touch what is published (the owner, the date) keeps it.
    const owner = act(approved.piece, { action: "update", id: good.id, patch: { owner: "carmen", dueDate: "2026-12-20" } });
    expect(owner.ok && owner.piece.status).toBe("approved");
    // A new file, or a changed alt text, is a change too.
    const file = act(approved.piece, { action: "add_asset", id: good.id, asset: { id: "as_new0000001", kind: "url", ref: "https://canva.example/d/1", name: "Canva", mediaType: null, bytes: null, altText: "", addedBy: "marta", addedAt: NOW.toISOString() } });
    expect(file.ok && file.piece.status).toBe("review");
  });

  it("asking for changes needs a note and clears the approval; posting needs a standing approval and an https link", () => {
    const good = piece({ status: "review", copy: goodCopy(), checklist: ticked });
    expect(act(good, { action: "request_changes", id: good.id, note: "" }, "carmen")).toMatchObject({ ok: false, code: "bad_input" });
    const back = act(good, { action: "request_changes", id: good.id, note: "Shorter hook, please." }, "carmen");
    expect(back.ok && back.piece).toMatchObject({ status: "changes", changesNote: "Shorter hook, please.", approval: null });
    expect(act(good, { action: "record_post", id: good.id, channel: "instagram", url: "https://instagram.com/p/x" })).toMatchObject({ ok: false, code: "not_approved" });
    const approved = act(good, { action: "approve", id: good.id }, "carmen");
    if (!approved.ok) throw new Error("approve");
    expect(act(approved.piece, { action: "record_post", id: good.id, channel: "instagram", url: "http://instagram.com/p/x" })).toMatchObject({ ok: false, code: "bad_input" });
    const posted = act(approved.piece, { action: "record_post", id: good.id, channel: "instagram", url: "https://www.instagram.com/p/abc" });
    expect(posted.ok && posted.piece.status).toBe("posted");
    expect(posted.ok && posted.piece.posts[0]).toMatchObject({ channel: "instagram", via: "person" });
    // Once out, the words no longer change: a copy is made instead.
    if (posted.ok) expect(act(posted.piece, { action: "update", id: good.id, patch: { copy: { hook: { en: "x y", es: "x y" } } } })).toMatchObject({ ok: false, code: "already_posted" });
  });

  it("an AI draft stops being one when a person edits the words", () => {
    const draft = piece({ aiDraft: true, copy: goodCopy() });
    const edited = act(draft, { action: "update", id: draft.id, patch: { copy: { cta: { en: "See how it works", es: "Mira cómo funciona" } } } });
    expect(edited.ok && edited.piece.aiDraft).toBe(false);
  });

  it("the hash is SHA-256 of the canonical content", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("ñ ¿qué? 🎬")).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const p = piece({ copy: goodCopy() });
    expect(pieceHash(p)).toBe(pieceHash({ ...p, title: "Another title", owner: "carmen" } as ContentPiece));
    expect(pieceHash(p)).not.toBe(pieceHash({ ...p, links: ["https://credalti.example"] }));
  });
});

describe("content: the board", () => {
  const demo = buildDemoContent(NOW);

  it("the demo has a piece in every column, and its approved pieces really are approved", () => {
    for (const status of ["idea", "planned", "in_production", "review", "changes", "approved", "scheduled", "posted", "measured"]) {
      expect(demo.pieces.some((p) => p.status === status), status).toBe(true);
    }
    for (const p of demo.pieces.filter((x) => ["approved", "scheduled", "posted", "measured"].includes(x.status))) {
      expect(approvalHolds(p), p.id).toBe(true);
      expect(approvalBlockers(p), p.id).toEqual([]);
    }
    // The freelancer's draft shows the checks at work.
    const bad = demo.pieces.find((p) => p.id === "pc_demo0003")!;
    expect(blockingIssues(checkPiece(bad)).length).toBeGreaterThan(5);
  });

  it("filters by channel, language (a bilingual piece counts for each), audience and owner", () => {
    expect(filterPieces(demo.pieces, { channel: "youtube" }).map((p) => p.id)).toEqual(["pc_demo0004"]);
    expect(filterPieces(demo.pieces, { language: "es" }).length).toBe(demo.pieces.filter((p) => p.language !== "en").length);
    expect(filterPieces(demo.pieces, { audience: "partners" }).map((p) => p.id)).toEqual(["pc_demo0007"]);
    expect(filterPieces(demo.pieces, { owner: "carmen" }).every((p) => p.owner === "carmen")).toBe(true);
  });

  it("the calendar puts each piece on its day, with weeks from Sunday", () => {
    const grid = monthGrid(2026, 12);
    expect(grid[0]![0]).toBe("2026-11-29");
    expect(grid.flat()).toContain("2026-12-31");
    expect(weekDays("2026-12-09")).toEqual(["2026-12-06", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    const days = piecesByDay(demo.pieces);
    expect([...days.values()].flat().length).toBeGreaterThan(5);
    // 6:30 p.m. in Houston in December is 00:30 UTC the next day.
    expect(zonedInstant("2026-12-07", "18:30")).toBe("2026-12-08T00:30:00.000Z");
    expect(zonedInstant("2026-07-07", "18:30")).toBe("2026-07-07T23:30:00.000Z");
  });

  it("the campaign code tags the links, and leads are counted by it", () => {
    const p = demo.pieces[0]!;
    expect(p.campaignCode).toBe(campaignCodeFor(p.id));
    const url = new URL(trackedLink("https://credalti.example/empezar?lang=es", p, "instagram"));
    expect(url.searchParams.get("utm_content")).toBe(p.campaignCode);
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.get("lang")).toBe("es");
    const attribution = attributeLeads(demo.pieces, [
      { utmContent: p.campaignCode.toUpperCase(), converted: true },
      { campaign: p.campaignCode, converted: false },
      { utmContent: "something-else", converted: true },
    ]);
    expect(attribution.get(p.campaignCode)).toEqual({ leads: 2, clients: 1 });
  });

  it("results: real numbers only, the newest per channel, 'no data' instead of zero", () => {
    const measured = pieceResults(demo.pieces.find((p) => p.id === "pc_demo0009")!, demo.results);
    expect(measured.totals.views).toBe(6950);
    expect(measured.totals.leads).toBe(6);
    const none = pieceResults(demo.pieces.find((p) => p.id === "pc_demo0010")!, demo.results);
    expect(none.hasData).toBe(false);
    expect(Object.values(none.totals).every((v) => v === null)).toBe(true);
    const themes = themeResults(demo.pieces.map((p) => pieceResults(p, demo.results)));
    expect(themes[0]!.theme).toBe("aftercare");
    expect(themes.find((t) => t.theme === "rights")!.totals.views).toBeNull();
    expect(resultEntryProblem({})).toBe("empty");
    expect(resultEntryProblem({ views: -1 })).toBe("not_a_count");
    expect(resultEntryProblem({ views: 1.5 })).toBe("not_a_count");
    expect(resultEntryProblem({ leads: 2, signed: 3 })).toBe("more_clients_than_leads");
    expect(resultEntryProblem({ views: 0 })).toBeNull();
  });
});

describe("content: Alti's writing assistant (mocked model)", () => {
  const request = { topic: "What the FCRA says about disputes", type: "short_video" as const, audience: "consumers" as const };

  it("without a key, writes from the closest pre-checked template, marked as a draft, and checked", async () => {
    expect(closestTemplate(request).id).toBe("fcra-30s");
    expect(closestTemplate({ topic: "ITIN y crédito", type: "short_video", audience: "hispanic" }).id).toBe("itin-spanish");
    expect(closestTemplate({ topic: "a flyer", type: "partner", audience: "partners" }).id).toBe("partner-good-hands");
    const result = await writeWithAlti(request, null);
    expect(result).toMatchObject({ source: "templates", draft: true, templateId: "fcra-30s", note: "not_configured" });
    expect(result.hooks.length).toBe(3);
    expect(blockingIssues(result.issues)).toEqual([]);
    expect(templateDraft(request).hooks[1]!.en).toMatch(/What the FCRA says about disputes/);
  });

  it("with a model, a reply that breaks a rule is written again once with the reasons, and still checked", async () => {
    const calls: string[] = [];
    const bad = { hooks: [{ en: "Fix your credit FREE", es: "Arregla tu crédito GRATIS" }], onScreen: { en: "x", es: "x" }, script: { en: "We remove bad items.", es: "Eliminamos lo malo." }, caption: { en: "Guaranteed.", es: "Garantizado." }, cta: { en: "Act now", es: "Ya" } };
    const good = {
      hooks: [{ en: "You can dispute errors.", es: "Puedes disputar errores." }],
      onScreen: { en: "Your rights, in plain words.", es: "Tus derechos, en palabras simples." },
      script: { en: "You tell us what is wrong. Our team prepares and mails the letters.", es: "Tú nos dices qué está mal. Nuestro equipo prepara y envía las cartas." },
      caption: { en: "You decide what is inaccurate. Results vary.", es: "Tú decides qué es inexacto. Los resultados varían." },
      cta: { en: "Start my review", es: "Empezar mi revisión" },
    };
    const caller: AssistCaller = async ({ system, user }) => {
      calls.push(user);
      expect(system).toMatch(/never publish/);
      expect(system).toMatch(/Results vary/);
      return { output: calls.length === 1 ? bad : good, problem: null };
    };
    const result = await writeWithAlti(request, caller);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/broke these rules/);
    expect(calls[1]).toMatch(/no-free|diy-positioning/);
    expect(result).toMatchObject({ source: "model", draft: true });
    expect(result.issues).toEqual([]);
  });

  it("twice bad: the draft comes back with its issues shown, never clean; a refusal or bad JSON falls back to the templates", async () => {
    const bad = { hooks: [{ en: "Free credit repair", es: "Reparación gratis" }], onScreen: { en: "x", es: "x" }, script: { en: "x", es: "x" }, caption: { en: "x", es: "x" }, cta: { en: "x", es: "x" } };
    const twice = await writeWithAlti(request, async () => ({ output: bad, problem: null }));
    expect(twice.source).toBe("model");
    expect(blockingIssues(twice.issues).length).toBeGreaterThan(0);
    expect((await writeWithAlti(request, async () => ({ output: null, problem: "refusal" }))).source).toBe("templates");
    expect((await writeWithAlti(request, async () => ({ output: { hooks: "nope" }, problem: null }))).note).toBe("invalid_output");
    expect(parseAssistOutput({ ...bad, cta: { en: "x".repeat(61), es: "x" } })).toBeNull();
    expect(ASSIST_SCHEMA.required).toEqual(["hooks", "onScreen", "script", "caption", "cta"]);
    expect(checkDraft(templateDraft(request)).filter((i) => i.severity === "block")).toEqual([]);
  });

  it("the route uses the repo's model pattern and never calls a model without a key", () => {
    const model = readFileSync("src/lib/content/assistModel.ts", "utf8");
    expect(model).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(model).toMatch(/cache_control/);
    expect(model).toMatch(/json_schema/);
    const route = readFileSync("src/app/api/staff/content/assist/route.ts", "utf8");
    expect(route).toMatch(/requireCapability\("content\.edit"\)/);
    expect(route).toMatch(/rateLimit\(/);
  });
});

describe("content: files", () => {
  it("decides the type from the first bytes, with the size limits", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0]);
    expect(sniffAsset(png)).toBe("image/png");
    expect(sniffAsset(mp4)).toBe("video/mp4");
    expect(sniffAsset(heic)).toBeNull();
    expect(checkAsset(exe, 4)).toMatchObject({ ok: false, code: "wrong_type", status: 415 });
    expect(checkAsset(png, 21 * 1024 * 1024)).toMatchObject({ ok: false, code: "too_large", status: 413 });
    expect(checkAsset(mp4, 400 * 1024 * 1024)).toMatchObject({ ok: true, mediaType: "video/mp4" });
    expect(checkAsset(png, 1000, "video/mp4")).toMatchObject({ ok: false, code: "type_mismatch" });
    expect(assetLinkProblem("http://canva.com/x")).toBe("not_https");
    expect(assetLinkProblem("https://www.canva.com/design/abc")).toBeNull();
  });
});

describe("content: the brand kit reads the sources of truth", () => {
  it("every colour is the @theme token's value, and the contrast notes are right", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const c of KIT_COLOURS) {
      if (c.token === "white") continue;
      const token = c.token.split(" / ")[0]!;
      expect(css.toLowerCase(), c.token).toContain(`--color-${token}: ${c.hex.toLowerCase()};`);
    }
    expect(KIT_CONTRAST.find((p) => p.fg === "#EFB537" && p.bg === "#FFFFFF")).toMatchObject({ ok: false });
    expect(KIT_CONTRAST.filter((p) => p.fg !== "#EFB537" || p.bg !== "#FFFFFF").every((p) => p.ok)).toBe(true);
    expect(contrastRatio("#12213A", "#FFFFFF")).toBe(16.1);
  });

  it("every download is a real public file, and the video specs come from lock.json", () => {
    for (const d of KIT_DOWNLOADS) expect(existsSync(`public${d.file}`), d.file).toBe(true);
    const lock = JSON.parse(readFileSync("content/brand/lock.json", "utf8")) as { captions: unknown; endCard: unknown };
    expect(KIT_SPECS.captions).toEqual(lock.captions);
    expect(KIT_SPECS.endCard).toEqual(lock.endCard);
    for (const line of [...CLAIM_RULES.flatMap((r) => [r.why.en, r.why.es]), ...APPROVED_LINES.flatMap((l) => [l.en, l.es])]) {
      // The kit names banned words to explain them, so only the promise rules are checked here.
      expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
    }
  });
});

describe("content: roles, routes and words", () => {
  it("administrators approve and publish; specialists make content; sales sees the brand kit and approved partner material", () => {
    for (const c of ["content.view", "content.edit", "content.approve", "content.publish", "content.share"] as const) expect(CAPABILITIES).toContain(c);
    expect(rolesThatCan("content.approve")).toEqual(["admin"]);
    expect(rolesThatCan("content.publish")).toEqual(["admin"]);
    expect(rolesThatCan("content.edit")).toEqual(["admin", "specialist"]);
    expect(rolesThatCan("content.share")).toEqual(["admin", "specialist", "sales"]);
    expect(can("sales", "content.view")).toBe(false);
    expect(MORE_NAV.find((n) => n.href === "/equipo/contenido")?.needs).toBe("content.share");
    for (const locale of ["en", "es"] as const) expect(CAPABILITY_LABELS[locale]["content.approve"].length).toBeGreaterThan(5);
  });

  it("every content route checks a capability, and the actions keep their owners", () => {
    const route = readFileSync("src/app/api/staff/content/route.ts", "utf8");
    expect(route).toMatch(/requireCapability\("content\.view"\)/);
    expect(route).toMatch(/requireCapability\("content\.share"\)/);
    expect(route).toMatch(/requireCapability\(capabilityFor\(input\.action\)\)/);
    expect(route).toMatch(/settings: "content\.publish"/);
    expect(readFileSync("src/app/api/staff/content/assets/route.ts", "utf8")).toMatch(/requireCapability\("content\.edit"\)/);
    expect(readFileSync("src/app/api/staff/content/connect/[provider]/route.ts", "utf8")).toMatch(/requireCapability\("content\.publish"\)/);
    expect(readFileSync("src/app/api/cron/content/route.ts", "utf8")).toMatch(/hasSharedSecret\(req, process\.env\.N8N_WEBHOOK_SECRET\)/);
  });

  it("the route schema refuses unknown fields and bad ids", () => {
    expect(contentBodySchema.safeParse({ action: "approve", id: "pc_demo0004" }).success).toBe(true);
    expect(contentBodySchema.safeParse({ action: "approve", id: "pc_demo0004", force: true }).success).toBe(false);
    expect(contentBodySchema.safeParse({ action: "approve", id: "../x" }).success).toBe(false);
    expect(contentBodySchema.safeParse({ action: "move", id: "pc_demo0004", to: "deleted" }).success).toBe(false);
    expect(contentBodySchema.safeParse({ action: "add_result", id: "pc_demo0004", channel: "instagram", values: { views: 10 } }).success).toBe(true);
    expect(contentBodySchema.safeParse({ action: "add_result", id: "pc_demo0004", channel: "instagram", values: { views: -1 } }).success).toBe(false);
  });

  it("the labels are complete in both languages, with no Spanish in the English", () => {
    for (const table of [TYPE_LABEL, CHANNEL_LABEL, AUDIENCE_LABEL, THEME_LABEL, STATUS_LABEL, STATUS_HINT, METRIC_LABEL]) {
      expect(Object.keys(table.en)).toEqual(Object.keys(table.es));
      for (const value of Object.values(table.en)) expect(value).not.toMatch(/[áéíóúñ¿¡]|\b(el|la|los|las|que|para|con|del)\b/i);
    }
  });
});
