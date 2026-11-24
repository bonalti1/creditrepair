"use client";

import { useMemo, useState } from "react";
import { agreementDocumentsFor } from "@/lib/agreement/stateDocuments";
import { STATE_LAW, openingSteps, type StateLawStatus } from "@/lib/compliance/stateRules";
import { ALL_STATES, LAW_STATUS_LABEL, stateStatus } from "@/lib/compliance/states";
import { useStateOpenings } from "@/lib/compliance/useOpenStates";
import { deniedReason } from "@/lib/staff/permissions";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { useStaff } from "@/lib/staff/useStaff";
import { DeniedNote, SectionTitle } from "@/components/staff/ui";

// States: where Credalti may sell, what each state's law asks first, and the
// switch that opens a state (with the attorney's review on record). The
// grid is a tile map; the table below lists every state. The research is
// src/lib/compliance/stateRules.ts (docs/STATES.md): leads, not legal advice.

const TILES: Array<[string, number, number]> = [
  ["AK", 0, 0], ["ME", 11, 0],
  ["VT", 10, 1], ["NH", 11, 1],
  ["WA", 1, 2], ["ID", 2, 2], ["MT", 3, 2], ["ND", 4, 2], ["MN", 5, 2], ["IL", 6, 2], ["WI", 7, 2], ["MI", 8, 2], ["NY", 9, 2], ["RI", 10, 2], ["MA", 11, 2],
  ["OR", 1, 3], ["NV", 2, 3], ["WY", 3, 3], ["SD", 4, 3], ["IA", 5, 3], ["IN", 6, 3], ["OH", 7, 3], ["PA", 8, 3], ["NJ", 9, 3], ["CT", 10, 3],
  ["CA", 1, 4], ["UT", 2, 4], ["CO", 3, 4], ["NE", 4, 4], ["MO", 5, 4], ["KY", 6, 4], ["WV", 7, 4], ["VA", 8, 4], ["MD", 9, 4], ["DE", 10, 4],
  ["AZ", 2, 5], ["NM", 3, 5], ["KS", 4, 5], ["AR", 5, 5], ["TN", 6, 5], ["NC", 7, 5], ["SC", 8, 5], ["DC", 9, 5],
  ["OK", 4, 6], ["LA", 5, 6], ["MS", 6, 6], ["AL", 7, 6], ["GA", 8, 6],
  ["HI", 0, 7], ["TX", 4, 7], ["FL", 9, 7],
];

const TONE: Record<StateLawStatus, string> = {
  open: "bg-green-50 text-green-800 ring-green-200",
  registration: "bg-amber-50 text-amber-800 ring-amber-200",
  restricted: "bg-red-50 text-red-800 ring-red-200",
  not_reviewed: "bg-slate-100 text-slate-600 ring-slate-200",
};

const PROBLEM: Record<string, [string, string]> = {
  not_reviewed: ["La ley del estado no está revisada.", "The state's law has not been reviewed."],
  restricted: ["La ley lo restringe: no se puede abrir desde aquí.", "The law restricts it: it cannot be opened from here."],
  attorney_name: ["Escribe el nombre del abogado que lo revisó.", "Type the name of the attorney who reviewed it."],
  attorney_date: ["Pon la fecha de la revisión del abogado.", "Enter the date of the attorney's review."],
  registration_ref: ["Este estado pide registro o licencia: escribe el número.", "This state asks for a registration or license: type the number."],
  bond: ["Este estado pide fianza: confirma que está vigente.", "This state asks for a bond: confirm it is in force."],
  unknown_state: ["Estado desconocido.", "Unknown state."],
  invalid: ["No se pudo guardar.", "It could not be saved."],
};

