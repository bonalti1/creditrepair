import { ACTOR_LABELS, STAGE_TEXT, type Actor, type Severity, type Stage } from "@/lib/staff/stage";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { clientLanguage, LANGUAGE_NAME } from "@/lib/staff/i18n/locale";

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
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
      {aside}
    </div>
  );
}

const PRIMARY_LOOK =
  "pressable inline-flex items-center justify-center rounded-full bg-amber-400 font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY_LOOK =
  "pressable inline-flex items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-900 hover:bg-slate-200 disabled:text-slate-400";

/** The one gold button of a region: navy text on gold. */
export const PRIMARY_BUTTON = `${PRIMARY_LOOK} h-12 px-6 text-[16px]`;

/** A second action beside the gold button: same height, quiet colour. */
export const SECONDARY_BUTTON = `${SECONDARY_LOOK} h-12 px-5 text-[15px]`;

/** The same pair where two buttons share a narrow column, side by side. */
export const PRIMARY_BUTTON_COMPACT = `${PRIMARY_LOOK} h-12 whitespace-nowrap px-3 text-[14px]`;
export const SECONDARY_BUTTON_COMPACT = `${SECONDARY_LOOK} h-12 whitespace-nowrap px-3 text-[14px]`;

/** The fix for one row: clear, but not competing with the gold button. 44 px tall: a finger, not a mouse. */
export const ROW_BUTTON =
  "pressable inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full bg-blue-50 px-4 text-[14px] font-semibold text-blue-700 hover:bg-blue-100";

/** A text link or button that stands alone: 44 px tall on a phone, its own height on a laptop. */
export const TAP = "inline-flex min-h-11 items-center md:min-h-0";

/** Everything else. */
export const QUIET_BUTTON =
  "pressable inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium text-slate-600 hover:bg-slate-100";

/** A whole screen the viewer's role may not open, with the reason. */
export function NoAccess({ title, reason }: { title: string; reason: string }) {
  const t = useTx();
  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{title}</h1>
      <div className="card mt-5 max-w-xl px-5 py-5">
        <p className="text-[15px] leading-relaxed text-slate-700">{reason}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-500">
          {t("Si lo necesitas para tu trabajo, pídeselo a una persona administradora.", "If you need it for your work, ask an administrator.")}
        </p>
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
