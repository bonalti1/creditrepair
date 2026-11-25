import { describe, expect, it } from "vitest";
import { buildDemoBook } from "../accounting/demo";
import { chargeFacts } from "../accounting/facts";
import { totalsFor, type BooksInput } from "../accounting/summary";
import type { Expense, MonthClose } from "../accounting/types";
import { attachDemoAutopilot } from "../autopilot/demo";
import { workQueue } from "../autopilot/queue";
import { buildDemoContent } from "../content/demo";
import { DEFAULT_PUBLISH_SETTINGS } from "../content/publish/gates";
import { emptyCopy, type ContentPiece } from "../content/types";
import { booksDue, booksSnapshot, RECEIPT_THRESHOLD_CENTS } from "../control/books";
import { contentNeeds, contentSummary, type ContentSummary, type ScheduleLike } from "../control/content";
import { DEPARTMENT_LABELS, departmentTiles } from "../control/departments";
import { moneySummary, overviewCards, type ControlExtras, type OverviewInput } from "../control/overview";
import { todayList, type TodayInput } from "../control/today";
import { buildDemoLeads } from "../leads/demo";
import { DEFAULT_LEAD_AUTOPILOT } from "../leads/types";
import { buildDemoClients } from "../staff/demoClients";
import { MORE_NAV, PRIMARY_NAV } from "../staff/nav";
import { can, type Capability } from "../staff/permissions";
import type { StaffRole } from "../staff/types";

// Credalti Control, phase 2 (docs/CONTROL.md): the Overview as the home of the
// business. The Content card and its Today items, this month's books on the
// Money card for the owner, the books' Today items, the departments strip,
// and who sees each of them.

const NOW = new Date("2026-12-07T17:00:00.000Z"); // Monday, 11 a.m. in Texas; the content week is Sun Dec 6 – Sat Dec 12.
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id,
  title: `Piece ${id}`,
  type: "short_video",
  channels: ["instagram"],
  language: "en",
  audience: "consumers",
  theme: "rights",
  goal: "",
  copy: emptyCopy(),
  characters: [],
  links: [],
  assets: [],
  owner: "marta",
  dueDate: null,
  status: "idea",
  campaignCode: "cnt-000001",
  templateId: null,
  aiDraft: false,
  checklist: {},
  approval: null,
  changesNote: null,
  posts: [],
  failure: null,
  createdBy: "marta",
  createdAt: ago(10),
  updatedAt: ago(1),
  ...over,
});

const PIECES: ContentPiece[] = [
  piece("pc_review1", { status: "review", title: "FCRA in 30 seconds", updatedAt: ago(3) }),
  piece("pc_review2", { status: "review", title: "ITIN reel", updatedAt: ago(0.2) }),
  piece("pc_changes_marta", { status: "changes", title: "Meet Alti", changesNote: "Keep the AI label on screen." }),
  piece("pc_changes_free", { status: "changes", title: "Partner flyer", owner: null, changesNote: "Say partners are not paid." }),
  piece("pc_changes_other", { status: "changes", title: "Ana's story", owner: "carmen", changesNote: "Shorter." }),
  piece("pc_failed", { status: "failed", title: "Myth: checking hurts", failure: "The Instagram connection expired. Connect it again." }),
  piece("pc_approved", { status: "approved", title: "Approved, nothing scheduled" }),
  piece("pc_scheduled", { status: "scheduled", title: "Scheduled this week" }),
  piece("pc_posted", { status: "posted", title: "Posted Monday", posts: [{ channel: "facebook", url: "https://facebook.com/p/1", postedAt: ago(0.1), by: "marta", via: "person" }] }),
  piece("pc_posted_old", { status: "measured", title: "Posted last week", posts: [{ channel: "instagram", url: "https://instagram.com/p/1", postedAt: ago(3), by: "marta", via: "person" }] }),
  piece("pc_archived", { status: "archived", title: "Old" }),
];
const SCHEDULES: ScheduleLike[] = [
  { pieceId: "pc_scheduled", channel: "instagram", scheduledAt: ahead(2), status: "scheduled", lastError: null },
  { pieceId: "pc_scheduled", channel: "tiktok", scheduledAt: ahead(9), status: "scheduled", lastError: null }, // next week
  { pieceId: "pc_failed", channel: "instagram", scheduledAt: ago(1), status: "failed", lastError: "token expired" },
  { pieceId: "pc_posted", channel: "facebook", scheduledAt: ago(0.1), status: "cancelled", lastError: null },
];
const SUMMARY = contentSummary(PIECES, SCHEDULES, DEFAULT_PUBLISH_SETTINGS, NOW);