export default function EstadosPage() {
  const { ready, can, locale } = useStaff();
  const t = useTx();
  const { ready: loaded, rows, save, live } = useStateOpenings();
  const [selected, setSelected] = useState<string>("TX");
  const [attorney, setAttorney] = useState("");
  const [reviewedOn, setReviewedOn] = useState("");
  const [registration, setRegistration] = useState("");
  const [bond, setBond] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const opened = useMemo(() => rows.filter((r) => r.opened).map((r) => r.state), [rows]);
  const counts = useMemo(() => {
    const out: Record<StateLawStatus, number> = { open: 0, registration: 0, restricted: 0, not_reviewed: 0 };
    for (const code of ALL_STATES) out[STATE_LAW[code]!.status] += 1;
    return out;
  }, []);
  const verified = ALL_STATES.filter((c) => STATE_LAW[c]!.verified).length;

  if (!ready || !loaded) return null;
  const admin = can("states.manage");
  const law = STATE_LAW[selected]!;
  const record = rows.find((r) => r.state === selected) ?? null;
  const isOpen = stateStatus(selected, opened) === "open";
  const docs = agreementDocumentsFor(selected);
  const L = LAW_STATUS_LABEL[locale];

  const submit = async (open: boolean) => {
    setBusy(true);
    const result = await save({ state: selected, opened: open, attorneyName: attorney || null, attorneyReviewedOn: reviewedOn || null, registrationRef: registration || null, bondConfirmed: bond });
    setBusy(false);
    setProblems(result.ok ? [] : result.problems);
  };

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Estados", "States")}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        {t(
          "Dónde se puede vender, qué pide la ley de cada estado y el interruptor que lo abre. Un estado sin abrir no recibe prospectos, invitaciones ni registros: se les ofrece la lista de espera. Cada estado necesita la revisión del abogado antes de abrir.",
          "Where we can sell, what each state's law asks first, and the switch that opens it. A state not opened gets no leads, invitations or signups: they're offered the waitlist. Every state needs the attorney's review before opening.",
        )}
      </p>
      {!admin && (
        <div className="mt-3">
          <DeniedNote>{deniedReason("states.manage", locale)}</DeniedNote>
        </div>
      )}
      {!live && (
        <p className="mt-3 max-w-3xl rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {t("Demo: los interruptores se guardan solo en este navegador.", "Demo: the switches are saved only in this browser.")}
        </p>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="state-counts">
        <div className="card px-4 py-3">
          <p className="text-[13px] text-slate-500">{t("Abiertos", "Opened")}</p>
          <p className="text-[26px] font-semibold tabular-nums text-slate-900">{opened.length}</p>
        </div>
        {(Object.keys(counts) as StateLawStatus[]).map((k) => (
          <div key={k} className="card px-4 py-3">
            <p className="text-[13px] text-slate-500">{L[k]}</p>
            <p className="text-[26px] font-semibold tabular-nums text-slate-900">{counts[k]}</p>
          </div>
        ))}
      </section>
      <p className="mt-2 px-1 text-[12px] text-slate-500">
        {t(`${verified} de ${ALL_STATES.length} verificados con la fuente oficial (24 de noviembre de 2026); los demás son pistas por confirmar.`, `${verified} of ${ALL_STATES.length} verified against the official source (November 24, 2026); the rest are leads to confirm.`)}
      </p>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-label={t("Mapa de estados", "State map")}>
          <div className="card p-4">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gridTemplateRows: "repeat(8, minmax(0, 1fr))" }} data-testid="state-grid">
              {TILES.map(([code, col, row]) => {
                const rule = STATE_LAW[code]!;
                const on = opened.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setSelected(code);
                      setProblems([]);
                    }}
                    style={{ gridColumn: col + 1, gridRow: row + 1 }}
                    aria-pressed={selected === code}
                    aria-label={`${rule.name}: ${L[rule.status]}${on ? `, ${t("abierto", "opened")}` : ""}`}
                    className={`pressable relative flex aspect-square flex-col items-center justify-center rounded-lg text-[12px] font-semibold ring-1 ${TONE[rule.status]} ${selected === code ? "outline outline-2 outline-offset-1 outline-blue-700" : ""}`}
                  >
                    {code}
                    {on && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-blue-700" aria-hidden="true" />}
                    {!rule.verified && <span className="text-[9px] font-medium opacity-60">?</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-slate-600">
              {(Object.keys(TONE) as StateLawStatus[]).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={`h-3 w-3 rounded ring-1 ${TONE[k]}`} />
                  {L[k]}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-700" />
                {t("Abierto por Credalti", "Opened by Credalti")}
              </span>
              <span>? {t("sin verificar", "unverified")}</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="detalle" data-testid="state-detail">
          <SectionTitle>
            <span id="detalle">
              {law.name} ({law.code})
            </span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            <div className="flex flex-wrap items-center gap-2 px-5 py-3">
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${TONE[law.status]}`}>{L[law.status]}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${law.verified ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
                {law.verified ? t(`Verificado ${law.verifiedOn}`, `Verified ${law.verifiedOn}`) : t(`Sin verificar · ${law.verifiedOn}`, `Unverified · ${law.verifiedOn}`)}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${isOpen ? "bg-green-600 text-white" : "bg-slate-200 text-slate-700"}`}>{isOpen ? t("Abierto", "Opened") : t("Cerrado: lista de espera", "Closed: waitlist")}</span>
            </div>
            <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-2 px-5 py-4 text-[14px]">
              <dt className="text-slate-500">{t("Ley", "Law")}</dt>
              <dd className="text-slate-900">{law.statute ?? t("No se encontró una ley específica", "No specific statute found")}</dd>
              <dt className="text-slate-500">{t("Registro", "Registration")}</dt>
              <dd className="text-slate-900">
                {law.registration.required === true ? law.registration.agency ?? t("Sí; agencia por confirmar", "Yes; agency to confirm") : law.registration.required === false ? t("No encontrado", "None found") : t("Por confirmar", "To confirm")}
                {law.registration.fee ? ` · ${law.registration.fee}` : ""}
                {law.registration.renewal ? ` · ${law.registration.renewal}` : ""}
              </dd>
              <dt className="text-slate-500">{t("Fianza", "Bond")}</dt>
              <dd className="text-slate-900">{law.bond ?? t("No encontrada", "None found")}</dd>
              <dt className="text-slate-500">{t("Cancelar", "Cancellation")}</dt>
              <dd className="text-slate-900">{law.cancellationDays ? t(`${law.cancellationDays} días hábiles`, `${law.cancellationDays} working days`) : t("3 días hábiles (federal)", "3 business days (federal)")}{law.cancellationNote ? ` — ${law.cancellationNote}` : ""}</dd>
              {law.contract.length > 0 && (
                <>
                  <dt className="text-slate-500">{t("Contrato", "Contract")}</dt>
                  <dd className="text-slate-900">{law.contract.join(" · ")}</dd>
                </>
              )}
              {law.restrictions.length > 0 && (
                <>
                  <dt className="text-slate-500">{t("Restricciones", "Restrictions")}</dt>
                  <dd className="text-slate-900">{law.restrictions.join(" · ")}</dd>
                </>
              )}
              <dt className="text-slate-500">{t("Acuerdo", "Agreement")}</dt>
              <dd className={docs.status === "built" ? "text-slate-900" : "font-medium text-red-700"}>
                {docs.status === "built" ? t("Documentos del estado hechos (revisión del abogado pendiente)", "State documents built (attorney review pending)") : t("Falta el texto del abogado: no se puede firmar", "Needs attorney text: signing is blocked")}
              </dd>
              <dt className="text-slate-500">{t("Fuente", "Source")}</dt>
              <dd className="break-all">
                <a href={law.source} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                  {law.source}
                </a>
              </dd>
            </dl>
            {law.unconfirmed && law.unconfirmed.length > 0 && (
              <div className="px-5 py-3 text-[13px] text-slate-600">
                <p className="font-semibold text-slate-700">{t("Sin confirmar", "Not confirmed")}</p>
                <ul className="mt-1 list-disc pl-5">
                  {law.unconfirmed.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="px-5 py-4">
              <p className="text-[14px] font-semibold text-slate-900">{t("Para abrir", "To open")}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[14px] text-slate-700">
                {openingSteps(law, locale).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {record?.opened && record.attorneyName && (
                <p className="mt-2 text-[13px] text-slate-500">
                  {t(`Abierto con la revisión de ${record.attorneyName} (${record.attorneyReviewedOn}).`, `Opened with ${record.attorneyName}'s review (${record.attorneyReviewedOn}).`)}
                </p>
              )}
              {admin && law.status !== "restricted" && (
                <div className="mt-3 grid gap-2">
                  {!isOpen && (
                    <>
                      <input value={attorney} onChange={(e) => setAttorney(e.target.value)} placeholder={t("Abogado que lo revisó", "Attorney who reviewed it")} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px]" />
                      <input value={reviewedOn} onChange={(e) => setReviewedOn(e.target.value)} type="date" aria-label={t("Fecha de la revisión", "Review date")} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px]" />
                      {law.registration.required && (
                        <input value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder={t("Número de registro o licencia", "Registration or license number")} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px]" />
                      )}
                      {law.bond && (
                        <label className="flex items-center gap-2 text-[14px] text-slate-700">
                          <input type="checkbox" checked={bond} onChange={(e) => setBond(e.target.checked)} />
                          {t("La fianza está vigente", "The bond is in force")}
                        </label>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(!isOpen)}
                    data-testid="state-switch"
                    className={`pressable h-11 rounded-full px-5 text-[15px] font-semibold ${isOpen ? "bg-slate-100 text-red-700" : "bg-blue-700 text-white"} disabled:opacity-60`}
                  >
                    {isOpen ? t(`Cerrar ${law.name}`, `Close ${law.name}`) : t(`Abrir ${law.name}`, `Open ${law.name}`)}
                  </button>
                  {problems.length > 0 && (
                    <ul className="text-[13px] font-medium text-red-700" role="status">
                      {problems.map((p) => (
                        <li key={p}>{(PROBLEM[p] ?? PROBLEM.invalid!)[locale === "es" ? 0 : 1]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="mt-6" aria-labelledby="tabla">
        <SectionTitle>
          <span id="tabla">{t("Todos los estados", "Every state")}</span>
        </SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{t("Estado", "State")}</th>
                <th className="px-4 py-2 font-medium">{t("Situación", "Status")}</th>
                <th className="px-4 py-2 font-medium">{t("Registro", "Registration")}</th>
                <th className="px-4 py-2 font-medium">{t("Fianza", "Bond")}</th>
                <th className="px-4 py-2 font-medium">{t("Cancelar", "Cancel")}</th>
                <th className="px-4 py-2 font-medium">{t("Verificado", "Verified")}</th>
                <th className="px-4 py-2 font-medium">{t("Abierto", "Opened")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/[0.06]">
              {ALL_STATES.map((code) => {
                const r = STATE_LAW[code]!;
                return (
                  <tr key={code} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(code)}>
                    <td className="px-4 py-2 font-medium text-slate-900">{r.name} ({code})</td>
                    <td className="px-4 py-2">{L[r.status]}</td>
                    <td className="px-4 py-2 text-slate-700">{r.registration.required === true ? t("Sí", "Yes") : r.registration.required === false ? t("No", "No") : "?"}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2 text-slate-700">{r.bond ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-700">{r.cancellationDays ? t(`${r.cancellationDays} días`, `${r.cancellationDays} days`) : "3"}</td>
                    <td className="px-4 py-2">{r.verified ? t("Sí", "Yes") : t("No", "No")}</td>
                    <td className="px-4 py-2">{opened.includes(code) ? t("Sí", "Yes") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
