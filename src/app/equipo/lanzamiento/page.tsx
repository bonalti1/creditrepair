"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LAUNCH_GROUPS, type ProbeService } from "@/lib/launch/checklist";
import { resetDemoLaunch } from "@/lib/launch/demo";
import { getLaunchData, type LaunchView } from "@/lib/launch/data";
import { LAUNCH_TEXT, type LaunchText } from "@/lib/launch/text";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import { HealthView, ItemRow, NextAndBlocked, SummaryBand } from "@/components/staff/launch/parts";
import SafeBoundary from "@/components/staff/control/SafeBoundary";
import { NoAccess, pillTab, QUIET_BUTTON, SectionTitle } from "@/components/staff/ui";

// Launch readiness (docs/LAUNCH.md), for the owner and administrators only
// (the capability `launch`; the route refuses everyone else again). One
// screen that says what is ready and what is missing to go live: the summary
// (N of M required items ready, the next three things, what is blocked by
// what), every item by group with who does it, why it matters and the next
// step, and the system health view. It never shows a key: only set or not
// set, "test" or "live", and times.

type View = "checklist" | "health";
type Filter = "all" | "todo" | "required";

function Launch() {
  const { viewer, ready: viewerReady } = useViewer();
  const { locale } = useStaffLocale();
  const tx = useText(LAUNCH_TEXT);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = params.get("vista") === "salud" ? "health" : "checklist";
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{ view: LaunchView | null; error: boolean }>({ view: null, error: false });
  const [probing, setProbing] = useState<ProbeService | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const allowed = can(viewer?.role, "launch");
  const data = useMemo(() => getLaunchData(viewer), [viewer]);

  const load = useCallback(async () => {
    try {
      setState({ view: await data.load(), error: false });
    } catch {
      setState((s) => ({ view: s.view, error: true }));
    }
  }, [data]);

  useEffect(() => {
    if (viewerReady && allowed) void load();
  }, [viewerReady, allowed, load]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#item-/, "");
    if (hash) setOpen(new Set([hash]));
  }, []);

  if (!viewerReady) return null;
  if (!allowed) return <NoAccess title={tx.title} reason={deniedReason("launch", locale)} />;

  const current = state.view;
  const now = new Date(current?.report.at ?? Date.now());

  const openItem = (key: string) => {
    setFilter("all");
    setOpen((s) => new Set(s).add(key));
    if (view !== "checklist") router.replace(pathname, { scroll: false });
    window.requestAnimationFrame(() => document.getElementById(`item-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const setView = (v: View) => router.replace(v === "health" ? `${pathname}?vista=salud` : pathname, { scroll: false });
  const onTick = async (item: string, done: boolean, note: string) => {
    await data.tick(item, done, note);
    await load();
  };
  const onProbe = async (service: ProbeService) => {
    setProbing(service);
    setMessage(null);
    const result = await data.probe(service);
    if (!result.ok) setMessage(result.code === "demo" ? tx.demoProbe : (tx.probeCodes[result.code as keyof LaunchText["probeCodes"]] ?? tx.probeCodes.error));
    setProbing(null);
    await load();
  };

  const items = current?.report.items ?? [];
  const shown = items.filter((i) => (filter === "todo" ? i.state !== "ready" : filter === "required" ? i.needed === "required" : true));

  return (
    <main className="animate-rise min-w-0" data-testid="launch-page">
      <div>
        <h1 className="page-title">{tx.title}</h1>
        <p className="mt-0.5 text-[14px] text-slate-500">{tx.subtitle}</p>
      </div>
      {data.demo && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] bg-amber-100 px-3 py-2 text-[13px] leading-snug text-blue-900" data-testid="launch-sample">
          {tx.sampleBanner}
          <button
            type="button"
            className={`${QUIET_BUTTON} h-9 px-2 text-[12.5px] text-blue-900`}
            onClick={() => {
              resetDemoLaunch();
              void load();
            }}
          >
            {tx.reset}
          </button>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={tx.title}>
        {(["checklist", "health"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={pillTab(view === v)} data-testid={`launch-tab-${v}`}>
            {tx.tabs[v]}
          </button>
        ))}
      </div>

      {state.error && !current && <p className="mt-5 rounded-[10px] bg-red-50 px-3 py-2 text-[14px] text-red-800">{tx.notes.db_unreadable}</p>}
      {message && (
        <p className="mt-4 rounded-[10px] bg-blue-50 px-3 py-2 text-[13.5px] text-blue-900" role="status">
          {message}
        </p>
      )}

      {current && view === "checklist" && (
        <div className="mt-5">
          <SafeBoundary>
            <SummaryBand report={current.report} />
          </SafeBoundary>
          <SafeBoundary>
            <NextAndBlocked report={current.report} onOpen={openItem} />
          </SafeBoundary>

          <div className="mt-6 flex flex-wrap gap-1.5" role="group" aria-label={tx.labels.filterAll}>
            {(["all", "todo", "required"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={pillTab(filter === f)} data-testid={`launch-filter-${f}`}>
                {f === "all" ? tx.labels.filterAll : f === "todo" ? tx.labels.filterTodo : tx.labels.filterRequired}
              </button>
            ))}
          </div>

          {LAUNCH_GROUPS.map((group) => {
            const list = shown.filter((i) => i.group === group);
            if (list.length === 0) return null;
            const all = items.filter((i) => i.group === group);
            const ready = all.filter((i) => i.state === "ready").length;
            return (
              <section key={group} className="mt-6" aria-labelledby={`group-${group}`} data-testid={`launch-group-${group}`}>
                <SectionTitle aside={<span className="text-[12.5px] font-semibold text-slate-500 tabular-nums">{tx.readyCount(ready, all.length)}</span>}>
                  <span id={`group-${group}`}>{tx.groups[group]}</span>
                </SectionTitle>
                <ul className="card overflow-hidden">
                  {list.map((item) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      now={now}
                      open={open.has(item.key)}
                      onToggle={() =>
                        setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(item.key)) next.delete(item.key);
                          else next.add(item.key);
                          return next;
                        })
                      }
                      onTick={(done, note) => onTick(item.key, done, note)}
                      onProbe={onProbe}
                      probing={probing !== null && probing === item.probe}
                      templatesListed={current.report.templatesListed}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {current && view === "health" && (
        <div className="mt-5">
          <SafeBoundary>
            <HealthView health={current.health} now={now} onProbe={onProbe} probing={probing} />
          </SafeBoundary>
        </div>
      )}
    </main>
  );
}

export default function LanzamientoPage() {
  return (
    <Suspense fallback={null}>
      <Launch />
    </Suspense>
  );
}
