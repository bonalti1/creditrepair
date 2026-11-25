"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUsAddress, parseUsAddress } from "@/lib/mail/address";
import {
  FURNISHER_FIELD_LABEL,
  FURNISHER_FIELD_LABEL_EN,
  normalizeCompanyName,
  resolveFurnisherAddress,
  type FurnisherEntry,
  type FurnisherInput,
} from "@/lib/mail/furnishers";
import { missingFurnisherAddresses } from "@/lib/mail/sendPlan";
import { useMail } from "@/lib/mail/useMail";
import { count, longDay, shortDateTime } from "@/lib/staff/format";
import { latestRound } from "@/lib/staff/stage";
import { fullName, type StaffClient } from "@/lib/staff/types";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import Icon from "@/components/Icon";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle, WAITING_TONE } from "@/components/staff/ui";

// The furnisher address book: where letters to creditors and debt collectors
// are mailed. A letter to a company goes only to an address here that a
// person checked against a source (the company's own site, or a letter from
// it) and dated. Without one, the round waits and the home screen says which
// company is missing. Every save is kept in the company's history.

interface Draft {
  id?: string;
  name: string;
  aliases: string;
  address: string;
  phone: string;
  notes: string;
  source: string;
  verifiedOn: string;
}

const EMPTY: Draft = { name: "", aliases: "", address: "", phone: "", notes: "", source: "", verifiedOn: "" };

function draftOf(entry: FurnisherEntry): Draft {
  return {
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases.join("\n"),
    address: entry.addressLines.join("\n"),
    phone: entry.phone ?? "",
    notes: entry.notes ?? "",
    source: entry.source ?? "",
    verifiedOn: entry.verifiedOn ?? "",
  };
}

function inputOf(draft: Draft): FurnisherInput {
  const lines = (text: string) => text.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    aliases: draft.aliases.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    addressLines: lines(draft.address),
    phone: draft.phone,
    notes: draft.notes,
    source: draft.source,
    verifiedOn: draft.verifiedOn,
  };
}

