"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { aiByline } from "@/lib/brand";
import { getIdeasData } from "@/lib/ideas/data";
import { resetDemoIdeas } from "@/lib/ideas/demo";
import { isLearning, type IdeasBody } from "@/lib/ideas/rules";
import { IDEAS_TEXT } from "@/lib/ideas/text";
import { IDEA_DEPARTMENTS, type Idea, type IdeaDepartment, type IdeasBoard } from "@/lib/ideas/types";
import { ago } from "@/lib/control/overview";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import { AltiWaveLoop, CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { IdeaCard, IdeaForm, Learnings, ProposalCard } from "@/components/staff/ideas/parts";
import { EmptyState, NoAccess, pillTab, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON } from "@/components/staff/ui";

// Ideas and experiments (docs/IDEAS.md): section 8 «Ideas & numbers», beside
// the business dashboard. Everyone on the team sees the board and adds ideas;
// an administrator approves, runs the test and decides (Keep or Drop, with
// what was learned). «Alti's proposals» (administrators): Alti, the AI
// assistant, reads the numbers the console already counts and proposes
// experiments that wait for a person; nothing is acted on by itself. The
// learnings library holds every finished test.

type View = "board" | "alti" | "learnings";
type Column = "new" | "approved" | "testing" | "results";
const COLUMNS: readonly Column[] = ["new", "approved", "testing", "results"];
const inColumn = (idea: Idea, c: Column) => (c === "results" ? isLearning(idea) || idea.status === "declined" : idea.status === c);

function IdeasScreen() {
  const { viewer, ready: viewerReady } = useViewer();
  const { locale } = useStaffLocale();
  const tx = useText(IDEAS_TEXT);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawView = params.get("vista");
  const view: View = rawView === "alti" ? "alti" : rawView === "aprendizajes" ? "learnings" : "board";
  const [board, setBoard] = useState<IdeasBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dept, setDept] = useState<IdeaDepartment | "all">("all");
  const [phoneColumn, setPhoneColumn] = useState<Column>("new");
  const [asking, setAsking] = useState(false);
  const data = useMemo(() => getIdeasData(viewer), [viewer]);
  const allowed = can(viewer?.role, "ideas.add");
  const admin = can(viewer?.role, "ideas.approve");

  const load = useCallback(async () => {
    try {
      setBoard(await data.load());
      setError(null);
    } catch {
      setError(IDEAS_TEXT[locale].errors.load);
    }
  }, [data, locale]);

  useEffect(() => {
    if (viewerReady && allowed) void load();
  }, [viewerReady, allowed, load]);

  if (!viewerReady) return null;
  if (!allowed) return <NoAccess title={tx.title} reason={deniedReason("ideas.add", locale)} />;

  const now = new Date();
  const errorText = (code: string) => (tx.errors as Record<string, string>)[code] ?? tx.errors.error;
  const act = async (body: IdeasBody): Promise<boolean> => {
    setNotice(null);
    const result = await data.act(body);
    if (!result.ok) setNotice(errorText(result.code));
    await load();
    return result.ok;
  };
  const setView = (v: View) => router.replace(v === "board" ? pathname : `${pathname}?vista=${v === "alti" ? "alti" : "aprendizajes"}`, { scroll: false });

  const ideas = board?.ideas ?? [];
  const visible = ideas.filter((i) => dept === "all" || i.department === dept);
  const open = board?.proposals?.filter((p) => p.status === "open") ?? [];
  const decided = board?.proposals?.filter((p) => p.status !== "open").slice(0, 10) ?? [];
  const lastRun = board?.runs?.[0] ?? null;

  const ask = async () => {
    setAsking(true);
    const before = open.length;
    const ok = await act({ action: "ask_alti" });
    setAsking(false);
    if (ok) {
      const fresh = await data.load().catch(() => null);
      const count = (fresh?.proposals?.filter((p) => p.status === "open").length ?? before) - before;
      if (count > 0) setNotice(tx.alti.newOnes(count));
    }
  };

  return (
    <main className="animate-rise min-w-0" data-testid="ideas-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{tx.title}</h1>
          <p className="mt-0.5 max-w-3xl text-[14px] text-slate-500">{tx.subtitle}</p>
        </div>
        {view === "board" && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5`} data-testid="idea-add-open">
            <Icon name="plus" size={16} />
            {tx.add.open}
          </button>
        )}
      </div>
      {data.demo && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] bg-amber-100 px-3 py-2 text-[13px] leading-snug text-blue-900" data-testid="ideas-sample">
          {tx.sampleBanner}
          <button
            type="button"
            className={`${QUIET_BUTTON} h-9 px-2 text-[12.5px] text-blue-900`}
            onClick={() => {
              resetDemoIdeas();
              void load();
            }}
          >
            {tx.reset}
          </button>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={tx.title}>
        {(["board", "alti", "learnings"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={pillTab(view === v)} data-testid={`ideas-tab-${v}`}>
            {tx.tabs[v]}
            {v === "alti" && open.length > 0 && <span className="ml-1 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11.5px] text-white tabular-nums">{open.length}</span>}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 rounded-[10px] bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {notice && (
        <p className="mt-4 rounded-[10px] bg-blue-50 px-3 py-2 text-[13.5px] text-blue-900" role="status" data-testid="ideas-notice">
          {notice}
        </p>
      )}

      {board && view === "board" && (
        <div className="mt-5">
          {adding && (
            <div className="mb-5">
              <IdeaForm
                ideas={ideas}
                onCancel={() => setAdding(false)}
                onSave={async (words) => {
                  const ok = await act({ action: "add", ...words });
                  if (ok) {
                    setAdding(false);
                    setNotice(tx.add.saved);
                    setPhoneColumn("new");
                  }
                  return ok;
                }}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="ideas-dept">
              {tx.add.departmentLabel}
            </label>
            <select id="ideas-dept" value={dept} onChange={(e) => setDept(e.target.value as IdeaDepartment | "all")} className="h-11 rounded-full border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-700 md:h-10" data-testid="ideas-dept">
              <option value="all">{tx.filterAll}</option>
              {IDEA_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {tx.departments[d]}
                </option>
              ))}
            </select>
            {!admin && <p className="text-[13px] text-slate-500">{tx.actions.onlyAdmins}</p>}
          </div>

          {/* On a phone: one column at a time. */}
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden" role="group" aria-label={tx.tabs.board}>
            {COLUMNS.map((c) => (
              <button key={c} type="button" aria-pressed={phoneColumn === c} onClick={() => setPhoneColumn(c)} className={pillTab(phoneColumn === c)} data-testid={`ideas-col-pill-${c}`}>
                {tx.columns[c]} · {visible.filter((i) => inColumn(i, c)).length}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-4" data-testid="ideas-board">
            {COLUMNS.map((c) => {
              const list = visible.filter((i) => inColumn(i, c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
              return (
                <section key={c} className={`min-w-0 ${phoneColumn === c ? "" : "hidden lg:block"}`} aria-labelledby={`col-${c}`} data-testid={`ideas-col-${c}`}>
                  <h2 id={`col-${c}`} className="console-label flex items-center justify-between px-1 pb-2">
                    {tx.columns[c]}
                    <span className="tabular-nums text-slate-500">{list.length}</span>
                  </h2>
                  {list.length === 0 ? (
                    <div className="card">
                      <EmptyState pose={c === "results" ? "thinking" : "thumbsUp"} title={tx.columns[c]}>
                        {tx.empty[c]}
                      </EmptyState>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {list.map((idea) => (
                        <SafeBoundary key={idea.id}>
                          <IdeaCard idea={idea} ideas={ideas} viewer={viewer} me={board.me} now={now} act={act} />
                        </SafeBoundary>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {board && view === "alti" && (
        <div className="mt-5">
          {!admin ? (
            <div className="card px-5 py-4 text-[14px] text-slate-700">{tx.alti.onlyAdmins}</div>
          ) : (
            <>
              <section className="relative overflow-hidden rounded-[14px] bg-blue-900 text-white shadow-[0_6px_20px_rgba(18,33,58,0.12)]" data-testid="alti-ideas" aria-labelledby="alti-ideas-title">
                <div className="flex items-stretch gap-4 px-5 pt-5 md:px-6">
                  <AltiWaveLoop height={150} decorative className="-mb-px hidden shrink-0 self-end sm:block" />
                  <div className="min-w-0 flex-1 pb-5">
                    <div className="flex items-center gap-2">
                      <CharacterAvatar character="assistant" size={30} tone="ivory" decorative className="sm:hidden" />
                      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-amber-300" data-on-navy>
                        {aiByline(locale)}
                      </p>
                    </div>
                    <h2 id="alti-ideas-title" className="mt-1 font-display text-[20px] font-semibold leading-tight text-white">
                      {tx.alti.title}
                    </h2>
                    <p className="mt-1 text-[14px] leading-snug text-blue-100">{tx.alti.intro}</p>
                    <p className="mt-2 text-[13px] leading-snug text-blue-200">{tx.alti.rules}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button type="button" onClick={ask} disabled={asking || board.altiConnected === false} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5`} data-testid="alti-ask">
                        <Icon name="sparkle" size={16} />
                        {asking ? tx.alti.asking : tx.alti.ask}
                      </button>
                      {lastRun && (
                        <span className="text-[12.5px] text-blue-100" data-testid="alti-last-run">
                          {tx.alti.lastRun(ago(lastRun.createdAt, now, locale), lastRun.proposed)}
                          {lastRun.trigger === "cron" ? ` · ${tx.alti.weekly}` : ""}
                        </span>
                      )}
                    </div>
                    {board.altiConnected === false && (
                      <p className="mt-3 rounded-[10px] bg-white/10 px-3 py-2 text-[13px] leading-snug text-white" data-testid="alti-not-connected">
                        {tx.alti.notConnected}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {data.demo && <p className="mt-3 px-1 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">{tx.alti.sample}</p>}
              {open.length === 0 ? (
                <div className="card mt-4">
                  <EmptyState pose="thinking" title={tx.alti.title}>
                    {tx.alti.none}
                  </EmptyState>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2" data-testid="alti-proposals">
                  {open.map((p) => (
                    <SafeBoundary key={p.id}>
                      <ProposalCard proposal={p} act={act} />
                    </SafeBoundary>
                  ))}
                </div>
              )}
              {decided.length > 0 && (
                <details className="mt-5">
                  <summary className="flex min-h-11 cursor-pointer items-center px-1 text-[13.5px] font-semibold text-blue-700">{tx.alti.history}</summary>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
                    {decided.map((p) => (
                      <ProposalCard key={p.id} proposal={p} act={act} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {board && view === "learnings" && (
        <div className="mt-5">
          <Learnings ideas={ideas} />
        </div>
      )}
    </main>
  );
}

export default function IdeasPage() {
  return (
    <Suspense fallback={null}>
      <IdeasScreen />
    </Suspense>
  );
}