const clients = attachDemoAutopilot(buildDemoClients(NOW), NOW);
const queueFor = (role: StaffRole) => workQueue(clients, NOW, { autopilot: { settings: DEFAULT_LEAD_AUTOPILOT as never, channels: { whatsapp: false, email: false, approvedTemplates: [], simulated: true } } } as never, role);
const extras = (content: ContentSummary | null): ControlExtras => ({ partnerNotesWaiting: 0, reviewRequests30d: 0, complaints7d: 0, escalations: null, health: null, content });
const HANDLE: Record<StaffRole, string> = { admin: "carmen", specialist: "marta", sales: "ana" };
const overview = (role: StaffRole, over: Partial<OverviewInput> = {}): OverviewInput => ({
  clients,
  queue: queueFor(role),
  leads: buildDemoLeads(NOW),
  extras: extras(SUMMARY),
  money: moneySummary(clients, NOW),
  handle: HANDLE[role],
  can: (c) => can(role, c),
  now: NOW,
  locale: "en",
  ...over,
});
const card = (cards: ReturnType<typeof overviewCards>, key: string) => cards.find((c) => c.key === key);
const metric = (c: ReturnType<typeof card>, key: string) => c?.metrics.find((m) => m.key === key);

// The accounting demo's books, through the accounting module's own functions.
const demoBook = buildDemoBook(clients, NOW);
const booksInput: BooksInput = { facts: chargeFacts(clients, demoBook.chargeMeta), expenses: demoBook.expenses, otherIncome: demoBook.otherIncome, commissions: [], collectionActions: demoBook.collectionActions };