/** "capitalone.com" for a link; the text itself otherwise. */
function sourceLabel(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** The ready rounds each company is holding: company key → "Rosario Villalobos (ronda 4)". */
function heldRounds(clients: StaffClient[], book: readonly FurnisherEntry[]): Map<string, Array<{ client: StaffClient; round: number }>> {
  const held = new Map<string, Array<{ client: StaffClient; round: number }>>();
  for (const client of clients) {
    const round = latestRound(client);
    if (!round || round.status !== "ready" || client.agreementCancelledAt) continue;
    for (const gap of missingFurnisherAddresses(round, book)) {
      const key = normalizeCompanyName(gap.company);
      held.set(key, [...(held.get(key) ?? []), { client, round: round.number }]);
    }
  }
  return held;
}

/** What a credit report printed for a company: shown as a lead to check, never used to mail. */
function reportAddress(clients: StaffClient[], name: string): string[] | null {
  const key = normalizeCompanyName(name);
  for (const client of clients) {
    for (const item of client.report?.items ?? []) {
      if (item.furnisher && normalizeCompanyName(item.furnisher.name) === key && item.furnisher.addressLines.length > 0) {
        return item.furnisher.addressLines;
      }
    }
  }
  return null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

const INPUT = "mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[15px] text-slate-900 placeholder:text-slate-400";

function EntryForm({
  initial,
  clients,
  suggested = false,
  onSave,
  onCancel,
}: {
  initial: Draft;
  clients: StaffClient[];
  /** The address was filled in from a credit report: a suggestion to check, never verified by itself. */
  suggested?: boolean;
  onSave: (draft: Draft) => Promise<string[] | null>;
  onCancel: () => void;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [draft, setDraft] = useState<Draft>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (field: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [field]: e.target.value });
  const lines = draft.address.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  const parsed = lines.length > 0 ? parseUsAddress(lines) : null;
  const fromReport = draft.name ? reportAddress(clients, draft.name) : null;

  const save = async () => {
    setSaving(true);
    const result = await onSave(draft);
    setSaving(false);
    setProblems((result ?? []).map((p) => staffMessage(p, locale)));
  };

  return (
    <section className="card px-5 py-5 sm:px-6" aria-label={draft.id ? t(`Editar ${initial.name}`, `Edit ${initial.name}`) : t("Agregar empresa", "Add company")} data-testid="furnisher-form">
      <h2 className="text-[19px] font-semibold text-slate-900">{draft.id ? t(`Editar ${initial.name}`, `Edit ${initial.name}`) : t("Agregar empresa", "Add company")}</h2>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Field label={t("Nombre de la empresa", "Company name")}>
          <input className={INPUT} value={draft.name} onChange={set("name")} placeholder="Midland Credit Management" />
        </Field>
        <Field
          label={t("Otros nombres en los reportes", "Other names on the reports")}
          hint={t("Uno por línea, como aparecen en el reporte (MIDLAND CREDIT MGMT, MCM).", "One per line, as they show on the report (MIDLAND CREDIT MGMT, MCM).")}
        >
          <textarea className={`${INPUT} min-h-[5.5rem]`} rows={3} value={draft.aliases} onChange={set("aliases")} />
        </Field>
        <Field
          label={t("Dirección para disputas", "Dispute address")}
          hint={t("Una línea por renglón: calle o apartado postal, y ciudad, estado y código postal.", "One line per row: street or P.O. box, then city, state and ZIP code.")}
        >
          <textarea className={`${INPUT} min-h-[5.5rem]`} value={draft.address} onChange={set("address")} placeholder={t("P.O. Box 0000\nCiudad, TX 00000", "P.O. Box 0000\nCity, TX 00000")} />
        </Field>
        <div className="space-y-4">
          <Field
            label={t("Fuente", "Source")}
            hint={t("Dónde se comprobó: enlace a la página de la empresa, o «carta de la empresa del 3 nov 2026».", "Where it was checked: a link to the company's page, or “letter from the company dated Nov 3, 2026”.")}
          >
            <input className={INPUT} value={draft.source} onChange={set("source")} placeholder="https://…" />
          </Field>
          <Field
            label={t("Verificada el", "Verified on")}
            hint={t("El día que una persona comparó la dirección con la fuente. Sin fecha, no se usa.", "The day a person compared the address with the source. Without a date, it isn't used.")}
          >
            <span className="mt-1 flex items-center gap-2">
              <input type="date" className={`${INPUT} mt-0 max-w-[12rem]`} value={draft.verifiedOn} max={today()} onChange={set("verifiedOn")} />
              <button type="button" className={QUIET_BUTTON} onClick={() => setDraft({ ...draft, verifiedOn: today() })}>
                {t("Hoy", "Today")}
              </button>
            </span>
          </Field>
        </div>
        <Field label={t("Teléfono", "Phone")}>
          <input className={INPUT} value={draft.phone} onChange={set("phone")} />
        </Field>
        <Field label={t("Notas", "Notes")}>
          <textarea className={`${INPUT} min-h-[3rem]`} value={draft.notes} onChange={set("notes")} />
        </Field>
      </div>

      {parsed && (
        <p className={`mt-4 rounded-2xl px-4 py-3 text-[14px] leading-snug ${parsed.ok ? "bg-slate-50 text-slate-700" : "bg-red-50 text-red-700"}`} data-testid="address-preview">
          {parsed.ok
            ? t(`Las cartas irán a: ${formatUsAddress(parsed.address).join(" · ")}`, `Letters will go to: ${formatUsAddress(parsed.address).join(" · ")}`)
            : staffMessage(`La dirección no se puede leer: ${parsed.message}`, locale)}
        </p>
      )}
      {suggested && draft.address === initial.address && (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" data-testid="suggested-address">
          {t(
            "Sugerencia sin verificar: esta dirección la imprimen los reportes de crédito de los clientes que esperan. Suele ser la de pagos, no la de disputas. Ábrela en la página de la empresa o en una carta suya, escribe la fuente y la fecha, y guárdala. Sin fuente y fecha no se envía ninguna carta a ella.",
            "Unverified suggestion: this is the address printed on the credit reports of the clients who are waiting. It's usually the payment address, not the dispute address. Check it on the company's page or in a letter from them, enter the source and the date, and save it. No letter goes to it without a source and a date.",
          )}
        </p>
      )}
      {fromReport && !draft.address && (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" data-testid="report-address">
          {t(
            `El reporte de crédito muestra esta dirección: ${fromReport.join(", ")}. Suele ser la de pagos, no la de disputas: no la uses sin comprobarla en la página de la empresa o en una carta suya.`,
            `The credit report shows this address: ${fromReport.join(", ")}. It's usually the payment address, not the dispute address: don't use it without checking it on the company's page or in a letter from them.`,
          )}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BUTTON} onClick={save} disabled={saving} data-testid="furnisher-save">
          {t("Guardar", "Save")}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onCancel}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </section>
  );
}

function EntryCard({
  entry,
  holding,
  onEdit,
}: {
  entry: FurnisherEntry;
  holding: Array<{ client: StaffClient; round: number }>;
  onEdit: () => void;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const usable = resolveFurnisherAddress([entry], entry.name).ok;
  const fieldLabel = locale === "es" ? FURNISHER_FIELD_LABEL : FURNISHER_FIELD_LABEL_EN;
  return (
    <li className="border-t hairline px-5 py-4 first:border-t-0" data-testid="furnisher-entry">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[16px] font-semibold text-slate-900">{entry.name}</p>
            {usable ? (
              <Chip tone="bg-green-50 text-green-700">
                {t("Verificada el", "Verified")} {longDay(`${entry.verifiedOn}T12:00:00Z`, locale)}
              </Chip>
            ) : entry.addressLines.length === 0 ? (
              <Chip tone={WAITING_TONE}>{t("Sin dirección", "No address")}</Chip>
            ) : (
              <Chip tone={WAITING_TONE}>{t("Sin verificar", "Not verified")}</Chip>
            )}
          </div>
          {entry.aliases.length > 0 && (
            <p className="mt-0.5 break-words text-[13px] text-slate-500">{t("También", "Also")}: {entry.aliases.join(" · ")}</p>
          )}
          {entry.addressLines.length > 0 ? (
            <p className="mt-1.5 text-[14px] leading-snug text-slate-800">{entry.addressLines.join(" · ")}</p>
          ) : (
            <p className="mt-1.5 text-[14px] leading-snug text-slate-500">
              {t("No hay dirección para disputas. Sus cartas esperan hasta tenerla.", "There's no dispute address. Its letters wait until there is one.")}
            </p>
          )}
          <p className="mt-1 text-[13px] leading-snug text-slate-500">
            {entry.source ? (
              <>
                {t("Fuente", "Source")}:{" "}
                {/^https?:\/\//.test(entry.source) ? (
                  <a href={entry.source} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline-offset-2 hover:underline">
                    {sourceLabel(entry.source)}
                  </a>
                ) : (
                  entry.source
                )}
              </>
            ) : (
              t("Sin fuente", "No source")
            )}
            {entry.phone ? ` · ${t("Tel.", "Phone")} ${entry.phone}` : ""}
          </p>
          {entry.notes && <p className="mt-1 text-[13px] leading-snug text-slate-600">{entry.notes}</p>}
          {holding.length > 0 && (
            <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[13px] leading-snug text-red-700" data-testid="holding">
              {t(`Detiene ${count(holding.length, "ronda", "rondas")}`, `Holding ${count(holding.length, "round", "rounds")}`)}:{" "}
              {holding.map((h, i) => (
                <span key={h.client.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/equipo/clientes/${h.client.id}#cartas`} className="font-medium underline underline-offset-2">
                    {fullName(h.client)}
                  </Link>{" "}
                  ({t("ronda", "round")} {h.round})
                </span>
              ))}
            </p>
          )}
        </div>
        <button type="button" className={ROW_BUTTON} onClick={onEdit}>
          {entry.addressLines.length === 0 ? t("Agregar dirección", "Add address") : t("Editar", "Edit")}
        </button>
      </div>
      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-blue-700 [&::-webkit-details-marker]:hidden">
          <Icon name="clock" size={14} />
          {t("Historial", "History")} ({entry.history.length})
        </summary>
        <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3" data-testid="furnisher-history">
          {[...entry.history].reverse().map((change, index) => (
            <li key={`${change.at}-${index}`} className="text-[13px] leading-snug">
              <p className="text-slate-500">
                {shortDateTime(change.at, locale)} · {change.by}
              </p>
              <ul>
                {change.changes.map((c) => (
                  <li key={c.field} className="break-words text-slate-700">
                    <span className="font-medium">{fieldLabel[c.field]}:</span> {c.from ? `${c.from} → ` : ""}
                    {c.to || t("(vacío)", "(empty)")}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

function AddressBook() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useTx();
  const { mail, furnishers, ready: bookReady, reload } = useMail();
  const { clients, ready: clientsReady } = useStaff();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState(false);

  // ?nuevo=Name opens the form for a new company with the name filled in; ?editar=id opens an entry.
  useEffect(() => {
    if (!bookReady) return;
    const add = params.get("nuevo");
    const edit = params.get("editar");
    // ?direccion=…: an address a credit report prints for the company (mail/gaps.ts), filled in as an
    // UNVERIFIED suggestion. The person still checks it against a source and writes the source and date.
    const suggested = (params.get("direccion") ?? "").slice(0, 400);
    if (edit) {
      const entry = furnishers.find((f) => f.id === edit);
      if (entry) {
        const draft = draftOf(entry);
        setEditing(suggested && !draft.address ? { ...draft, address: suggested, verifiedOn: "" } : draft);
        if (suggested && !draft.address) setSuggestion(true);
      }
    } else if (add) {
      setEditing({ ...EMPTY, name: add.slice(0, 120), address: suggested });
      if (suggested) setSuggestion(true);
    }
    // Only on arrival: later edits come from the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookReady]);

  const holding = useMemo(() => heldRounds(clients, furnishers), [clients, furnishers]);
  const shown = useMemo(() => {
    const q = normalizeCompanyName(query);
    const list = q
      ? furnishers.filter((f) => [f.name, ...f.aliases].some((n) => normalizeCompanyName(n).includes(q)) || f.addressLines.join(" ").toLowerCase().includes(query.trim().toLowerCase()))
      : furnishers;
    // Companies holding a round first, then those with no usable address, then the rest.
    const rank = (f: FurnisherEntry) => ((holding.get(normalizeCompanyName(f.name))?.length ?? 0) > 0 ? 0 : resolveFurnisherAddress([f], f.name).ok ? 2 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "es"));
  }, [furnishers, query, holding]);

  if (!bookReady || !clientsReady) return null;

  const verified = furnishers.filter((f) => resolveFurnisherAddress([f], f.name).ok).length;
  const save = async (draft: Draft): Promise<string[] | null> => {
    const result = await mail.saveFurnisher(inputOf(draft), staffAuthor());
    if (!result.ok) return result.problems;
    await reload();
    setEditing(null);
    setSaved(result.entry.name);
    setSuggestion(false);
    if (params.get("nuevo") || params.get("editar")) router.replace("/equipo/acreedores");
    return null;
  };

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{t("Acreedores", "Creditors")}</h1>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-slate-500">
            {t(
              "A dónde se envían las cartas a acreedores y agencias de cobranza. Solo se usa una dirección comprobada en una fuente y con fecha; la que trae el reporte de crédito no se usa.",
              "Where letters to creditors and collection agencies are mailed. Only an address checked against a source, with a date, is used; the one on the credit report isn't.",
            )}
          </p>
        </div>
        {!editing && (
          <button type="button" className={PRIMARY_BUTTON} onClick={() => setEditing({ ...EMPTY, name: query.trim() })}>
            {t("Agregar empresa", "Add company")}
          </button>
        )}
      </div>

      {saved && !editing && (
        <p className="mt-5 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
          <Icon name="check" size={18} className="mt-px shrink-0" />
          <span>{t(`Guardado: ${saved}. El cambio queda en su historial.`, `Saved: ${saved}. The change is kept in its history.`)}</span>
        </p>
      )}

      {editing && (
        <div className="mt-6">
          <EntryForm
            key={editing.id ?? editing.name}
            initial={editing}
            clients={clients}
            suggested={suggestion}
            onSave={save}
            onCancel={() => {
              setEditing(null);
              if (params.get("nuevo") || params.get("editar")) router.replace("/equipo/acreedores");
            }}
          />
        </div>
      )}

      <section className="mt-7" aria-labelledby="libreta">
        <SectionTitle
          aside={
            <span className="text-[13px] tabular-nums text-slate-500">
              {t(`${verified} de ${furnishers.length} con dirección verificada`, `${verified} of ${furnishers.length} with a verified address`)}
            </span>
          }
        >
          <span id="libreta">{t("Libreta", "Address book")}</span>
        </SectionTitle>
        <label className="card mb-3 flex items-center gap-2 px-4">
          <Icon name="search" size={18} className="text-slate-400" />
          <span className="sr-only">{t("Buscar", "Search")}</span>
          <input
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
            placeholder={t("Buscar por nombre, como aparece en el reporte, o por dirección", "Search by name, as it shows on the report, or by address")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="furnisher-search"
          />
        </label>
        {shown.length === 0 ? (
          <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
            {t("Ninguna empresa coincide.", "No company matches.")}{" "}
            <button type="button" className="font-medium text-blue-700" onClick={() => setEditing({ ...EMPTY, name: query.trim() })}>
              {t(`Agregar «${query.trim()}»`, `Add “${query.trim()}”`)}
            </button>
          </div>
        ) : (
          <ul className="card overflow-hidden">
            {shown.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                holding={holding.get(normalizeCompanyName(entry.name)) ?? []}
                onEdit={() => {
                  setEditing(draftOf(entry));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default function AcreedoresPage() {
  return (
    <Suspense fallback={null}>
      <AddressBook />
    </Suspense>
  );
}
