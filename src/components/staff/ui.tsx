import { ACTOR_LABELS, STAGE_TEXT, type Actor, type Severity, type Stage } from "@/lib/staff/stage";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { clientLanguage, LANGUAGE_NAME } from "@/lib/staff/i18n/locale";
import type { AssistantPose } from "@/lib/brand";
import { CharacterFigure } from "@/components/Character";

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
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {/* ALTO's status pill: a dot in the pill's own colour before the word. */}
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}

export function StageChip({ stage }: { stage: Stage }) {
  const { locale } = useStaffLocale();
  const info = STAGE_TEXT[locale][stage];
  const tone = stage === "paused" || stage === "cancelled" ? "bg-slate-100 text-slate-600" : ACTOR_TONE[info.actor];
  return <Chip tone={tone}>{info.label}</Chip>;
}

/** "The client", "The team", "Sales" or "The system": who makes the next move. */
export function ActorTag({ actor }: { actor: Actor }) {
  const { locale } = useStaffLocale();
  return <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{ACTOR_LABELS[locale][actor]}</span>;
}

const SEVERITY: Record<Severity, { dot: string; label: { es: string; en: string } }> = {
  high: { dot: "bg-red-500", label: { es: "Urgente", en: "Urgent" } },
  medium: { dot: "bg-amber-500", label: { es: "Importante", en: "Important" } },
  low: { dot: "bg-slate-400", label: { es: "Menor", en: "Minor" } },
};

export function SeverityDot({ severity }: { severity: Severity }) {
  const { locale } = useStaffLocale();
  const label = SEVERITY[severity].label[locale];
  return (
    <span className={`mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY[severity].dot}`} title={label}>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Where a teammate writes to a client: which language the words go out in.
 * The client's, never the console's: "Client's language: Spanish".
 */
export function ClientLanguageTag({ client, className = "" }: { client: { locale?: string | null }; className?: string }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const language = clientLanguage(client);
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 ${className}`} data-testid="client-language" data-language={language}>
      <span aria-hidden="true">🌐</span>
      {t("Idioma del cliente:", "Client's language:")} <span className="font-semibold text-slate-700">{LANGUAGE_NAME[locale][language]}</span>
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 px-1 pb-2">
      <h2 className="console-label">{children}</h2>
      {aside}
    </div>
  );
}

// ALTO Control's buttons: 10px corners; the gold one with navy text, the others white with a line that turns gold on hover.
const PRIMARY_LOOK =
  "pressable inline-flex items-center justify-center rounded-[10px] bg-amber-400 font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY_LOOK =
  "pressable inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white font-semibold text-slate-900 hover:border-amber-500 hover:bg-slate-50 disabled:text-slate-400";

/** The one gold button of a region: navy text on gold. */
export const PRIMARY_BUTTON = `${PRIMARY_LOOK} h-12 px-6 text-[16px]`;

/** A second action beside the gold button: same height, quiet colour. */
export const SECONDARY_BUTTON = `${SECONDARY_LOOK} h-12 px-5 text-[15px]`;

/** The same pair where two buttons share a narrow column, side by side. */
export const PRIMARY_BUTTON_COMPACT = `${PRIMARY_LOOK} h-12 whitespace-nowrap px-3 text-[14px]`;
export const SECONDARY_BUTTON_COMPACT = `${SECONDARY_LOOK} h-12 whitespace-nowrap px-3 text-[14px]`;

/** The fix for one row: clear, but not competing with the gold button. 44 px tall: a finger, not a mouse. */
export const ROW_BUTTON =
  "pressable inline-flex h-11 items-center justify-center whitespace-nowrap rounded-[10px] border border-slate-300 bg-white px-4 text-[14px] font-semibold text-blue-900 hover:border-amber-500 hover:bg-slate-50";

/** The one gold action of a row (approve, mark as done): navy text on gold, the same size as ROW_BUTTON. */
export const GOLD_ROW_BUTTON =
  "pressable inline-flex h-11 items-center justify-center whitespace-nowrap rounded-[10px] bg-amber-400 px-4 text-[14px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";

/** A text link or button that stands alone: 44 px tall on a phone, its own height on a laptop. */
export const TAP = "inline-flex min-h-11 items-center md:min-h-0";

/** A tab or filter chip (ALTO Control's sub-tabs and chips): navy when on, white with a line when off. 44 px on a phone. */
export function pillTab(on: boolean): string {
  return `pressable inline-flex h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[14px] font-semibold md:h-10 ${
    on ? "border-blue-900 bg-blue-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-amber-500 hover:text-slate-900"
  }`;
}

/** Everything else. */
export const QUIET_BUTTON =
  "pressable inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[14px] font-medium text-slate-600 hover:bg-slate-100";

/** A whole screen the viewer's role may not open, with the reason. */
export function NoAccess({ title, reason }: { title: string; reason: string }) {
  const t = useTx();
  return (
    <main className="animate-rise">
      <h1 className="page-title">{title}</h1>
      <div className="card mt-5 flex max-w-xl items-center gap-4 px-5 py-5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-relaxed text-slate-700">{reason}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-slate-500">
            {t("Si lo necesitas para tu trabajo, pídeselo a una persona administradora.", "If you need it for your work, ask an administrator.")}
          </p>
        </div>
      </div>
    </main>
  );
}

/** One quiet line where a control would be, saying why the viewer does not have it. */
export function DeniedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-snug text-slate-500" data-testid="denied-note">
      <span aria-hidden="true" className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
      <span>{children}</span>
    </p>
  );
}

/**
 * An empty state with Alti (ALTO's empty box, Credalti's way): a pose that
 * fits, a short title and what to do. Alti here is a picture beside words a
 * person wrote, so it carries no AI label of its own; it never speaks.
 */
export function EmptyState({
  pose = "thumbsUp",
  title,
  children,
  className = "",
  testId,
}: {
  pose?: AssistantPose;
  title: string;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-4 py-8 text-center ${className}`} data-testid={testId ?? "empty-state"}>
      <CharacterFigure character="assistant" pose={pose} height={132} decorative />
      <p className="mt-3 font-display text-[16px] font-semibold text-blue-900">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[14px] leading-snug text-slate-600">{children}</div>}
    </div>
  );
}