describe("the Content card: real numbers from the board", () => {
  it("counts the board as the content hub keeps it: review, this week's schedules and posts, failures, the switches", () => {
    expect(SUMMARY.pieces).toBe(10); // archived left out
    expect(SUMMARY.review.map((r) => r.id)).toEqual(["pc_review1", "pc_review2"]);
    expect(SUMMARY.scheduledThisWeek).toBe(1); // next week's and the cancelled one do not count
    expect(SUMMARY.approvedNotScheduled).toBe(1);
    expect(SUMMARY.postedThisWeek).toBe(1); // Monday's; last Friday's is last week
    expect(SUMMARY.failed).toEqual([expect.objectContaining({ id: "pc_failed", channel: "instagram", note: "The Instagram connection expired. Connect it again." })]);
    expect(SUMMARY.publishing).toEqual({ enabled: false, channelsOn: 0 });
    expect(SUMMARY.week).toEqual({ from: "2026-12-06", to: "2026-12-12" });
    // Never the words of a piece: titles, dates, owners, notes.
    expect(JSON.stringify(SUMMARY)).not.toMatch(/copy|caption|script|hook/);
  });

  it("shows the numbers, and publishing on or off", () => {
    const c = card(overviewCards(overview("admin")), "content")!;
    expect(c.metrics.map((m) => [m.key, m.value])).toEqual([
      ["review", "2"],
      ["scheduled", "1"],
      ["posted", "1"],
      ["failed", "1"],
      ["publishing", "Off"],
    ]);
    expect(metric(c, "scheduled")!.hint).toBe("1 approved, not scheduled");
    expect(c.link).toEqual({ href: "/equipo/contenido", label: "Open Content" });
    const on = contentSummary(PIECES, SCHEDULES, { enabled: true, channels: { facebook: true, instagram: true, tiktok: false, youtube: false } }, NOW);
    expect(metric(card(overviewCards(overview("admin", { extras: extras(on) })), "content"), "publishing")!.value).toBe("On · 2 channels");
    const es = card(overviewCards(overview("admin", { locale: "es" })), "content")!;
    expect(es.title).toBe("Contenido");
    expect(metric(es, "publishing")!.value).toBe("Apagada");
  });

  it("Needs you: what waits for approval for an approver, the changes asked of an editor; failed posts for both", () => {
    const admin = card(overviewCards(overview("admin")), "content")!;
    expect(admin.needsYou).toMatchObject({ count: 3, href: "/equipo/contenido?columna=review" }); // 2 in review + 1 failed
    const marta = card(overviewCards(overview("specialist")), "content")!;
    // Hers and the unowned one, not carmen's; plus the failed post.
    expect(marta.needsYou).toMatchObject({ count: 3, href: "/equipo/contenido?columna=changes" });
    // Nothing waiting but a failure: straight to the failed pieces.
    const onlyFailed = contentSummary(PIECES.filter((p) => p.status === "failed"), SCHEDULES, DEFAULT_PUBLISH_SETTINGS, NOW);
    expect(contentNeeds(onlyFailed, { approve: true, edit: true, handle: "carmen" })).toEqual({ count: 1, href: "/equipo/contenido?columna=failed" });
  });

  it("an empty board or a board that could not be read says 'No data yet', never 0", () => {
    const empty = card(overviewCards(overview("admin", { extras: extras(contentSummary([], [], DEFAULT_PUBLISH_SETTINGS, NOW)) })), "content")!;
    expect(empty.metrics[0]).toMatchObject({ key: "review", value: null });
    expect(empty.metrics[0]!.why).toMatch(/No piece on the board yet/);
    expect(metric(empty, "publishing")!.value).toBe("Off"); // the switch is a real fact even with no piece
    const unread = card(overviewCards(overview("specialist", { extras: extras(null) })), "content")!;
    expect(unread.metrics).toEqual([expect.objectContaining({ value: null, why: "The content board could not be read right now." })]);
    expect(unread.needsYou.count).toBeNull();
  });

  it("is never shown to sales, whatever the data says", () => {
    expect(card(overviewCards(overview("sales")), "content")).toBeUndefined();
  });

  it("works on the demo's own board", () => {
    const demo = buildDemoContent(NOW);
    const s = contentSummary(demo.pieces, demo.schedules, DEFAULT_PUBLISH_SETTINGS, NOW);
    expect(s.review.length).toBe(demo.pieces.filter((p) => p.status === "review").length);
    expect(s.changes.length).toBe(1);
    expect(s.failed).toEqual([]);
  });
});

describe("the Money card and the books: the accounting module's one money rule", () => {
  const snapshot = booksSnapshot(booksInput, NOW);

  it("the snapshot is the accounting module's own totals for this Texas month", () => {
    const t = totalsFor(booksInput, ["2026-12"]);
    expect(snapshot).toMatchObject({ month: "2026-12", netRevenueCents: t.netRevenueCents, expensesCents: t.expensesCents, netProfitCents: t.netProfitCents, hasData: t.hasData });
    expect(snapshot.otherCostsCents).toBe(t.feesCents + t.partnerCommissionsCents);
    // The numbers add up the way the Accounting dashboard says.
    expect(snapshot.netRevenueCents + t.otherIncomeCents - snapshot.expensesCents - snapshot.otherCostsCents).toBe(snapshot.netProfitCents);
  });

  it("the owner sees net revenue, expenses and net profit, and a link to Accounting", () => {
    const money = card(overviewCards(overview("admin", { books: snapshot })), "money")!;
    expect(money.metrics.map((m) => m.key)).toEqual(["collected", "failed", "pending", "net_revenue", "expenses", "profit"]);
    expect(metric(money, "profit")!.value).toMatch(/^-?\$[\d,]+\.\d{2}$/);
    expect(money.link).toEqual({ href: "/equipo/contabilidad", label: "Open Accounting" });
    // Nothing in the books this month: "No data yet", not $0.00.
    const none = card(overviewCards(overview("admin", { books: { ...snapshot, hasData: false } })), "money")!;
    expect(metric(none, "net_revenue")).toMatchObject({ value: null });
    expect(metric(none, "profit")).toBeUndefined();
  });

  it("everyone else keeps today's Money card; sales never sees money at all", () => {
    const specialist = card(overviewCards(overview("specialist", { books: snapshot })), "money")!;
    expect(specialist.metrics.map((m) => m.key)).toEqual(["collected", "failed", "pending"]);
    expect(specialist.link).toBeUndefined();
    expect(card(overviewCards(overview("specialist")), "money")).toEqual(specialist);
    expect(card(overviewCards(overview("sales", { books: snapshot })), "money")).toBeUndefined();
    const salesText = JSON.stringify(overviewCards(overview("sales", { books: snapshot })));
    expect(salesText).not.toMatch(/\$\d/);
  });
});

