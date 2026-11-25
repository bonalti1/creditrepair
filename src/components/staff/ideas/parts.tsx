"use client";

import { useMemo, useState } from "react";
import { aiByline } from "@/lib/brand";
import { similarTitles } from "@/lib/ideas/check";
import { MIN_LEARNING_CHARS, actionRefusal, isLearning, searchLearnings, testDaysLeft, testIsDue, type IdeasBody } from "@/lib/ideas/rules";
import { formatSignal, IDEA_METRICS, IDEA_METRIC_LABELS, metricLabel, OTHER_METRIC } from "@/lib/ideas/signals";
import { IDEAS_TEXT } from "@/lib/ideas/text";
import { IDEA_DEPARTMENTS, IDEA_EFFORTS, TEST_DAYS_MAX, TEST_DAYS_MIN, type Idea, type IdeaDepartment, type IdeaEffort, type IdeaProposal } from "@/lib/ideas/types";
import { shortDay } from "@/lib/staff/format";
import { useStaffLocale, useText } from "@/lib/staff/i18n/StaffLocale";
import type { Viewer } from "@/lib/staff/permissions";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { Chip, GOLD_ROW_BUTTON, PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";

// The pieces of the Ideas screen (/equipo/ideas): an idea card with the
// actions the member's role may take (rules.ts decides), the form to add or
// edit an idea, Alti's proposal cards with the numbers each is based on, and
// the learnings library. Every word comes from src/lib/ideas/text.ts.

export type Act = (body: IdeasBody) => Promise<boolean>;

const FIELD = "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-blue-700";

export const STATUS_TONE: Record<Idea["status"], string> = {
  new: "bg-blue-50 text-blue-700",
  approved: "bg-amber-100 text-blue-900",
  testing: "bg-blue-900 text-white",
  kept: "bg-green-50 text-green-800",
  dropped: "bg-slate-100 text-slate-700",
  declined: "bg-slate-100 text-slate-600",
};

function MetricSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const { locale } = useStaffLocale();
  const keys = [...Object.keys(IDEA_METRICS), OTHER_METRIC];
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} h-11`}>
      {keys.map((k) => (
        <option key={k} value={k}>
          {IDEA_METRIC_LABELS[locale][k]}
        </option>
      ))}
    </select>
  );
}

/** Add an idea (or edit one that is still new). Shows similar ideas already on the board before adding a repeat. */
export function IdeaForm({ ideas, initial, onSave, onCancel }: { ideas: readonly Idea[]; initial?: Idea; onSave: (words: { title: string; why: string; department: IdeaDepartment; metric: string; expectedEffect: string; effort: IdeaEffort }) => Promise<boolean>; onCancel: () => void }) {
  const tx = useText(IDEAS_TEXT);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [why, setWhy] = useState(initial?.why ?? "");
  const [department, setDepartment] = useState<IdeaDepartment>(initial?.department ?? "leads");
  const [metric, setMetric] = useState(initial?.metric ?? "lead_first_reply");
  const [effect, setEffect] = useState(initial?.expectedEffect ?? "");
  const [effort, setEffort] = useState<IdeaEffort>(initial?.effort ?? "S");
  const [saving, setSaving] = useState(false);
  const similar = useMemo(() => (initial ? [] : similarTitles(title, ideas)), [title, ideas, initial]);
  const valid = title.trim().length >= 3 && why.trim().length >= 10 && effect.trim().length >= 3;
  const prefix = initial ? `edit-${initial.id}` : "add";
  return (
    <form
      className="card space-y-3 px-5 py-4"
      data-testid="idea-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setSaving(true);
        const ok = await onSave({ title: title.trim(), why: why.trim(), department, metric, expectedEffect: effect.trim(), effort });
        setSaving(false);
        if (ok && !initial) {
          setTitle("");
          setWhy("");
          setEffect("");
        }
      }}
    >
      {!initial && <h2 className="console-label">{tx.add.title}</h2>}
      <label className="block">
        <span className="text-[13px] font-semibold text-slate-700">{tx.add.titleLabel}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={tx.add.titlePlaceholder} className={`${FIELD} mt-1 h-11`} required data-testid={`${prefix}-title`} />
      </label>
      {similar.length > 0 && (
        <div className="rounded-[10px] bg-amber-100 px-3 py-2 text-[13px] text-blue-900" data-testid="idea-similar">
          <p className="font-semibold">{tx.add.similar}</p>
          <ul className="mt-1 list-disc pl-5">
            {similar.slice(0, 3).map((s) => (
              <li key={s.id}>
                {s.title} · {tx.statuses[s.status]}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="block">
        <span className="text-[13px] font-semibold text-slate-700">{tx.add.whyLabel}</span>
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} rows={3} className={`${FIELD} mt-1 py-2`} required data-testid={`${prefix}-why`} />
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-700">{tx.add.departmentLabel}</span>
          <select value={department} onChange={(e) => setDepartment(e.target.value as IdeaDepartment)} className={`${FIELD} mt-1 h-11`}>
            {IDEA_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {tx.departments[d]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <label htmlFor={`${prefix}-metric`} className="text-[13px] font-semibold text-slate-700">
            {tx.add.metricLabel}
          </label>
          <div className="mt-1">
            <MetricSelect id={`${prefix}-metric`} value={metric} onChange={setMetric} />
          </div>
        </div>
      </div>
      <label className="block">
        <span className="text-[13px] font-semibold text-slate-700">{tx.add.effectLabel}</span>
        <input value={effect} onChange={(e) => setEffect(e.target.value)} maxLength={200} placeholder={tx.add.effectPlaceholder} className={`${FIELD} mt-1 h-11`} required data-testid={`${prefix}-effect`} />
      </label>
      <fieldset>
        <legend className="text-[13px] font-semibold text-slate-700">{tx.add.effortLabel}</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {IDEA_EFFORTS.map((e) => (
            <button key={e} type="button" aria-pressed={effort === e} onClick={() => setEffort(e)} className={`pressable inline-flex h-11 items-center rounded-full border px-4 text-[14px] font-semibold md:h-10 ${effort === e ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-amber-500"}`}>
              {e} · {tx.efforts[e]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={!valid || saving} className={PRIMARY_BUTTON_COMPACT} data-testid={`${prefix}-save`}>
          {initial ? tx.edit.save : tx.add.save}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_COMPACT}>
          {tx.add.cancel}
        </button>
      </div>
    </form>
  );
}

