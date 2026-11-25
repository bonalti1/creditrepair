"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CATEGORY_LABELS, getLetterMeta, LETTER_CATALOGUE, ORIGINAL_TEMPLATE_KEYS, type LetterMeta, type LetterRecipient } from "@/lib/letters/library";
import { CATEGORY_ORDER, sampleLetterContext } from "@/lib/letters/packet";
import { renderLetter } from "@/lib/letters/templates";
import { diffSources, diffStats, hasChanges } from "@/lib/letters/versions/diff";
import type { LetterVersionsData } from "@/lib/letters/versions/data";
import { allowedChips, chipText, isChipKey, normalizeSource, renderSource, TOKEN, type ChipKey, type LetterSource } from "@/lib/letters/versions/source";
import { validateLetterSource, type SourceProblem } from "@/lib/letters/versions/validate";
import {
  openDraft,
  resolveLetter,
  STATUS_LABEL,
  STATUS_LABEL_EN,
  versionsOf,
  type DecisionInput,
  type LetterVersion,
} from "@/lib/letters/versions/versions";
import { useLetterVersions } from "@/lib/letters/versions/useLetterVersions";
import { longDay, shortDateTime } from "@/lib/staff/format";
import { deniedReason } from "@/lib/staff/permissions";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
import Icon from "@/components/Icon";
import ChipEditor, { type ChipEditorHandle } from "@/components/staff/letters/ChipEditor";
import { DiffView, LetterPaper } from "@/components/staff/letters/LetterParts";
import { Chip, NoAccess, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON, SectionTitle, WAITING_TONE } from "@/components/staff/ui";

// Cartas: the letter editor. An administrator changes a letter here, without a
// developer; each change is a new version that goes to the attorney, and only
// an approved version is mailed (src/lib/letters/versions, docs/LETTERS-EDITOR.md).
//
//   /equipo/cartas                 every letter, grouped like the library, with
//                                  the version in use and any draft
//   /equipo/cartas?carta=<key>     one letter: the editor with its chips, the
//                                  preview for a sample client, the changes
//                                  against the text in use, and its versions
//   /equipo/cartas/paquete         the attorney's packet (printable / PDF)
//
// The screen speaks the member's language; the letters themselves are English
// legal text and are shown exactly as they print.

const RECIPIENT_LABELS: Record<StaffLocale, Record<LetterRecipient, string>> = {
  es: {
    bureau: "Buró de crédito",
    secondary_bureau: "Agencia de reportes especializada",
    furnisher: "Acreedor o proveedor de datos",
    collector: "Agencia de cobranza",
  },
  en: {
    bureau: "Credit bureau",
    secondary_bureau: "Specialty reporting agency",
    furnisher: "Creditor or data furnisher",
    collector: "Collection agency",
  },
};

const statusLabel = (locale: StaffLocale) => (locale === "es" ? STATUS_LABEL : STATUS_LABEL_EN);

const STATUS_TONE: Record<LetterVersion["status"], string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-50 text-blue-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
};

const INPUT = "mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[15px] text-slate-900 placeholder:text-slate-400";

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

const dayLabel = (day: string, locale: StaffLocale) => longDay(`${day}T18:00:00.000Z`, locale);

function DemoBanner() {
  const t = useTx();
  return (
    <p className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" data-testid="letters-demo-banner">
      <Icon name="info" size={18} className="mt-px shrink-0" />
      <span>
        <strong>Demo:</strong>{" "}
        {t(
          "lo que cambies o apruebes aquí se guarda solo en este navegador. No cambia ninguna carta real y no se envía nada al abogado. «Reiniciar la demo», abajo, lo borra.",
          "what you change or approve here is saved only in this browser. No real letter changes and nothing goes to the attorney. “Reset the demo”, below, clears it.",
        )}
      </span>
    </p>
  );
}