describe("what the books ask of the owner", () => {
  const expense = (id: string, over: Partial<Expense>): Expense => ({
    id,
    spentOn: "2026-11-20",
    amountCents: 12_000,
    category: "software",
    vendor: "Vendor",
    description: "",
    paymentMethod: "business_card",
    source: "manual",
    recurringId: null,
    importId: null,
    bankFingerprint: null,
    adjustsMonth: null,
    receipt: null,
    voidedAt: null,
    voidReason: null,
    createdBy: "carmen",
    createdAt: "2026-11-20T12:00:00.000Z",
    ...over,
  });
  const input = (expenses: Expense[]): BooksInput => ({ facts: [], expenses, otherIncome: [], commissions: [], collectionActions: [] });
  const closed = (month: string): MonthClose => ({ month, closedAt: "2026-12-02T12:00:00.000Z", closedBy: "carmen", totals: {} as MonthClose["totals"], note: "" });

  it("a month with something in it, over, past the 5th of the next, and not closed", () => {
    const expenses = [expense("e-nov", {}), expense("e-oct", { spentOn: "2026-10-12" })];
    expect(booksDue({ closes: [], expenses }, input(expenses), NOW).unclosed).toEqual(["2026-10", "2026-11"]);
    expect(booksDue({ closes: [closed("2026-10")], expenses }, input(expenses), NOW).unclosed).toEqual(["2026-11"]);
    // On the 5th, last month is not late yet; the month before it is.
    const fifth = new Date("2026-12-05T20:00:00.000Z");
    expect(booksDue({ closes: [], expenses }, input(expenses), fifth).unclosed).toEqual(["2026-10"]);
    // A month with nothing in it is not asked for.
    expect(booksDue({ closes: [], expenses: [] }, input([]), NOW).unclosed).toEqual([]);
  });

  it("receipts missing on expenses of $75 or more in the last 90 days, the largest named", () => {
    const expenses = [
      expense("big", { amountCents: 50_000, vendor: "Surety bond" }),
      expense("at", { amountCents: RECEIPT_THRESHOLD_CENTS }),
      expense("small", { amountCents: RECEIPT_THRESHOLD_CENTS - 1 }),
      expense("kept", { receipt: { name: "r.pdf", kind: "pdf", bytes: 1, ref: "", uploadedAt: "2026-11-21T00:00:00.000Z" } }),
      expense("void", { voidedAt: "2026-11-22T00:00:00.000Z", voidReason: "dup" }),
      expense("adj", { source: "adjustment", adjustsMonth: "2026-10", spentOn: "2026-10-30" }),
      expense("old", { spentOn: "2026-08-01" }),
    ];
    const r = booksDue({ closes: [], expenses }, input(expenses), NOW).receipts;
    expect(r).toMatchObject({ count: 2, cents: 50_000 + RECEIPT_THRESHOLD_CENTS, month: "2026-11", largest: { vendor: "Surety bond", cents: 50_000 } });
  });
});

