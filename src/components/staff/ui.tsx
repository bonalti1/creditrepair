import { ACTOR_LABEL, STAGES, type Actor, type Severity, type Stage } from "@/lib/staff/stage";

// Small pieces the staff screens share. Colour says whose move it is:
// gold = the client, navy = the team or sales, green = the system, grey = on
// hold. Text on gold is navy, as everywhere in the brand: gold text on a pale
// gold chip is too faint to read at this size.

/** A soft gold chip or box: waiting on the client, or something missing. */
export const WAITING_TONE = "bg-amber-100 text-blue-900";

const ACTOR_TONE: Record<Actor, string> = {
  client: WAITING_TONE,
  staff: "bg-blue-50 text-blue-700",
  sales: "bg-blue-50 text-blue-700",
  system: "bg-green-50 text-green-700",
};

export function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {children}
    </span>
  );
}

export function StageChip({ stage }: { stage: Stage }) {
  const tone = stage === "paused" ? "bg-slate-100 text-slate-600" : ACTOR_TONE[STAGES[stage].actor];
  return <Chip tone={tone}>{STAGES[stage].label}</Chip>;
}

/** "El cliente", "El equipo", "Ventas" or "El sistema": who makes the next move. */
export function ActorTag({ actor }: { actor: Actor }) {
  return <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ACTOR_LABEL[actor]}</span>;
}

const SEVERITY: Record<Severity, { dot: string; label: string }> = {
  high: { dot: "bg-red-500", label: "Urgente" },
  medium: { dot: "bg-amber-500", label: "Importante" },
  low: { dot: "bg-slate-400", label: "Menor" },
};

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span className={`mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY[severity].dot}`} title={SEVERITY[severity].label}>
      <span className="sr-only">{SEVERITY[severity].label}</span>
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 px-1 pb-2">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
      {aside}
    </div>
  );
}

/** The one gold button of a region: navy text on gold. */
export const PRIMARY_BUTTON =
  "pressable inline-flex h-12 items-center justify-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";

/** The fix for one row: clear, but not competing with the gold button. */
export const ROW_BUTTON =
  "pressable inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full bg-blue-50 px-4 text-[14px] font-semibold text-blue-700 hover:bg-blue-100";

/** Everything else. */
export const QUIET_BUTTON =
  "pressable inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium text-slate-600 hover:bg-slate-100";