function Problems({ errors, warnings }: { errors: SourceProblem[]; warnings: SourceProblem[] }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-green-700" data-testid="letter-check-ok">
        <Icon name="check" size={16} /> {t("El texto pasa todas las revisiones.", "The text passes every check.")}
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="letter-problems">
      {errors.length > 0 && (
        <ul className="space-y-1.5 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-800" role="alert">
          {errors.map((p, i) => (
            <li key={`${p.code}-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
              <span>{staffMessage(p.message, locale)}</span>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className={`space-y-1.5 rounded-2xl px-4 py-3 text-[14px] leading-snug ${WAITING_TONE}`}>
          {warnings.map((p, i) => (
            <li key={`${p.code}-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                <strong>{t("Para el abogado:", "For the attorney:")}</strong> {staffMessage(p.message, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The list ────────────────────────────────────────────────────────────

function InUse({ meta, versions }: { meta: LetterMeta; versions: LetterVersion[] }) {
  const current = resolveLetter(meta.key, versions);
  const own = versionsOf(meta.key, versions);
  const draft = own.find((v) => v.status === "draft");
  const sent = own.filter((v) => v.status === "sent");
  const t = useTx();
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
      {current.approved ? (
        <Chip tone="bg-green-50 text-green-700">{t("Aprobada", "Approved")} · v{current.version}</Chip>
      ) : (
        <Chip tone={WAITING_TONE}>{t("Sin aprobar · v1 incluida", "Not approved · built-in v1")}</Chip>
      )}
      {sent.map((v) => (
        <Chip key={v.id} tone={STATUS_TONE.sent}>
          {t("Con el abogado", "With the attorney")} · v{v.version}
        </Chip>
      ))}
      {draft && <Chip tone={STATUS_TONE.draft}>{t("Borrador", "Draft")} · v{draft.version}</Chip>}
    </div>
  );
}

function LetterList({ versions, data, reload, allowUnapproved }: { versions: LetterVersion[]; data: LetterVersionsData; reload: () => Promise<void>; allowUnapproved: boolean }) {
  const router = useRouter();
  const t = useTx();
  const { locale } = useStaffLocale();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const approved = LETTER_CATALOGUE.filter((m) => resolveLetter(m.key, versions).approved).length;
  const pending = versions.filter((v) => v.status === "sent");
  const drafts = versions.filter((v) => v.status === "draft");
  const roundKeys = ORIGINAL_TEMPLATE_KEYS;
  const roundApproved = roundKeys.filter((k) => resolveLetter(k, versions).approved).length;
  // Letters with nothing approved and nothing with the attorney: their version 1 can be sent as it is.
  const unreviewed = LETTER_CATALOGUE.filter((m) => {
    const own = versionsOf(m.key, versions);
    return !resolveLetter(m.key, versions).approved && !own.some((v) => v.status === "sent" || v.status === "draft") && !own.some((v) => v.version === 1);
  });

  const sendUnreviewed = async () => {
    if (
      !window.confirm(
        t(
          `¿Enviar al abogado las ${unreviewed.length} cartas sin revisar, tal como están hoy? Su texto queda fijo desde ahora.`,
          `Send the ${unreviewed.length} unreviewed letters to the attorney, as they are today? Their text is locked from now on.`,
        ),
      )
    )
      return;
    setSending(true);
    const result = await data.sendToAttorney(
      unreviewed.map((m) => m.key),
      staffAuthor(),
    );
    setSending(false);
    if (!result.ok) {
      setMessage(result.problems.map((p) => staffMessage(p.message, locale)).join(" "));
      return;
    }
    await reload();
    router.push("/equipo/cartas/paquete");
  };

  return (
    <>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="card px-5 py-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Aprobadas", "Approved")}</p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular-nums text-slate-900" data-testid="approved-count">
            {approved} <span className="text-[16px] font-medium text-slate-500">{t("de", "of")} {LETTER_CATALOGUE.length}</span>
          </p>
          <p className="text-[13px] text-slate-500">
            {t(`Las de las rondas: ${roundApproved} de ${roundKeys.length}`, `Round letters: ${roundApproved} of ${roundKeys.length}`)}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Con el abogado", "With the attorney")}</p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular-nums text-slate-900">{pending.length}</p>
          {pending.length > 0 ? (
            <Link href="/equipo/cartas/paquete" className="text-[14px] font-medium text-blue-700">
              {t("Ver el paquete para el abogado", "See the attorney's packet")}
            </Link>
          ) : (
            <p className="text-[13px] text-slate-500">{t("Nada pendiente de decisión.", "Nothing waiting for a decision.")}</p>
          )}
        </div>
        <div className="card px-5 py-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Borradores", "Drafts")}</p>
          <p className="mt-1 font-display text-[28px] font-semibold tabular-nums text-slate-900">{drafts.length}</p>
          <p className="text-[13px] text-slate-500">{t("Sin enviar al abogado todavía.", "Not sent to the attorney yet.")}</p>
        </div>
      </div>

      <div className="card mt-3 px-5 py-4 text-[14px] leading-relaxed text-slate-600">
        <p>
          <strong className="text-slate-900">{t("Qué se envía:", "What gets mailed:")}</strong>{" "}
          {t(
            "cada carta sale con su versión aprobada más reciente. Una ronda que usa una carta sin versión aprobada no se envía ni se imprime para un cliente real; el envío dice cuál falta.",
            "each letter goes out with its latest approved version. A round that uses a letter with no approved version isn't mailed or printed for a real client; the send screen says which one is missing.",
          )}
        </p>
        {allowUnapproved && (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-red-800" data-testid="allow-unapproved">
            {t(
              "LETTERS_ALLOW_UNAPPROVED=1 está activo en el servidor: las cartas sin aprobar SÍ se envían. Úsalo solo para pruebas con la llave de prueba de Lob, y quítalo antes de atender clientes.",
              "LETTERS_ALLOW_UNAPPROVED=1 is on in the server: unapproved letters DO get mailed. Use it only for tests with Lob's test key, and remove it before serving clients.",
            )}
          </p>
        )}
        {unreviewed.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={SECONDARY_BUTTON} onClick={() => void sendUnreviewed()} disabled={sending} data-testid="send-unreviewed">
              {t(`Enviar al abogado las ${unreviewed.length} sin revisar`, `Send the ${unreviewed.length} unreviewed to the attorney`)}
            </button>
            <span className="text-[13px] text-slate-500">
              {t("Para que apruebe la biblioteca tal como está; después puedes cambiar cualquier carta.", "So they can approve the library as it is; you can change any letter afterward.")}
            </span>
          </div>
        )}
        {message && <p className="mt-2 text-red-700">{message}</p>}
      </div>

      {CATEGORY_ORDER.map((category) => {
        const letters = LETTER_CATALOGUE.filter((m) => m.category === category);
        if (letters.length === 0) return null;
        return (
          <section key={category} className="mt-7" aria-label={CATEGORY_LABELS[category][locale]}>
            <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{letters.length}</span>}>{CATEGORY_LABELS[category][locale]}</SectionTitle>
            <ul className="card divide-y divide-slate-100 overflow-hidden">
              {letters.map((meta) => (
                <li key={meta.key}>
                  <Link
                    href={`/equipo/cartas?carta=${meta.key}`}
                    className="flex flex-col gap-2 px-5 py-3.5 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                    data-testid={`letter-row-${meta.key}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-slate-900">{meta.title[locale]}</span>
                      <span className="mt-0.5 block text-[13px] text-slate-500">
                        {RECIPIENT_LABELS[locale][meta.recipient]}
                        {ORIGINAL_TEMPLATE_KEYS.includes(meta.key) && <> · {t("se usa en las rondas", "used in rounds")}</>} · <span className="font-mono text-[12px]">{meta.key}</span>
                      </span>
                    </span>
                    <InUse meta={meta} versions={versions} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ── One letter ──────────────────────────────────────────────────────────

function DecisionForm({ version, data, onDone }: { version: LetterVersion; data: LetterVersionsData; onDone: (message: string) => Promise<void> }) {
  const t = useTx();
  const [decision, setDecision] = useState<DecisionInput["decision"]>("approved");
  const [attorneyName, setAttorneyName] = useState("");
  const [decidedOn, setDecidedOn] = useState(today());
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [problems, setProblems] = useState<SourceProblem[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const result = await data.recordDecision(version.id, { decision, attorneyName, decidedOn, note, confirmed }, staffAuthor());
    setSaving(false);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    await onDone(
      decision === "approved"
        ? t(`Versión ${version.version} aprobada. Desde ahora es la que se envía.`, `Version ${version.version} approved. It's the one mailed from now on.`)
        : t(`Versión ${version.version} rechazada.`, `Version ${version.version} rejected.`),
    );
  };

  return (
    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 px-4 py-4" data-testid="decision-form">
      <p className="text-[15px] font-semibold text-slate-900">
        {t(`Registrar la decisión del abogado sobre la versión ${version.version}`, `Record the attorney's decision on version ${version.version}`)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("Decisión", "Decision")}>
        {(["approved", "rejected"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={decision === d}
            onClick={() => setDecision(d)}
            className={`pressable h-10 rounded-full px-4 text-[14px] font-semibold ${decision === d ? "bg-blue-900 text-white" : "bg-white text-blue-900 ring-1 ring-slate-200"}`}
          >
            {d === "approved" ? t("La aprobó", "Approved it") : t("Pidió cambios / no la aprobó", "Asked for changes / didn't approve it")}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-700">{t("Nombre del abogado", "Attorney's name")}</span>
          <input
            className={INPUT}
            value={attorneyName}
            onChange={(e) => setAttorneyName(e.target.value)}
            placeholder={t("Lic. Nombre Apellido", "First and last name")}
            data-testid="attorney-name"
          />
        </label>
        <label className="block">
          <span className="text-[13px] font-semibold text-slate-700">{t("Fecha de su decisión", "Date of their decision")}</span>
          <input type="date" className={INPUT} value={decidedOn} max={today()} onChange={(e) => setDecidedOn(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-[13px] font-semibold text-slate-700">{decision === "approved" ? t("Nota (opcional)", "Note (optional)") : t("Qué pidió cambiar", "What they asked to change")}</span>
        <textarea className={`${INPUT} min-h-20`} value={note} onChange={(e) => setNote(e.target.value)} data-testid="decision-note" />
      </label>
      <label className="mt-3 flex items-start gap-2.5 text-[14px] leading-snug text-slate-700">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="decision-confirm" />
        <span>
          {t("Confirmo que esta es la decisión del abogado sobre", "I confirm this is the attorney's decision on")}{" "}
          <strong>{t("este texto exacto", "this exact text")}</strong>{" "}
          {t(
            `(huella ${version.contentHash.slice(0, 12)}…), por escrito o en el paquete firmado. No es mi decisión ni la de alguien del equipo.`,
            `(fingerprint ${version.contentHash.slice(0, 12)}…), in writing or in the signed packet. It isn't my decision or anyone else's on the team.`,
          )}
        </span>
      </label>
      {problems.length > 0 && (
        <div className="mt-3">
          <Problems errors={problems} warnings={[]} />
        </div>
      )}
      <button type="button" className={`${PRIMARY_BUTTON} mt-4`} disabled={saving || !confirmed} onClick={() => void submit()} data-testid="decision-submit">
        {decision === "approved" ? t("Marcar aprobada", "Mark approved") : t("Marcar rechazada", "Mark rejected")}
      </button>
    </div>
  );
}

function VersionRow({
  version,
  inUse,
  selected,
  onView,
  data,
  onDecided,
}: {
  version: LetterVersion;
  inUse: boolean;
  selected: boolean;
  onView: () => void;
  data: LetterVersionsData;
  onDecided: (message: string) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState(false);
  const t = useTx();
  const { locale } = useStaffLocale();
  return (
    <li className={`px-5 py-3.5 ${selected ? "bg-slate-50" : ""}`} data-testid={`version-${version.version}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-slate-900">
          {t("Versión", "Version")} {version.version}
        </span>
        {version.origin === "builtin" && <span className="text-[13px] text-slate-500">{t("(incluida)", "(built-in)")}</span>}
        <Chip tone={STATUS_TONE[version.status]}>{statusLabel(locale)[version.status]}</Chip>
        {inUse && <Chip tone="bg-slate-900 text-white">{t("En uso", "In use")}</Chip>}
        <button type="button" className={`${QUIET_BUTTON} ml-auto`} onClick={onView} aria-pressed={selected}>
          {selected ? t("Viendo", "Viewing") : t("Ver", "View")}
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-slate-500">
        {version.origin === "builtin"
          ? t("Texto del código", "Text from the code")
          : t(`Escrita por ${version.authorName}, a partir de la versión ${version.basedOn ?? 1}`, `Written by ${version.authorName}, from version ${version.basedOn ?? 1}`)}{" "}
        · {shortDateTime(version.createdAt, locale)}
        {version.sentAt && (
          <>
            {" "}
            · {t("enviada al abogado", "sent to the attorney")} {shortDateTime(version.sentAt, locale)}
          </>
        )}
      </p>
      {version.status === "approved" && (
        <p className="mt-1 text-[14px] leading-snug text-green-800" data-testid="approval-record">
          {t("Aprobada por", "Approved by")} <strong>{version.approvedBy}</strong> {t("el", "on")} {dayLabel(version.approvedAt!, locale)}
          {version.approvalNote && <> · «{version.approvalNote}»</>} · {t("registrado por", "recorded by")} {version.recordedByName}
        </p>
      )}
      {version.status === "rejected" && (
        <p className="mt-1 text-[14px] leading-snug text-red-800">
          {t("No aprobada por", "Not approved by")} <strong>{version.rejectedBy}</strong> {t("el", "on")} {dayLabel(version.rejectedAt!, locale)} · «{version.rejectionNote}»
        </p>
      )}
      {version.status === "sent" &&
        (deciding ? (
          <DecisionForm version={version} data={data} onDone={onDecided} />
        ) : (
          <button type="button" className={`${SECONDARY_BUTTON} mt-2`} onClick={() => setDeciding(true)} data-testid="record-decision">
            {t("Registrar la decisión del abogado", "Record the attorney's decision")}
          </button>
        ))}
    </li>
  );
}

type PreviewOptions = { details: boolean; enclosures: boolean; reason: boolean };

function LetterEditor({
  meta,
  versions,
  data,
  reload,
  demo,
  message,
  setMessage,
}: {
  meta: LetterMeta;
  versions: LetterVersion[];
  data: LetterVersionsData;
  reload: () => Promise<void>;
  demo: boolean;
  /** Kept by the page: the editor starts again after each save, and the message stays. */
  message: string | null;
  setMessage: (message: string | null) => void;
}) {
  const router = useRouter();
  const t = useTx();
  const { locale } = useStaffLocale();
  const key = meta.key;
  const own = versionsOf(key, versions);
  const current = resolveLetter(key, versions);
  const draft = openDraft(key, versions);
  const pending = own.filter((v) => v.status === "sent");
  const start: LetterSource = draft ?? current.source;

  const editor = useRef<ChipEditorHandle>(null);
  const [resets, setResets] = useState(0);
  const [working, setWorking] = useState<LetterSource>({ subject: start.subject, body: start.body });
  const [viewing, setViewing] = useState<number | null>(null);
  const [tab, setTab] = useState<"preview" | "diff">("preview");
  const [preview, setPreview] = useState<PreviewOptions>({ details: true, enclosures: true, reason: true });
  const [serverProblems, setServerProblems] = useState<SourceProblem[]>([]);
  const [busy, setBusy] = useState(false);

  const viewed = viewing === null ? null : own.find((v) => v.version === viewing) ?? null;
  const shownSource: LetterSource = viewed ?? working;
  const resetKey = `${key}:${resets}`;

  const restart = (source: LetterSource) => {
    setWorking({ subject: source.subject, body: source.body });
    setResets((n) => n + 1);
    setServerProblems([]);
  };

  const normalized = useMemo(() => normalizeSource(working), [working]);
  const dirty = normalized.subject !== normalizeSource(start).subject || normalized.body !== normalizeSource(start).body;
  const check = useMemo(() => validateLetterSource(key, working), [key, working]);
  const changedFromInUse = hasChanges(diffSources(current.source, normalized).body) || hasChanges(diffSources(current.source, normalized).subject);

  // The comparison: the working text against the text in use; a version against the one it replaced.
  const comparison = useMemo(() => {
    if (viewed) {
      const before = resolveLetter(key, versions.filter((v) => v.templateKey === key && v.version < viewed.version));
      return {
        label: t(
          `Versión ${viewed.version} contra la versión ${before.version}${before.approved ? " (aprobada)" : " (incluida)"}`,
          `Version ${viewed.version} against version ${before.version}${before.approved ? " (approved)" : " (built-in)"}`,
        ),
        diff: diffSources(before.source, viewed),
      };
    }
    return {
      label: t(
        `Tu texto contra la versión en uso (v${current.version}${current.approved ? ", aprobada" : ", incluida sin aprobar"})`,
        `Your text against the version in use (v${current.version}${current.approved ? ", approved" : ", built-in, not approved"})`,
      ),
      diff: diffSources(current.source, normalized),
    };
  }, [viewed, key, versions, current, normalized, t]);
  const stats = diffStats([...comparison.diff.subject, ...comparison.diff.body]);

  const previewText = useMemo(() => {
    const ctx = sampleLetterContext(meta, { details: preview.details ? undefined : null, enclosures: preview.enclosures, reasonCode: preview.reason ? "other" : null });
    try {
      if (viewed) return viewed.origin === "builtin" ? renderLetter(key, ctx) : renderSource(key, viewed, ctx);
      // An unknown chip is shown as written, so the preview still reads while the text is being fixed.
      const shown = (text: string) => text.replace(TOKEN, (token, chip: string) => (isChipKey(chip) ? token : `[${chip}?]`));
      return renderSource(key, { subject: shown(working.subject), body: shown(working.body) }, ctx);
    } catch {
      return null;
    }
  }, [meta, preview, viewed, working, key]);

  const done = async (text: string) => {
    await reload();
    setMessage(text);
  };

  const save = async (): Promise<LetterVersion | null> => {
    setBusy(true);
    setMessage(null);
    const result = await data.saveDraft({ templateKey: key, ...working }, staffAuthor());
    setBusy(false);
    if (!result.ok) {
      setServerProblems(result.problems);
      return null;
    }
    setServerProblems([]);
    await done(
      t(
        `Borrador guardado: versión ${result.value.version}. Todavía no se envía a ningún cliente.`,
        `Draft saved: version ${result.value.version}. It isn't sent to any client yet.`,
      ),
    );
    return result.value;
  };

  const send = async () => {
    if (dirty || (!draft && changedFromInUse)) {
      const saved = await save();
      if (!saved) return;
    }
    const mine = draft || dirty || changedFromInUse;
    const question = mine
      ? t(
          "¿Enviar tu borrador al abogado? Desde ahora su texto queda fijo; cualquier cambio será una versión nueva.",
          "Send your draft to the attorney? Its text is locked from now on; any change will be a new version.",
        )
      : t(
          "¿Enviar la versión incluida, tal como está, al abogado? Desde ahora su texto queda fijo; cualquier cambio será una versión nueva.",
          "Send the built-in version, as it is, to the attorney? Its text is locked from now on; any change will be a new version.",
        );
    if (!window.confirm(question)) return;
    setBusy(true);
    const result = await data.sendToAttorney([key], staffAuthor());
    setBusy(false);
    if (!result.ok) {
      setServerProblems(result.problems);
      return;
    }
    await reload();
    router.push(`/equipo/cartas/paquete?ids=${result.value.map((v) => v.id).join(",")}`);
  };

  const discard = async () => {
    if (!draft) {
      restart(current.source);
      return;
    }
    if (!window.confirm(t(`¿Descartar el borrador (versión ${draft.version})? No se puede recuperar.`, `Discard the draft (version ${draft.version})? It can't be recovered.`))) return;
    setBusy(true);
    const result = await data.discardDraft(draft.id);
    setBusy(false);
    if (!result.ok) {
      setServerProblems(result.problems);
      return;
    }
    await reload();
    restart(current.source);
    setMessage(t("Borrador descartado.", "Draft discarded."));
  };

  const canSendBuiltin = !draft && !dirty && !changedFromInUse && !current.approved && pending.length === 0 && !own.some((v) => v.version === 1);
  const allowed = allowedChips(key);

  return (
    <main className="animate-rise">
      <Link href="/equipo/cartas" className="inline-flex items-center gap-1 text-[14px] font-medium text-blue-700">
        <Icon name="chevron" size={14} className="rotate-180" /> {t("Todas las cartas", "All letters")}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{meta.title[locale]}</h1>
          <p className="mt-1 text-[14px] text-slate-500">
            {CATEGORY_LABELS[meta.category][locale]} · {RECIPIENT_LABELS[locale][meta.recipient]} · <span className="font-mono text-[13px]">{key}</span>
          </p>
        </div>
        <InUse meta={meta} versions={versions} />
      </div>
      <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-slate-600">{meta.useWhen[locale]}</p>

      {demo && <DemoBanner />}

      <div className={`mt-5 rounded-2xl px-4 py-3 text-[14px] leading-snug ${current.approved ? "bg-green-50 text-green-800" : WAITING_TONE}`} data-testid="in-use-line">
        {current.approved ? (
          <>
            {t("Se envía la", "Mailing")}{" "}
            <strong>
              {t("versión", "version")} {current.version}
            </strong>
            {t(
              `, aprobada por ${current.approvedBy} el ${dayLabel(current.approvedAt!, locale)}.`,
              `, approved by ${current.approvedBy} on ${dayLabel(current.approvedAt!, locale)}.`,
            )}
          </>
        ) : (
          <>
            {t("Esta carta todavía no tiene una versión aprobada por el abogado.", "This letter doesn't have a version approved by the attorney yet.")}{" "}
            <strong>{t("Con la base de datos, una ronda que la usa no se envía", "With the database, a round that uses it isn't mailed")}</strong>{" "}
            {t("hasta que el abogado apruebe una versión.", "until the attorney approves a version.")}
          </>
        )}
      </div>

      {message && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
          <Icon name="check" size={18} className="mt-px shrink-0" />
          <span>{message}</span>
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-label={t("Texto de la carta", "Letter text")} className="min-w-0">
          <SectionTitle
            aside={
              viewed ? (
                <button type="button" className="text-[14px] font-medium text-blue-700" onClick={() => setViewing(null)}>
                  {t("Volver a mi texto", "Back to my text")}
                </button>
              ) : draft ? (
                <Chip tone={STATUS_TONE.draft}>{t("Borrador", "Draft")} · v{draft.version}</Chip>
              ) : null
            }
          >
            {viewed ? `${t("Versión", "Version")} ${viewed.version} · ${statusLabel(locale)[viewed.status]}` : t("Texto", "Text")}
          </SectionTitle>
          <div className="card px-4 py-4 sm:px-5">
            {viewed && (
              <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-[13px] leading-snug text-slate-600">
                {viewed.status === "draft"
                  ? t("Este es tu borrador guardado.", "This is your saved draft.")
                  : t(
                      "Una versión enviada al abogado no cambia. Para cambiarla, edítala: se guarda como una versión nueva.",
                      "A version sent to the attorney doesn't change. To change it, edit it: it's saved as a new version.",
                    )}
                {!draft && viewed.status !== "draft" && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="font-semibold text-blue-700"
                      onClick={() => {
                        restart(viewed);
                        setViewing(null);
                      }}
                    >
                      {t("Editar a partir de esta versión", "Edit from this version")}
                    </button>
                  </>
                )}
              </p>
            )}
            <label className="block">
              <span className="text-[13px] font-semibold text-slate-700">{t("Asunto (la línea «Re:»)", "Subject (the “Re:” line)")}</span>
              <input
                className={`${INPUT} font-serif ${viewed ? "bg-slate-50" : ""}`}
                value={shownSource.subject}
                readOnly={Boolean(viewed)}
                onChange={(e) => setWorking({ ...working, subject: e.target.value })}
                data-testid="letter-subject"
              />
            </label>
            <p className="mt-4 text-[13px] font-semibold text-slate-700">{t("Carta", "Letter")}</p>
            <p className="mb-2 text-[13px] leading-snug text-slate-500">
              {t(
                "El encabezado, «To Whom It May Concern:» y la firma con la lista de adjuntos se ponen solos. Una línea en blanco separa párrafos.",
                "The heading, “To Whom It May Concern:” and the signature with the list of enclosures are added automatically. A blank line separates paragraphs.",
              )}
            </p>
            <ChipEditor
              ref={editor}
              value={viewed ? viewed.body : working.body}
              resetKey={viewed ? `view:${viewed.id}` : resetKey}
              readOnly={Boolean(viewed)}
              onChange={(body) => setWorking((w) => ({ ...w, body }))}
              label={t("Texto de la carta", "Letter text")}
            />
            {!viewed && (
              <>
                <div className="mt-3">
                  <p className="text-[13px] font-semibold text-slate-700">{t("Insertar ficha", "Insert chip")}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {allowed.map((chip: ChipKey) => (
                      <button
                        key={chip}
                        type="button"
                        title={chipText(chip, locale).help}
                        onClick={() => editor.current?.insertChip(chip)}
                        className="pressable inline-flex h-9 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 text-[13px] font-semibold text-blue-800 hover:bg-blue-100"
                        data-testid={`insert-${chip}`}
                      >
                        <Icon name="plus" size={14} /> {chipText(chip, locale).label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <Problems errors={[...check.errors, ...serverProblems.filter((p) => !check.errors.some((e) => e.code === p.code))]} warnings={check.warnings} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY_BUTTON} disabled={busy || !dirty} onClick={() => void save()} data-testid="save-draft">
                    {t("Guardar borrador", "Save draft")}
                  </button>
                  {(draft || dirty || changedFromInUse || canSendBuiltin) && (
                    <button type="button" className={SECONDARY_BUTTON} disabled={busy || !check.ok} onClick={() => void send()} data-testid="send-attorney">
                      {canSendBuiltin ? t("Enviar la incluida al abogado", "Send the built-in one to the attorney") : t("Enviar al abogado", "Send to the attorney")}
                    </button>
                  )}
                  {(draft || dirty) && (
                    <button type="button" className={QUIET_BUTTON} disabled={busy} onClick={() => void discard()}>
                      {draft ? t("Descartar borrador", "Discard draft") : t("Deshacer cambios", "Undo changes")}
                    </button>
                  )}
                </div>
                <details className="mt-4 text-[13px] leading-relaxed text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">{t("Qué revisa el editor", "What the editor checks")}</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>
                      {t(
                        "Las fichas que lleva la versión incluida siguen ahí (la lista de partidas con el motivo del cliente, sus palabras).",
                        "The chips the built-in version has are still there (the item list with the client's reason, their words).",
                      )}
                    </li>
                    <li>{t("No hay fichas inventadas ni llaves sueltas; la lista de partidas va sola en su párrafo.", "No made-up chips or stray braces; the item list goes alone in its paragraph.")}</li>
                    <li>
                      {t(
                        "No promete resultados ni nombra a la empresa: la carta es del cliente, en primera persona y en inglés.",
                        "It promises no results and doesn't name the company: the letter is the client's, in the first person and in English.",
                      )}
                    </li>
                    <li>{t("El saludo y la firma no se escriben: se ponen solos.", "The greeting and the signature aren't typed: they're added automatically.")}</li>
                  </ul>
                </details>
              </>
            )}
          </div>
        </section>

        <section aria-label={t("Vista previa y cambios", "Preview and changes")} className="min-w-0">
          <div className="flex min-h-7 items-center gap-1 px-1 pb-2" role="tablist">
            {(["preview", "diff"] as const).map((which) => (
              <button
                key={which}
                type="button"
                role="tab"
                aria-selected={tab === which}
                onClick={() => setTab(which)}
                className={`pressable h-8 rounded-full px-3 text-[13px] font-semibold ${tab === which ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                data-testid={`tab-${which}`}
              >
                {which === "preview"
                  ? t("Vista previa", "Preview")
                  : `${t("Cambios", "Changes")}${stats.added + stats.removed > 0 ? ` (+${stats.added} / −${stats.removed})` : ""}`}
              </button>
            ))}
          </div>
          {tab === "preview" ? (
            <div className="card px-4 py-4 sm:px-5">
              <p className="text-[13px] leading-snug text-slate-500">
                {t(
                  "Así se imprime para una clienta de ejemplo (datos inventados). Los datos reales los pone el sistema en cada envío.",
                  "This is how it prints for a sample client (made-up details). The system fills in the real details on each mailing.",
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-slate-700">
                {(
                  [
                    ["details", t("Con palabras del cliente", "With the client's words")],
                    ["reason", t("Con el motivo del cliente", "With the client's reason")],
                    ["enclosures", t("Con adjuntos", "With enclosures")],
                  ] as const
                ).map(([option, label]) => (
                  <label key={option} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={preview[option]} onChange={(e) => setPreview({ ...preview, [option]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                {previewText ? (
                  <LetterPaper text={previewText} testId="letter-preview" />
                ) : (
                  <p className="rounded-xl bg-red-50 px-3 py-3 text-[14px] text-red-800">
                    {t("La vista previa aparece cuando el texto no tiene fichas desconocidas.", "The preview shows once the text has no unknown chips.")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="card px-4 py-4 sm:px-5" data-testid="letter-diff">
              <p className="text-[13px] font-semibold text-slate-700">{comparison.label}</p>
              {hasChanges(comparison.diff.subject) || hasChanges(comparison.diff.body) ? (
                <>
                  <p className="mt-1 text-[13px] text-slate-500">
                    <ins className="bg-green-100 px-1 text-green-900 no-underline">{t("agregado", "added")}</ins>{" "}
                    <del className="bg-red-50 px-1 text-red-700">{t("quitado", "removed")}</del>
                  </p>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="font-serif text-[15px] text-slate-500">
                      Re: <DiffView parts={comparison.diff.subject} inline />
                    </p>
                    <div className="mt-3">
                      <DiffView parts={comparison.diff.body} />
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[14px] text-slate-500">{t("Sin cambios: es el mismo texto.", "No changes: it's the same text.")}</p>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="mt-8" aria-labelledby="versiones">
        <SectionTitle aside={pending.length > 0 ? <Link href={`/equipo/cartas/paquete?ids=${pending.map((v) => v.id).join(",")}`} className="text-[14px] font-medium text-blue-700">{t("Paquete para el abogado", "Attorney's packet")}</Link> : undefined}>
          <span id="versiones">{t("Versiones", "Versions")}</span>
        </SectionTitle>
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {own.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              inUse={current.approved && current.version === v.version}
              selected={viewing === v.version}
              onView={() => setViewing(viewing === v.version ? null : v.version)}
              data={data}
              onDecided={done}
            />
          ))}
          {!own.some((v) => v.version === 1) && (
            <li className="px-5 py-3.5" data-testid="version-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-slate-900">{t("Versión 1", "Version 1")}</span>
                <span className="text-[13px] text-slate-500">{t("(incluida)", "(built-in)")}</span>
                <Chip tone={WAITING_TONE}>{t("Sin revisar", "Not reviewed")}</Chip>
                {!current.approved && <Chip tone="bg-slate-900 text-white">{t("En uso", "In use")}</Chip>}
              </div>
              <p className="mt-1 text-[13px] leading-snug text-slate-500">
                {t("El texto que trae el sistema. Todavía no se ha enviado al abogado.", "The text the system comes with. It hasn't been sent to the attorney yet.")}
              </p>
            </li>
          )}
        </ul>
      </section>

      <section className="mt-8" aria-label={t("Lo que la carta exige", "What the letter requires")}>
        <SectionTitle>{t("Antes de usarla, el cliente debe haber dicho", "Before it's used, the client must have stated")}</SectionTitle>
        <ul className="card list-disc space-y-1 py-4 pl-9 pr-5 text-[14px] leading-relaxed text-slate-700">
          {meta.requiresFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Cartas() {
  const params = useSearchParams();
  const { ready, can } = useStaff();
  const t = useTx();
  const { locale } = useStaffLocale();
  const { data, demo, ready: loaded, versions, allowUnapproved, error, reload } = useLetterVersions();
  const [message, setMessage] = useState<string | null>(null);
  const key = params.get("carta");
  // A message belongs to the letter it was about.
  useEffect(() => setMessage(null), [key]);
  const meta = key ? getLetterMeta(key) : undefined;

  if (!ready) return null;
  if (!can("letters.edit")) return <NoAccess title={t("Cartas", "Letters")} reason={deniedReason("letters.edit", locale)} />;
  if (!loaded) return null;

  if (key && meta) {
    // A new draft, a thrown-away one or a new approval starts the editor again from the text that now applies.
    const remount = `${meta.key}:${openDraft(meta.key, versions)?.id ?? "none"}:${resolveLetter(meta.key, versions).contentHash}`;
    return <LetterEditor key={remount} meta={meta} versions={versions} data={data} reload={reload} demo={demo} message={message} setMessage={setMessage} />;
  }

  return (
    <main className="animate-rise">
      <h1 className="page-title">{t("Cartas", "Letters")}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        {t(
          `Las ${LETTER_CATALOGUE.length} cartas de la biblioteca. Cambia el texto de una carta aquí; cada cambio es una versión nueva que revisa el abogado, y solo una versión aprobada se envía a los clientes.`,
          `The ${LETTER_CATALOGUE.length} letters in the library. Change a letter's text here; each change is a new version the attorney reviews, and only an approved version is mailed for clients.`,
        )}
      </p>
      {key && !meta && (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-800">{t(`No encontramos la carta «${key}».`, `We couldn't find the letter “${key}”.`)}</p>
      )}
      {demo && <DemoBanner />}
      {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-800">{staffMessage(error, locale)}</p>}
      <LetterList versions={versions} data={data} reload={reload} allowUnapproved={allowUnapproved} />
    </main>
  );
}

export default function CartasPage() {
  return (
    <Suspense fallback={null}>
      <Cartas />
    </Suspense>
  );
}