type Pending = null | "decline" | "start" | "keep" | "drop" | "edit";

/** One idea on the board, with the next step the member's role may take. */
export function IdeaCard({ idea, ideas, viewer, me, now, act }: { idea: Idea; ideas: readonly Idea[]; viewer: Viewer | null; me: string | null; now: Date; act: Act }) {
  const tx = useText(IDEAS_TEXT);
  const { locale } = useStaffLocale();
  const [pending, setPending] = useState<Pending>(null);
  const [text, setText] = useState("");
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  // `me`: the member's own id as the board knows it (their user id; in the demo, their handle).
  const may = (a: Parameters<typeof actionRefusal>[0]) => actionRefusal(a, idea, { role: viewer?.role ?? null, userId: me }) === null;
  const left = testDaysLeft(idea, now);
  const due = testIsDue(idea, now);
  const run = async (body: IdeasBody) => {
    setBusy(true);
    const ok = await act(body);
    setBusy(false);
    if (ok) {
      setPending(null);
      setText("");
    }
  };

  if (pending === "edit") {
    return <IdeaForm ideas={ideas} initial={idea} onCancel={() => setPending(null)} onSave={async (w) => act({ action: "edit", id: idea.id, ...w }).then((ok) => (ok && setPending(null), ok))} />;
  }

  return (
    <article className="card px-4 py-3.5" data-testid={`idea-${idea.id}`} data-status={idea.status} aria-labelledby={`idea-title-${idea.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="bg-slate-100 text-slate-700">{tx.departments[idea.department]}</Chip>
        <Chip tone="bg-white text-slate-600 ring-1 ring-slate-200">{tx.effortLabel(tx.efforts[idea.effort])}</Chip>
        {(isLearning(idea) || idea.status === "declined") && <Chip tone={STATUS_TONE[idea.status]}>{tx.statuses[idea.status]}</Chip>}
        {idea.source === "alti" && <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-blue-700">{tx.fromAlti}</span>}
      </div>
      <h3 id={`idea-title-${idea.id}`} className="mt-2 text-[15.5px] font-semibold leading-snug text-slate-900">
        {idea.title}
      </h3>
      <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{idea.why}</p>
      <dl className="mt-2 space-y-0.5 text-[13px]">
        <div>
          <dt className="inline font-semibold text-slate-700">{tx.watch}: </dt>
          <dd className="inline text-slate-700">{metricLabel(idea.metric, locale)}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-slate-700">{tx.expected}: </dt>
          <dd className="inline text-slate-700">{idea.expectedEffect}</dd>
        </div>
        {idea.resultNote && (
          <div className="mt-1.5 rounded-[10px] bg-slate-50 px-3 py-2">
            <dt className="font-semibold text-slate-800">{idea.status === "declined" ? tx.notNowWhy : tx.learned}</dt>
            <dd className="text-slate-700">{idea.resultNote}</dd>
          </div>
        )}
      </dl>
      {idea.status === "testing" && left !== null && (
        <p className={`mt-2 text-[13px] font-semibold ${due ? "text-red-700" : "text-blue-900"}`} data-testid="idea-days-left">
          {idea.testDays ? `${tx.testLength(idea.testDays)} · ` : ""}
          {due ? tx.testOver : tx.daysLeft(left)}
        </p>
      )}
      <p className="mt-2 text-[12px] text-slate-500">
        {tx.by(idea.createdByName || "—")} · {shortDay(idea.createdAt, locale)}
        {idea.approvedByName ? ` · ${tx.approvedBy(idea.approvedByName)}` : ""}
        {idea.decidedByName && idea.decidedAt ? ` · ${tx.decidedBy(idea.decidedByName)}, ${shortDay(idea.decidedAt, locale)}` : ""}
      </p>

      {pending === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {may("approve") && (
            <button type="button" disabled={busy} onClick={() => run({ action: "approve", id: idea.id })} className={GOLD_ROW_BUTTON} data-testid={`approve-${idea.id}`}>
              {tx.actions.approve}
            </button>
          )}
          {may("start") && (
            <button type="button" onClick={() => setPending("start")} className={GOLD_ROW_BUTTON} data-testid={`start-${idea.id}`}>
              {tx.actions.start}
            </button>
          )}
          {may("keep") && (
            <button type="button" onClick={() => setPending("keep")} className={due ? GOLD_ROW_BUTTON : ROW_BUTTON} data-testid={`keep-${idea.id}`}>
              {tx.actions.keep}
            </button>
          )}
          {may("drop") && (
            <button type="button" onClick={() => setPending("drop")} className={ROW_BUTTON} data-testid={`drop-${idea.id}`}>
              {tx.actions.drop}
            </button>
          )}
          {may("decline") && (
            <button type="button" onClick={() => setPending("decline")} className={QUIET_BUTTON} data-testid={`decline-${idea.id}`}>
              {tx.actions.decline}
            </button>
          )}
          {may("edit") && (
            <button type="button" onClick={() => setPending("edit")} className={QUIET_BUTTON} data-testid={`edit-${idea.id}`}>
              {tx.edit.open}
            </button>
          )}
        </div>
      )}

      {pending === "start" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "start", id: idea.id, testDays: days });
          }}
        >
          <label className="block">
            <span className="text-[13px] font-semibold text-slate-700">{tx.actions.testDays}</span>
            <input type="number" min={TEST_DAYS_MIN} max={TEST_DAYS_MAX} value={days} onChange={(e) => setDays(Math.max(TEST_DAYS_MIN, Math.min(TEST_DAYS_MAX, Number(e.target.value) || TEST_DAYS_MIN)))} className={`${FIELD} mt-1 h-11 w-28`} data-testid={`days-${idea.id}`} />
          </label>
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON_COMPACT}>
            {tx.actions.confirm}
          </button>
          <button type="button" onClick={() => setPending(null)} className={SECONDARY_BUTTON_COMPACT}>
            {tx.actions.cancel}
          </button>
        </form>
      )}

      {(pending === "keep" || pending === "drop" || pending === "decline") && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(pending === "decline" ? { action: "decline", id: idea.id, note: text.trim() } : { action: pending, id: idea.id, learned: text.trim() });
          }}
        >
          <label className="block">
            <span className="text-[13px] font-semibold text-slate-700">{pending === "decline" ? tx.actions.declineNote : tx.actions.learnedLabel}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={pending === "decline" ? 500 : 2000} className={`${FIELD} mt-1 py-2`} data-testid={`note-${idea.id}`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || text.trim().length < (pending === "decline" ? 3 : MIN_LEARNING_CHARS)} className={PRIMARY_BUTTON_COMPACT} data-testid={`confirm-${idea.id}`}>
              {pending === "keep" ? tx.actions.keep : pending === "drop" ? tx.actions.drop : tx.actions.decline}
            </button>
            <button type="button" onClick={() => setPending(null)} className={SECONDARY_BUTTON_COMPACT}>
              {tx.actions.cancel}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

/** One of Alti's proposals: its words, the numbers it is based on (filled in by the server), and the decision. */
export function ProposalCard({ proposal, act }: { proposal: IdeaProposal; act: Act }) {
  const tx = useText(IDEAS_TEXT);
  const { locale } = useStaffLocale();
  const [busy, setBusy] = useState(false);
  const run = async (body: IdeasBody) => {
    setBusy(true);
    await act(body);
    setBusy(false);
  };
  return (
    <article className="card px-5 py-4" data-testid={`proposal-${proposal.id}`} data-status={proposal.status}>
      <div className="flex items-center gap-2">
        <CharacterAvatar character="assistant" size={28} tone="navy" decorative />
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-blue-700">{aiByline(locale)}</p>
        {proposal.status !== "open" && <Chip tone={proposal.status === "added" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}>{proposal.status === "added" ? tx.alti.added : tx.alti.dismissed}</Chip>}
      </div>
      <h3 className="mt-2 text-[16px] font-semibold leading-snug text-slate-900">{proposal.title}</h3>
      <p className="mt-1 text-[14px] leading-snug text-slate-700">{proposal.why}</p>
      <div className="mt-3">
        <p className="console-label text-[11.5px] text-slate-500">{tx.alti.basedOn}</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="proposal-based-on">
          {proposal.basedOn.map((b) => (
            <li key={b.key} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-[12.5px] text-slate-700">
              {metricLabel(b.key, locale)}: <span className="font-semibold tabular-nums text-blue-900">{formatSignal(b.value, b.unit, locale)}</span>
            </li>
          ))}
        </ul>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="console-label text-[11px] text-slate-500">{tx.alti.watch}</dt>
          <dd className="font-semibold text-slate-800">{metricLabel(proposal.metric, locale)}</dd>
        </div>
        <div>
          <dt className="console-label text-[11px] text-slate-500">{tx.alti.length}</dt>
          <dd className="font-semibold text-slate-800">{tx.testLength(proposal.testDays)}</dd>
        </div>
        <div>
          <dt className="console-label text-[11px] text-slate-500">{tx.add.effortLabel}</dt>
          <dd className="font-semibold text-slate-800">{tx.efforts[proposal.effort]}</dd>
        </div>
        <div className="min-w-0">
          <dt className="console-label text-[11px] text-slate-500">{tx.add.departmentLabel}</dt>
          <dd className="font-semibold text-slate-800">{tx.departments[proposal.department]}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[13px] text-slate-600">
        <span className="font-semibold text-slate-700">{tx.expected}: </span>
        {proposal.expectedEffect}
      </p>
      {proposal.status === "open" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run({ action: "add_proposal", id: proposal.id })} className={GOLD_ROW_BUTTON} data-testid={`add-proposal-${proposal.id}`}>
            <Icon name="plus" size={15} />
            <span className="ml-1">{tx.alti.addToBoard}</span>
          </button>
          <button type="button" disabled={busy} onClick={() => run({ action: "dismiss_proposal", id: proposal.id })} className={QUIET_BUTTON} data-testid={`dismiss-proposal-${proposal.id}`}>
            {tx.alti.dismiss}
          </button>
        </div>
      )}
    </article>
  );
}

/** The learnings library: finished tests, searched by words. */
export function Learnings({ ideas }: { ideas: readonly Idea[] }) {
  const tx = useText(IDEAS_TEXT);
  const { locale } = useStaffLocale();
  const [query, setQuery] = useState("");
  const all = useMemo(() => searchLearnings(ideas, ""), [ideas]);
  const found = useMemo(() => searchLearnings(ideas, query, (m) => metricLabel(m, locale)), [ideas, query, locale]);
  return (
    <section aria-labelledby="learnings-title" data-testid="learnings">
      <h2 id="learnings-title" className="console-label px-1">
        {tx.learnings.title}
      </h2>
      <p className="mt-1 px-1 text-[14px] leading-relaxed text-slate-600">{tx.learnings.intro}</p>
      <label className="mt-3 block max-w-lg">
        <span className="sr-only">{tx.learnings.search}</span>
        <span className="relative block">
          <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx.learnings.placeholder} aria-label={tx.learnings.search} className={`${FIELD} h-11 pl-9`} data-testid="learnings-search" />
        </span>
      </label>
      {all.length === 0 ? (
        <p className="mt-4 px-1 text-[14px] text-slate-600">{tx.learnings.none}</p>
      ) : found.length === 0 ? (
        <p className="mt-4 px-1 text-[14px] text-slate-600">{tx.learnings.noMatch}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {found.map((idea) => (
            <li key={idea.id} className="card px-5 py-4" data-testid={`learning-${idea.id}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone={STATUS_TONE[idea.status]}>{tx.statuses[idea.status]}</Chip>
                <Chip tone="bg-slate-100 text-slate-700">{tx.departments[idea.department]}</Chip>
                {idea.testDays && <span className="text-[12px] text-slate-500">{tx.learnings.tested(idea.testDays)}</span>}
              </div>
              <h3 className="mt-2 text-[15.5px] font-semibold leading-snug text-slate-900">{idea.title}</h3>
              <p className="mt-1 text-[13px] text-slate-600">
                <span className="font-semibold text-slate-700">{tx.watch}: </span>
                {metricLabel(idea.metric, locale)}
              </p>
              <p className="mt-2 rounded-[10px] bg-slate-50 px-3 py-2 text-[14px] leading-snug text-slate-800">
                <span className="font-semibold">{tx.learned}: </span>
                {idea.resultNote}
              </p>
              {idea.decidedAt && <p className="mt-2 text-[12px] text-slate-500">{tx.decidedBy(idea.decidedByName ?? "—")} · {shortDay(idea.decidedAt, locale)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
