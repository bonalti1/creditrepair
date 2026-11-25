"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fileSha256, parseCsv } from "@/lib/accounting/csv";
import {
  CRC_STATUS_LABEL,
  detectMapping,
  existingFrom,
  FIELD_LABEL,
  FIELDS_BY_KIND,
  planImport,
  ROW_REASON_TEXT,
  safeMapping,
  sensitiveColumns,
  shortName,
  summarize,
  type ImportField,
  type ImportKind,
  type Mapping,
  type PlannedRow,
  type RowOutcome,
} from "@/lib/fulfillment/crcImport";
import { buildDemoPartners } from "@/lib/partners/demo";
import { buildInvitePath, inviteMessage } from "@/lib/sales/invite";
import { deniedReason } from "@/lib/staff/permissions";
import { loadTeamActions, saveTeamActions } from "@/lib/staff/teamStore";
import { useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { whatsappHref } from "@/lib/staff/messages";
import type { StaffClient } from "@/lib/staff/types";
import { Chip, EmptyState, NoAccess, pillTab, PRIMARY_BUTTON, ROW_BUTTON, SectionTitle } from "@/components/staff/ui";

// Import from Credit Repair Cloud (/equipo/importar, administrators;
// docs/FULFILLMENT.md "Moving from Credit Repair Cloud"). Upload CRC's CSV
// export, check the columns it found (editable: CRC's names were not verified
// against a real export), see a dry run (what will be created, duplicates by
// phone or email, problems), then import. SSN and date-of-birth columns are
// dropped before anything else and never sent or stored. Imported people are
// prospects with an invitation to finish onboarding in Credalti; they sign
// Credalti's own agreement and nothing is charged. Each import can be undone.

interface Batch {
  id: string;
  kind: ImportKind;
  fileName: string;
  at: string;
  by: string;
  rows: number;
  created: number;
  dropped: string[];
  undoneAt: string | null;
  kept: number | null;
}

interface LogRow {
  batchId: string;
  line: number;
  outcome: string;
  shortName: string;
  reasons: string[];
  prospectId: string | null;
}

interface Person {
  id: string;
  firstName: string;
  state: string;
  phone: string;
  salesperson: string | null;
  locale: "en" | "es";
  invitedAt: string | null;
}

const DEMO_LOG_KEY = "credalti.staffDemo.crcImport.v1";

/** DEMO: an invented CRC export, with the SSN and birth-date columns CRC files carry, so the screen can show them dropped. */
const SAMPLE_CSV = [
  "First Name,Last Name,Email,Phone (Mobile),Phone (Home),Street Address,City,State,Zip Code,SSN,Date of Birth,Status,Assigned To,Referred By,Date Added",
  "Gloria,Paredes,gloria.paredes@example.com,(713) 555-0161,,10 Calle Ejemplo,Houston,TX,77001,000-12-3456,04/12/1979,Client,Ana Prieto,,08/14/2026",
  "Ruben,Salgado,ruben.s@example.com,210-555-0162,,22 Calle Ejemplo,San Antonio,Texas,78201,000-23-4567,11/02/1985,Client,Luis Ortega,Laura Benitez,09/02/2026",
  "Mariana,Robles,mariana.robles@ejemplo.com,(713) 555-0101,,5 Calle Ejemplo,Houston,TX,77001,000-34-5678,01/01/1990,Lead,Ana Prieto,,10/01/2026",
  "Teresa,Lugo,teresa.lugo@example.com,404-555-0163,,1 Peachtree Ejemplo,Atlanta,GA,30301,000-45-6789,02/02/1982,Client,,,07/10/2026",
  "Hugo,Peralta,,512-555-0164,,9 Calle Ejemplo,Austin,TX,78701,000-56-7890,03/03/1975,Inactive,,,03/05/2026",
  "Lidia,Campos,lidia.c@example.com,915-555-0165,,3 Calle Ejemplo,El Paso,TX,79901,000-67-8901,05/05/1991,Lead,,,10/20/2026",
  "Pablo,,pablo@example.com,915-555-0166,,4 Calle Ejemplo,El Paso,TX,79901,,,Lead,,,10/21/2026",
].join("\n");

function readDemoLog(): { batches: Batch[]; rows: LogRow[]; people: Person[] } {
  try {
    return JSON.parse(window.localStorage.getItem(DEMO_LOG_KEY) ?? "null") ?? { batches: [], rows: [], people: [] };
  } catch {
    return { batches: [], rows: [], people: [] };
  }
}

function writeDemoLog(log: { batches: Batch[]; rows: LogRow[]; people: Person[] }) {
  try {
    window.localStorage.setItem(DEMO_LOG_KEY, JSON.stringify(log));
  } catch {
    // Storage unavailable: lasts for this visit.
  }
}

const OUTCOME_TONE: Record<string, string> = {
  create: "bg-green-50 text-green-700",
  created: "bg-green-50 text-green-700",
  duplicate: "bg-amber-100 text-blue-900",
  problem: "bg-red-50 text-red-700",
  skip: "bg-slate-100 text-slate-600",
  skipped: "bg-slate-100 text-slate-600",
  undone: "bg-slate-100 text-slate-600",
  kept: "bg-blue-50 text-blue-700",
};

const field = "h-11 w-full rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";

export default function ImportarPage() {
  const { ready, can, data, locale, clients, viewer, reload } = useStaff();
  const t = useTx();
  const demo = data.demo;
  const [kind, setKind] = useState<ImportKind>("clients");
  const [file, setFile] = useState<{ name: string; sha: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [includeInactive, setIncludeInactive] = useState(false);
  const [inviteLocale, setInviteLocale] = useState<"en" | "es">("en");
  const [filter, setFilter] = useState<RowOutcome | "all">("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [log, setLog] = useState<{ batches: Batch[]; rows: LogRow[]; people: Person[] }>({ batches: [], rows: [], people: [] });
  const [serverExisting, setServerExisting] = useState<Parameters<typeof existingFrom>[0] | null>(null);

  const loadLog = useCallback(async () => {
    if (demo) return setLog(readDemoLog());
    const res = await fetch("/api/staff/import", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { batches: Record<string, unknown>[]; rows: Record<string, unknown>[]; imported: Record<string, unknown>[]; existing: Parameters<typeof existingFrom>[0] };
    setServerExisting(body.existing);
    setLog({
      batches: body.batches.map((b) => ({
        id: String(b.id),
        kind: b.kind as ImportKind,
        fileName: String(b.file_name),
        at: String(b.created_at),
        by: String(b.created_by_name ?? ""),
        rows: Number(b.row_count),
        created: Number(b.created_count),
        dropped: (b.dropped_columns as string[]) ?? [],
        undoneAt: b.undone_at ? String(b.undone_at) : null,
        kept: b.undo_kept == null ? null : Number(b.undo_kept),
      })),
      rows: body.rows.map((r) => ({ batchId: String(r.batch_id), line: Number(r.line), outcome: String(r.outcome), shortName: String(r.short_name ?? ""), reasons: (r.reasons as string[]) ?? [], prospectId: r.prospect_id ? String(r.prospect_id) : null })),
      people: body.imported.map((p) => ({ id: String(p.id), firstName: String(p.first_name), state: String(p.state), phone: String(p.phone_e164), salesperson: p.salesperson ? String(p.salesperson) : null, locale: p.locale === "es" ? "es" : "en", invitedAt: p.invited_at ? String(p.invited_at) : null })),
    });
  }, [demo]);

  useEffect(() => {
    if (ready) void loadLog();
  }, [ready, loadLog]);

  const existing = useMemo(() => {
    if (!demo && serverExisting) return existingFrom(serverExisting);
    const partners = demo ? buildDemoPartners(new Date()).map((p) => ({ phone: p.phone ?? null, email: p.email ?? null })) : [];
    return existingFrom({
      prospects: clients.filter((c) => !c.signedUpAt).map((c) => ({ phone: c.phone, email: c.email ?? null })),
      clients: clients.filter((c) => c.signedUpAt).map((c) => ({ phone: c.phone, email: c.email ?? null })),
      partners,
    });
  }, [demo, serverExisting, clients]);

  const plan: PlannedRow[] = useMemo(() => (file ? planImport(file.rows, mapping, kind, existing, { includeInactive }) : []), [file, mapping, kind, existing, includeInactive]);
  const summary = summarize(plan);

  if (!ready) return null;
  if (!can("clients.import")) return <NoAccess title={t("Importar de Credit Repair Cloud", "Import from Credit Repair Cloud")} reason={deniedReason("clients.import", locale)} />;

  const header = file?.rows[0] ?? [];
  const dropped = sensitiveColumns(header);

  const choose = async (name: string, text: string) => {
    setMessage(null);
    const rows = parseCsv(text);
    if (rows.length < 2) return setMessage(t("El archivo no tiene filas.", "The file has no rows."));
    if (rows.length > 5001) return setMessage(t("Más de 5,000 filas: divídelo en partes.", "More than 5,000 rows: split it into parts."));
    setFile({ name, sha: await fileSha256(text), rows });
    setMapping(detectMapping(rows[0]!, kind));
    setFilter("all");
  };

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const keep = header.map((_, i) => i).filter((i) => !dropped.includes(i));
    if (demo) {
      const batchId = `demo-${Date.now()}`;
      const now = new Date().toISOString();
      const team = loadTeamActions();
      const people: Person[] = [];
      const added: StaffClient[] = [];
      for (const row of plan.filter((r) => r.outcome === "create")) {
        if (kind === "affiliates") continue;
        const id = `${batchId}-${row.line}`;
        people.push({ id, firstName: row.firstName, state: row.state ?? "TX", phone: row.phoneE164!, salesperson: viewer?.handle ?? null, locale: inviteLocale, invitedAt: null });
        added.push({
          id,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phoneE164!,
          email: row.email,
          state: row.state ?? "TX",
          addressLines: [],
          salesperson: viewer?.handle ?? "carmen",
          createdAt: now,
          signedUpAt: null,
          agreementSignedAt: null,
          documents: [],
          report: null,
          answers: {},
          rounds: [],
          billing: { paymentMethod: null, charges: [], pause: null },
          lastActivityAt: now,
          notes: [],
          questions: [],
          handled: {},
          locale: inviteLocale,
          leadSource: { channel: "crc_import" },
        });
      }
      saveTeamActions({ ...team, added: [...team.added, ...added] });
      const prev = readDemoLog();
      const next = {
        batches: [{ id: batchId, kind, fileName: file.name, at: now, by: viewer?.name ?? "", rows: plan.length, created: kind === "affiliates" ? summary.create : added.length, dropped: dropped.map((i) => header[i]!), undoneAt: null, kept: null }, ...prev.batches],
        rows: [...prev.rows, ...plan.map((r) => ({ batchId, line: r.line, outcome: r.outcome === "create" ? "created" : r.outcome, shortName: shortName(r), reasons: r.reasons, prospectId: r.outcome === "create" && kind !== "affiliates" ? `${batchId}-${r.line}` : null }))],
        people: [...prev.people, ...people],
      };
      writeDemoLog(next);
      setLog(next);
      await reload();
    } else {
      const res = await fetch("/api/staff/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The SSN and birth-date columns never leave this browser.
        body: JSON.stringify({ action: "import", kind, fileName: file.name, fileSha256: file.sha, rows: file.rows.map((r) => keep.map((i) => r[i] ?? "")), mapping: Object.fromEntries(Object.entries(safeMapping(header, mapping)).map(([f, i]) => [f, keep.indexOf(i as number)])), includeInactive, locale: inviteLocale }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as { error?: string; created?: number } | undefined;
      if (!res?.ok) {
        setBusy(false);
        return setMessage(res?.status === 409 ? t("Este archivo ya se importó.", "This file was imported already.") : (body?.error ?? t("No se pudo importar.", "Couldn't import it.")));
      }
      await loadLog();
      await reload();
    }
    setBusy(false);
    setFile(null);
    setMessage(t("Listo. Abajo está el registro de la importación, con la invitación de cada persona.", "Done. The import log is below, with each person's invitation."));
  };

  const undo = async (batch: Batch) => {
    if (!window.confirm(t("¿Deshacer esta importación? Se quitan las personas que todavía no fueron invitadas.", "Undo this import? The people not invited yet are removed."))) return;
    if (demo) {
      const prev = readDemoLog();
      const team = loadTeamActions();
      const invited = new Set(prev.people.filter((p) => p.id.startsWith(batch.id) && p.invitedAt).map((p) => p.id));
      saveTeamActions({ ...team, added: team.added.filter((c) => !c.id.startsWith(batch.id) || invited.has(c.id)) });
      const next = {
        batches: prev.batches.map((b) => (b.id === batch.id ? { ...b, undoneAt: new Date().toISOString(), kept: invited.size } : b)),
        rows: prev.rows.map((r) => (r.batchId === batch.id && r.outcome === "created" ? { ...r, outcome: r.prospectId && invited.has(r.prospectId) ? "kept" : "undone" } : r)),
        people: prev.people.filter((p) => !p.id.startsWith(batch.id) || invited.has(p.id)),
      };
      writeDemoLog(next);
      setLog(next);
      await reload();
      return;
    }
    await fetch("/api/staff/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "undo", batchId: batch.id }) }).catch(() => null);
    await loadLog();
    await reload();
  };

  const markInvited = (person: Person) => {
    if (!demo) return;
    const prev = readDemoLog();
    const next = { ...prev, people: prev.people.map((p) => (p.id === person.id ? { ...p, invitedAt: new Date().toISOString() } : p)) };
    writeDemoLog(next);
    setLog(next);
  };

  const inviteLink = (p: Person) => {
    const path = buildInvitePath({ name: p.firstName, goal: "general", state: p.state, ref: p.salesperson, refName: viewer?.name?.split(" ")[0] ?? null, lang: p.locale });
    return `${typeof window === "undefined" ? "" : window.location.origin}${path}`;
  };

  const fields = FIELDS_BY_KIND[kind];
  const shown = plan.filter((r) => filter === "all" || r.outcome === filter);
  const outcomeLabel: Record<string, string> = {
    create: t("Se crea", "Will be created"),
    created: t("Creado", "Created"),
    duplicate: t("Duplicado", "Duplicate"),
    problem: t("Problema", "Problem"),
    skip: t("Se omite", "Skipped"),
    skipped: t("Omitido", "Skipped"),
    undone: t("Deshecho", "Undone"),
    kept: t("Se quedó (ya invitado)", "Kept (already invited)"),
  };

  return (
    <main className="animate-rise space-y-6" data-testid="crc-import">
      <header>
        <h1 className="page-title">{t("Importar de Credit Repair Cloud", "Import from Credit Repair Cloud")}</h1>
        <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-slate-600">
          {t(
            "Sube la exportación CSV de CRC. Revisa las columnas, mira la prueba (qué se crea, duplicados por teléfono o correo, problemas) y luego importa. Cada persona queda como prospecto con su invitación para terminar en Credalti: firma el acuerdo de Credalti y no se le cobra nada. Puedes deshacer una importación.",
            "Upload CRC's CSV export. Check the columns, look at the dry run (what will be created, duplicates by phone or email, problems), then import. Each person becomes a prospect with an invitation to finish in Credalti: they sign Credalti's agreement and nothing is charged. You can undo an import.",
          )}
        </p>
        {demo && (
          <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] text-blue-900">
            {t("Demo: usa el archivo de ejemplo (personas inventadas). Lo importado se guarda solo en este navegador.", "Demo: use the sample file (made-up people). What you import is kept only in this browser.")}
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("Qué importar", "What to import")}>
        {(
          [
            ["clients", t("Clientes", "Clients")],
            ["leads", t("Prospectos", "Leads")],
            ["affiliates", t("Afiliados", "Affiliates")],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={pillTab(kind === k)}
            onClick={() => {
              setKind(k);
              setFile(null);
              setMessage(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="card px-5 py-5" aria-labelledby="paso-archivo">
        <h2 id="paso-archivo" className="console-label">
          {t("1 · El archivo", "1 · The file")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
          {kind === "affiliates"
            ? t("En CRC: Afiliados → Exportar. Cada afiliado recibe una invitación para solicitar ser socio de Credalti (acepta las reglas de socios él mismo).", "In CRC: Affiliates → Export. Each affiliate gets an invitation to apply as a Credalti partner (they accept the partner rules themselves).")
            : t("En CRC: Clientes → el icono de flechas → Exportar CSV. El archivo se llama «my_clients_fecha» aunque filtres prospectos.", "In CRC: Clients → the arrows icon → Export CSV. The file is named “my_clients_date” even when you filter leads.")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className={`${ROW_BUTTON} cursor-pointer`}>
            {t("Elegir el CSV", "Choose the CSV")}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="crc-file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) await choose(f.name, await f.text());
              }}
            />
          </label>
          {demo && kind !== "affiliates" && (
            <button type="button" className={ROW_BUTTON} onClick={() => void choose("my_clients_sample.csv", SAMPLE_CSV)} data-testid="crc-sample">
              {t("Usar el archivo de ejemplo", "Use the sample file")}
            </button>
          )}
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-700">
          {t(
            "Las columnas de número de Seguro Social, ITIN y fecha de nacimiento se quitan aquí, en este navegador, antes de todo: no se envían ni se guardan. Un número que parezca de Seguro Social en otra columna también se borra.",
            "Social Security number, ITIN and date-of-birth columns are removed here, in this browser, before anything else: they are never sent or stored. A number that looks like an SSN in any other column is erased too.",
          )}
        </p>
      </section>

      {file && (
        <>
          <section className="card px-5 py-5" aria-labelledby="paso-columnas">
            <h2 id="paso-columnas" className="console-label">
              {t("2 · Las columnas", "2 · The columns")}
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              {file.name} · {t(`${file.rows.length - 1} filas`, `${file.rows.length - 1} rows`)}
            </p>
            {dropped.length > 0 && (
              <p className="mt-3 rounded-xl bg-green-50 px-3 py-2.5 text-[14px] text-green-800" data-testid="dropped-columns">
                {t("Quitadas y nunca guardadas:", "Removed and never stored:")} <strong>{dropped.map((i) => header[i]).join(", ")}</strong>
              </p>
            )}
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
              {t(
                "Encontramos estas columnas por su nombre en CRC. Los nombres no se pudieron comprobar con una exportación real: revisa cada una y cámbiala si hace falta. Una columna sin usar no se guarda.",
                "We found these columns by CRC's names. The names couldn't be checked against a real export: look at each one and change it if needed. A column not used is not stored.",
              )}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f: ImportField) => (
                <label key={f} className="block text-[13px] font-medium text-slate-700">
                  {FIELD_LABEL[locale][f]}
                  <select
                    className={`${field} mt-1`}
                    value={mapping[f] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                    data-testid={`map-${f}`}
                  >
                    <option value="">{t("— sin usar —", "— not used —")}</option>
                    {header.map((h, i) =>
                      dropped.includes(i) ? null : (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              {kind !== "affiliates" && (
                <label className="flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
                  <input type="checkbox" className="h-5 w-5" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                  {t("Importar también los inactivos o cancelados de CRC (como prospectos)", "Also import CRC's inactive or cancelled people (as leads)")}
                </label>
              )}
              {kind !== "affiliates" && (
                <label className="block text-[13px] font-medium text-slate-700 sm:w-56">
                  {t("Idioma de la invitación", "Invitation language")}
                  <select className={`${field} mt-1`} value={inviteLocale} onChange={(e) => setInviteLocale(e.target.value === "es" ? "es" : "en")}>
                    <option value="en">English</option>
                    <option value="es">Español</option>
                  </select>
                </label>
              )}
            </div>
          </section>

          <section aria-labelledby="paso-prueba">
            <SectionTitle>
              <span id="paso-prueba">{t("3 · La prueba: nada se ha guardado", "3 · The dry run: nothing is saved yet")}</span>
            </SectionTitle>
            <div className="flex flex-wrap gap-1.5" data-testid="dry-run-summary">
              {(
                [
                  ["all", t(`Todas · ${summary.rows}`, `All · ${summary.rows}`)],
                  ["create", t(`Se crean · ${summary.create}`, `To create · ${summary.create}`)],
                  ["duplicate", t(`Duplicados · ${summary.duplicate}`, `Duplicates · ${summary.duplicate}`)],
                  ["problem", t(`Problemas · ${summary.problem}`, `Problems · ${summary.problem}`)],
                  ["skip", t(`Se omiten · ${summary.skip}`, `Skipped · ${summary.skip}`)],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className={pillTab(filter === k)} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
            {kind !== "affiliates" && summary.create > 0 && (
              <p className="mt-3 text-[14px] text-slate-700">
                {t(
                  `Se crean ${summary.create}: ${summary.clients} clientes de CRC y ${summary.leads} prospectos. Todos empiezan en Credalti como prospectos con su invitación.`,
                  `${summary.create} will be created: ${summary.clients} CRC ${summary.clients === 1 ? "client" : "clients"} and ${summary.leads} ${summary.leads === 1 ? "lead" : "leads"}. All start in Credalti as prospects with their invitation.`,
                )}
              </p>
            )}
            <div className="card mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[14px]">
                <thead>
                  <tr>
                    <th className="px-4 py-2.5">{t("Fila", "Row")}</th>
                    <th className="px-4 py-2.5">{t("Nombre", "Name")}</th>
                    <th className="px-4 py-2.5">{t("En CRC", "In CRC")}</th>
                    <th className="px-4 py-2.5">{t("Qué pasa", "What happens")}</th>
                    <th className="px-4 py-2.5">{t("Por qué", "Why")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line} className="border-t hairline align-top">
                      <td className="px-4 py-2.5 tabular-nums text-slate-500">{r.line}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{shortName(r) || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">{kind === "affiliates" ? r.company ?? "—" : CRC_STATUS_LABEL[locale][r.status]}</td>
                      <td className="px-4 py-2.5">
                        <Chip tone={OUTCOME_TONE[r.outcome]!}>{outcomeLabel[r.outcome]}</Chip>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{r.reasons.map((x) => ROW_REASON_TEXT[locale][x]).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={busy || summary.create === 0} onClick={() => void runImport()} className={PRIMARY_BUTTON} data-testid="crc-run">
                {busy
                  ? t("Importando…", "Importing…")
                  : kind === "affiliates"
                    ? t(`Importar ${summary.create} afiliados`, `Import ${summary.create} affiliates`)
                    : t(`Crear ${summary.create} prospectos`, `Create ${summary.create} prospects`)}
              </button>
              <span className="text-[13px] text-slate-500">{t("Nada se cobra. Nadie recibe un mensaje hasta que alguien envíe su invitación.", "Nothing is charged. Nobody gets a message until someone sends their invitation.")}</span>
            </div>
          </section>
        </>
      )}

      {message && (
        <p role="status" className="rounded-2xl bg-slate-100 px-4 py-3 text-[14px] text-slate-800">
          {message}
        </p>
      )}

      <section aria-labelledby="registro">
        <SectionTitle>
          <span id="registro">{t("Registro de importaciones", "Import log")}</span>
        </SectionTitle>
        {log.batches.length === 0 ? (
          <EmptyState pose="envelope" title={t("Todavía no hay importaciones", "No imports yet")}>{t("Cuando importes un archivo, aquí verás cada fila, la invitación de cada persona y cómo deshacerlo.", "When you import a file, each row, each person's invitation and the undo are here.")}</EmptyState>
        ) : (
          <div className="space-y-4">
            {log.batches.map((b) => {
              const rows = log.rows.filter((r) => r.batchId === b.id);
              const people = log.people.filter((p) => rows.some((r) => r.prospectId === p.id));
              return (
                <article key={b.id} className="card px-5 py-4" data-testid="import-batch">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-[15px] font-semibold text-slate-900">{b.fileName}</p>
                      <p className="text-[13px] text-slate-500">
                        {new Date(b.at).toLocaleString(locale === "es" ? "es-MX" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })} · {b.by} ·{" "}
                        {t(`${b.created} creados de ${b.rows}`, `${b.created} created of ${b.rows}`)}
                      </p>
                      {b.dropped.length > 0 && <p className="text-[13px] text-green-800">{t("Quitadas:", "Removed:")} {b.dropped.join(", ")}</p>}
                    </div>
                    {b.undoneAt ? (
                      <Chip tone="bg-slate-100 text-slate-600">{t(`Deshecha · ${b.kept ?? 0} se quedaron`, `Undone · ${b.kept ?? 0} kept`)}</Chip>
                    ) : (
                      <button type="button" className={ROW_BUTTON} onClick={() => void undo(b)} data-testid="crc-undo">
                        {t("Deshacer", "Undo")}
                      </button>
                    )}
                  </div>
                  {people.length > 0 && !b.undoneAt && (
                    <div className="mt-3 border-t hairline pt-3">
                      <p className="console-label">{t("Invitaciones para terminar en Credalti", "Invitations to finish in Credalti")}</p>
                      <ul className="mt-2 space-y-2">
                        {people.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[14px] text-slate-800">
                              {rows.find((r) => r.prospectId === p.id)?.shortName ?? p.firstName}
                              {p.invitedAt && <span className="ml-2 text-[12px] text-green-700">{t("invitación enviada", "invite sent")}</span>}
                            </span>
                            <span className="flex flex-wrap gap-1.5">
                              <a
                                href={whatsappHref(p.phone, inviteMessage({ name: p.firstName, refName: viewer?.name?.split(" ")[0] ?? null }, inviteLink(p), p.locale))}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => markInvited(p)}
                                className={ROW_BUTTON}
                              >
                                {t("Enviar por WhatsApp", "Send on WhatsApp")}
                              </a>
                              {!demo && (
                                <Link href={`/equipo/invitar?cliente=${p.id}`} className="pressable inline-flex h-11 items-center px-2 text-[14px] font-medium text-blue-700">
                                  {t("Preparar invitación", "Prepare invite")}
                                </Link>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {rows.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[13px] font-medium text-blue-700">{t(`Cada fila (${rows.length})`, `Every row (${rows.length})`)}</summary>
                      <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
                        {rows.map((r) => (
                          <li key={r.line}>
                            {t("Fila", "Row")} {r.line} · {r.shortName || "—"} · {outcomeLabel[r.outcome] ?? r.outcome}
                            {r.reasons.length > 0 ? ` · ${r.reasons.map((x) => ROW_REASON_TEXT[locale][x as keyof (typeof ROW_REASON_TEXT)["en"]] ?? x).join(", ")}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