describe("Today: Content and Accounting items, by permission, ranked with the rest", () => {
  const base = (role: StaffRole, over: Partial<TodayInput> = {}): TodayInput => ({
    queue: queueFor(role),
    leads: can(role, "leads.work") ? buildDemoLeads(NOW) : null,
    content: can(role, "content.view") ? { summary: SUMMARY, viewer: { approve: can(role, "content.approve"), edit: can(role, "content.edit"), handle: HANDLE[role] } } : null,
    books: can(role, "accounting") ? booksDue(demoBook, booksInput, NOW) : null,
    now: NOW,
    locale: "en",
    ...over,
  });
  const kinds = (items: ReturnType<typeof todayList>) => new Set(items.map((i) => i.kind));

  it("an approver gets 'approve this piece' and the failed post with its reason; an editor their changes and the failed post", () => {
    const admin = todayList(base("admin"));
    expect(admin.filter((i) => i.kind === "content_review").map((i) => i.title)).toEqual(["Approve this piece: FCRA in 30 seconds", "Approve this piece: ITIN reel"]);
    const failed = admin.find((i) => i.kind === "content_failed")!;
    expect(failed).toMatchObject({ title: "A post failed: Myth: checking hurts (instagram)", detail: "The Instagram connection expired. Connect it again.", href: "/equipo/contenido/pieza/pc_failed" });
    expect(kinds(admin).has("content_changes")).toBe(false);
    const marta = todayList(base("specialist"));
    expect(new Set(marta.filter((i) => i.kind === "content_changes").map((i) => i.key))).toEqual(new Set(["content-changes:pc_changes_marta", "content-changes:pc_changes_free"]));
    expect(kinds(marta).has("content_review")).toBe(false);
    expect(kinds(marta).has("content_failed")).toBe(true);
  });

  it("sales gets nothing from Content or Accounting, a specialist nothing from Accounting", () => {
    const sales = todayList(base("sales"));
    expect([...kinds(sales)].filter((k) => k.startsWith("content") || k.startsWith("books"))).toEqual([]);
    expect([...kinds(todayList(base("specialist")))].filter((k) => k.startsWith("books"))).toEqual([]);
  });

  it("the owner gets the month to close and the missing receipts, linked to the right tab and month", () => {
    const admin = todayList(base("admin"));
    const close = admin.filter((i) => i.kind === "books_close");
    expect(close.length).toBeGreaterThan(0);
    for (const item of close) expect(item.href).toMatch(/^\/equipo\/contabilidad\?tab=reports&mes=\d{4}-\d{2}$/);
    expect(close[0]!.title).toMatch(/^Close the books for /);
    const receipts = admin.find((i) => i.kind === "books_receipts")!;
    expect(receipts.href).toMatch(/^\/equipo\/contabilidad\?tab=expenses&mes=\d{4}-\d{2}$/);
    expect(receipts.title).toMatch(/of \$75 or more without a receipt$/);
  });

  it("failed charges are not counted twice: the books add no payment item", () => {
    const withBooks = todayList(base("admin"));
    const without = todayList(base("admin", { books: null, content: null }));
    const extra = withBooks.filter((i) => !without.some((w) => w.key === i.key));
    expect(extra.every((i) => i.kind.startsWith("books") || i.kind.startsWith("content"))).toBe(true);
    expect(withBooks.filter((i) => i.kind === "queue").length).toBe(without.filter((i) => i.kind === "queue").length);
  });

  it("ranked sensibly: people waiting first, then a failed post, then an approval; every item has its steps", () => {
    const items = todayList(base("admin"));
    const rank = (kind: string) => {
      const at = items.findIndex((i) => i.kind === kind);
      expect(at, kind).toBeGreaterThanOrEqual(0);
      return at;
    };
    expect(rank("lead_handoff")).toBeLessThan(rank("content_failed"));
    expect(rank("lead_waiting")).toBeLessThan(rank("content_failed"));
    expect(rank("content_failed")).toBeLessThan(rank("books_close"));
    expect(rank("books_close")).toBeLessThan(rank("content_review"));
    expect(rank("content_review")).toBeLessThan(rank("books_receipts"));
    // A piece that has waited two days moves up.
    expect(items.find((i) => i.key === "content-review:pc_review1")!.priority).toBeGreaterThan(items.find((i) => i.key === "content-review:pc_review2")!.priority);
    for (const item of items) {
      expect(item.steps.length, item.key).toBeGreaterThanOrEqual(3);
      expect(item.doneWhen, item.key).toBeTruthy();
    }
    // Spanish too.
    const es = todayList(base("admin", { locale: "es" }));
    expect(es.find((i) => i.kind === "content_review")!.title).toMatch(/^Aprueba esta pieza: /);
    expect(es.find((i) => i.kind === "books_close")!.title).toMatch(/^Cierra los libros de /);
  });
});

describe("the departments strip: one tap to every department the member may open", () => {
  const tiles = (role: StaffRole) => {
    const input = overview(role, { books: role === "admin" ? booksSnapshot(booksInput, NOW) : null });
    const cards = overviewCards(input);
    const today = todayList({
      queue: input.queue,
      leads: input.leads,
      content: can(role, "content.view") ? { summary: SUMMARY, viewer: { approve: can(role, "content.approve"), edit: can(role, "content.edit"), handle: HANDLE[role] } } : null,
      books: can(role, "accounting") ? booksDue(demoBook, booksInput, NOW) : null,
      now: NOW,
      locale: "en",
    });
    return departmentTiles({ can: (c: Capability) => can(role, c), cards, today, locale: "en" });
  };

  it("by role", () => {
    expect(tiles("admin").map((t) => t.key)).toEqual(["leads", "clients", "content", "accounting", "partners", "reviews"]);
    expect(tiles("specialist").map((t) => t.key)).toEqual(["clients", "content", "reviews"]);
    expect(tiles("sales").map((t) => t.key)).toEqual(["leads", "clients", "content", "partners", "reviews"]);
  });

  it("each tile opens a screen the console's navigation offers that role; sales lands on the partner kit", () => {
    const nav = [...PRIMARY_NAV, ...MORE_NAV];
    for (const role of ["admin", "specialist", "sales"] as StaffRole[]) {
      for (const tile of tiles(role)) {
        const root = tile.href.startsWith("/equipo/contenido") ? "/equipo/contenido" : tile.href;
        const item = nav.find((n) => n.href === root);
        expect(item, tile.href).toBeDefined();
        expect(!item!.needs || can(role, item!.needs), `${role} ${tile.href}`).toBe(true);
      }
    }
    expect(tiles("sales").find((t) => t.key === "content")!.href).toBe("/equipo/contenido/socios");
    expect(tiles("specialist").find((t) => t.key === "content")!.href).toBe("/equipo/contenido");
  });

  it("carries what needs the member there", () => {
    const admin = tiles("admin");
    expect(admin.find((t) => t.key === "content")!.count).toBe(3);
    expect(admin.find((t) => t.key === "accounting")!.count).toBeGreaterThan(0);
    expect(admin.find((t) => t.key === "reviews")!.count).toBeNull();
  });

  it("Content and Accounting come first under More; the top bar keeps its five tabs", () => {
    expect(MORE_NAV.slice(0, 2).map((n) => n.href)).toEqual(["/equipo/contenido", "/equipo/contabilidad"]);
    expect(PRIMARY_NAV).toHaveLength(5);
  });

  it("both languages, and no Spanish in the English", () => {
    expect(Object.keys(DEPARTMENT_LABELS.en)).toEqual(Object.keys(DEPARTMENT_LABELS.es));
    for (const label of Object.values(DEPARTMENT_LABELS.en)) expect(label).not.toMatch(/[áéíóúñ]|Clientes|Contenido|Socios/);
  });
});
