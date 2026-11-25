"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { aiByline, BRAND } from "@/lib/brand";
import type { LeadData } from "@/lib/leads/data";
import type { LeadDraftOutcome } from "@/lib/leads/drafts";
import { effectiveStage, firstTouchLine, HANDOFF_LABELS, leadLanguage, leadName, leadPhone, STAGE_HELP, STAGE_LABELS, waitingMinutes, whatsappWindow } from "@/lib/leads/inbox";
import { leadQuestion } from "@/lib/leads/drafts";
import { minutesText } from "@/lib/leads/metrics";
import { LEAD_FOLLOWUP_TEMPLATE, renderLeadTemplate } from "@/lib/leads/templates";
import { PERSON_STAGES, type LeadThread, type PersonStage } from "@/lib/leads/types";
import { bestMatch, type SavedAnswer } from "@/lib/staff/answers";
import { checkStaffReply, type ReplyProblem } from "@/lib/staff/conversation";
import { shortDateTime } from "@/lib/staff/format";
import { LANGUAGE_NAME } from "@/lib/staff/i18n/locale";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import type { Capability, Viewer } from "@/lib/staff/permissions";
import Icon from "@/components/Icon";
import { CharacterAvatar } from "@/components/Character";
import { PRIMARY_BUTTON_COMPACT, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { Bubble, stageTone } from "./LeadBits";
import SafeBoundary from "./SafeBoundary";

// One lead's conversation, like WhatsApp, with everything sales needs around
// it: ✨ Suggest reply (Alti's drafted-reply engine; facts only, checked
// against the rules), the saved answers, «Prepare invitation», notes, who
// works it, the stage (people only: Invited and Signed set themselves), and
// WhatsApp's 24-hour rule (outside it, only the approved template).

interface Props {
  leadId: string;
  data: LeadData;
  viewer: Viewer | null;
  can: (capability: Capability) => boolean;
  now: Date;
  /** Sales and administrators, for assignment: handle → name. */
  members: Array<{ handle: string; name: string }>;
  templates: string[];
  answers: SavedAnswer[];
  onChanged: () => Promise<void> | void;
  onBack?: () => void;
}

export default function LeadConversation(props: Props) {
  const { leadId, data, viewer, can, now, members, templates, answers, onChanged, onBack } = props;
  const { locale } = useStaffLocale();
  const t = useTx();
  const [thread, setThread] = useState<LeadThread | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: ReplyProblem[] } | null>(null);
  const [draft, setDraft] = useState<(LeadDraftOutcome & { demoDraft?: boolean }) | "loading" | null>(null);
  const [note, setNote] = useState("");
  const [showAnswers, setShowAnswers] = useState(false);

  const load = useCallback(async () => setThread(await data.thread(leadId)), [data, leadId]);
  useEffect(() => {
    setThread(undefined);
    setDraft(null);
    setText("");
    setError(null);
    void load();
  }, [load]);

  const language = thread ? leadLanguage(thread.lead) : "en";
  const typed = useMemo(() => (text.trim() ? checkStaffReply(text, locale) : []), [text, locale]);
  const question = thread ? leadQuestion(thread.messages) : null;
  const match = question ? bestMatch(question, answers, undefined, language) : null;
  const inLanguage = answers.filter((a) => a.language === language);

  if (thread === undefined) return <div className="card px-5 py-8 text-[14px] text-slate-500">{t("Abriendo la conversación…", "Opening the conversation…")}</div>;
  if (thread === null) return <div className="card px-5 py-8 text-[14px] text-slate-600">{t("No encontramos este prospecto, o no está entre los tuyos.", "We couldn't find this lead, or it isn't one of yours.")}</div>;

  const { lead } = thread;
  const stage = effectiveStage(lead);
  const wa = whatsappWindow(lead.lastInboundAt, now);
  const waited = waitingMinutes(lead, now);
  const after = async (result: { ok: boolean; message?: string; problems?: ReplyProblem[] }) => {
    if (!result.ok) {
      setError({ message: result.message ?? t("No se pudo.", "That didn't work."), problems: result.problems });
      return false;
    }
    setError(null);
    await Promise.all([load(), onChanged()]);
    return true;
  };
  const run = async (fn: () => Promise<{ ok: boolean; message?: string; problems?: ReplyProblem[] }>) => {
    setBusy(true);
    try {
      return await after(await fn());
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (await run(() => data.reply(lead.id, text))) {
      setText("");
      setDraft(null);
    }
  };
  const inviteHref = `/equipo/invitar?lead=${lead.id}${lead.prospectId ? `&cliente=${lead.prospectId}` : ""}`;
  const canAssign = can("clients.assign");
  const templateApproved = templates.includes(LEAD_FOLLOWUP_TEMPLATE.name);
  const memberName = (handle: string | null) => (handle ? (members.find((m) => m.handle === handle)?.name ?? handle) : t("Nadie todavía", "Nobody yet"));

  return (
    <div className="space-y-4" data-testid="lead-conversation">
      {/* Who, where from, and the facts */}
      <section className="card px-4 py-4 sm:px-5">
        {onBack && (
          <button type="button" onClick={onBack} className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[14px] font-medium text-blue-700 md:hidden">
            <Icon name="chevron" size={16} className="rotate-180" />
            {t("Prospectos", "Leads")}
          </button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[22px] font-semibold leading-tight text-slate-900">{leadName(lead)}</h2>
            <p className="mt-0.5 text-[14px] text-slate-600 tabular-nums">{leadPhone(lead.phone)}</p>
            <p className="mt-1 text-[13.5px] font-medium text-blue-700">{firstTouchLine(lead, locale)}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${stageTone(stage)}`} data-testid="lead-stage">
            {STAGE_LABELS[locale][stage]}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">{t("Idioma", "Language")}</dt>
            <dd className="font-semibold text-slate-900">{LANGUAGE_NAME[locale][language]}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("Estado", "State")}</dt>
            <dd className="font-semibold text-slate-900">{lead.state ?? t("No lo sabemos", "Unknown")}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("Llegó", "Arrived")}</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">{shortDateTime(lead.createdAt, locale)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("Espera", "Waiting")}</dt>
            <dd className={`font-semibold tabular-nums ${waited !== null && waited >= 60 ? "text-red-700" : "text-slate-900"}`}>{waited === null ? t("No", "No") : minutesText(waited)}</dd>
          </div>
        </dl>
        {lead.signup && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-700">
            {t(`Registro con Alti: ${lead.signup.caseRef}, va en el paso «${lead.signup.step}».`, `Chat signup: ${lead.signup.caseRef}, at the “${lead.signup.step}” step.`)}
            {lead.signup.wantsPerson && <span className="font-semibold">{t(" Pidió hablar con una persona.", " Asked to talk to a person.")}</span>}
          </p>
        )}

        {/* Stage, assignment, invitation */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="lead-stage-select" className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              {t("Etapa (la mueve una persona)", "Stage (a person moves it)")}
            </label>
            {stage === "invited" || stage === "signed" ? (
              <p className="mt-1 text-[13.5px] leading-snug text-slate-700">{STAGE_HELP[locale][stage]}</p>
            ) : (
              <select
                id="lead-stage-select"
                value={lead.stage}
                disabled={busy}
                onChange={(e) => void run(() => data.move(lead.id, e.target.value as PersonStage))}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[15px]"
                data-testid="stage-select"
              >
                {PERSON_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[locale][s]}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label htmlFor="lead-assign" className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              {t("Lo atiende", "Worked by")}
            </label>
            {canAssign ? (
              <select
                id="lead-assign"
                value={lead.salesperson ?? ""}
                disabled={busy}
                onChange={(e) => void run(() => data.assign(lead.id, e.target.value || null))}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[15px]"
              >
                <option value="">{t("Nadie todavía", "Nobody yet")}</option>
                {members.map((m) => (
                  <option key={m.handle} value={m.handle}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 flex min-h-11 items-center gap-2 text-[15px] font-semibold text-slate-900">
                {memberName(lead.salesperson)}
                {!lead.salesperson && viewer && (
                  <button type="button" className={ROW_BUTTON} disabled={busy} onClick={() => void run(() => data.assign(lead.id, viewer.handle))}>
                    {t("Tomarlo", "Take it")}
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {can("clients.invite") && !lead.signedAt && (
            <Link href={inviteHref} className={SECONDARY_BUTTON_COMPACT} data-testid="prepare-invitation">
              <Icon name="mail" size={16} className="mr-1.5" />
              {lead.invitedAt ? t("Ver la invitación", "See the invitation") : t("Preparar su invitación", "Prepare invitation")}
            </Link>
          )}
          {lead.invitedAt && <span className="inline-flex min-h-11 items-center text-[13px] text-slate-600">{t(`Invitación enviada ${shortDateTime(lead.invitedAt, "es")}`, `Invitation sent ${shortDateTime(lead.invitedAt, "en")}`)}</span>}
        </div>
      </section>

      {/* Banners: a person is needed, STOP, the window */}
      {lead.handoff && (
        <p className="flex gap-2 rounded-[12px] bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-800" data-testid="handoff-banner">
          <Icon name="info" size={18} className="mt-px shrink-0" />
          <span>
            <span className="font-semibold">{t("El piloto automático no respondió: ", "The autopilot did not answer: ")}</span>
            {HANDOFF_LABELS[locale][lead.handoff.reason]}. {t("Le toca a una persona.", "This one is a person's.")}
          </span>
        </p>
      )}
      {lead.optedOutAt ? (
        <p className="rounded-[12px] bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-700" data-testid="optout-banner">
          {t(`Pidió que no le escribamos (BAJA) el ${shortDateTime(lead.optedOutAt, "es")}. No se puede enviar nada hasta que escriba ALTA.`, `Said STOP on ${shortDateTime(lead.optedOutAt, "en")}. Nothing can be sent until they write START.`)}
        </p>
      ) : (
        <p className={`rounded-[12px] px-4 py-2.5 text-[13.5px] leading-snug ${wa.state === "closed" ? "bg-slate-100 text-slate-700" : wa.closing ? "bg-amber-100 text-blue-900" : "bg-green-50 text-green-800"}`} data-testid="window-banner">
          {wa.state === "open"
            ? t(`Ventana de WhatsApp abierta: ${wa.hoursLeft} h para responder con texto libre.`, `WhatsApp window open: ${wa.hoursLeft} h left to reply with any text.`)
            : t("Ventana de WhatsApp cerrada (más de 24 h desde su último mensaje): solo la plantilla aprobada.", "WhatsApp window closed (over 24 h since their last message): only the approved template.")}
        </p>
      )}

      {/* The conversation */}
      <SafeBoundary>
        <section className="rounded-[14px] border border-slate-200 bg-[#ECEEF2] px-3 py-4 sm:px-4" aria-label={t("Conversación", "Conversation")}>
          {thread.messages.length === 0 ? (
            <p className="px-2 py-6 text-center text-[14px] text-slate-600">
              {t("Todavía no hay mensajes. El primero lo escribe una persona, por WhatsApp.", "No messages yet. The first one is written by a person, on WhatsApp.")}
            </p>
          ) : (
            <ol className="space-y-2.5">
              {thread.messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
            </ol>
          )}
          {thread.external && !thread.external.ok && <p className="mt-2 px-1 text-[12px] text-slate-500">{t("No se pudo leer la conversación en HighLevel ahora.", "HighLevel's conversation couldn't be read right now.")}</p>}
        </section>
      </SafeBoundary>

      {/* Writing */}
      {!lead.optedOutAt && (
        <section className="card px-4 py-4 sm:px-5" aria-label={t("Responder", "Reply")}>
          <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-500">
            <span>
              <span aria-hidden="true">🌐 </span>
              {t("Se envía en:", "Goes out in:")} <span className="font-semibold text-slate-700">{LANGUAGE_NAME[locale][language]}</span> · WhatsApp
            </span>
            <span>{t("Nunca por mensaje de texto (SMS).", "Never by text message (SMS).")}</span>
          </p>
          {wa.state === "closed" ? (
            <div data-testid="template-box">
              <p className="text-[13px] font-semibold text-slate-700">{t("Plantilla aprobada", "Approved template")} · {LEAD_FOLLOWUP_TEMPLATE.name}</p>
              <p className="mt-1 whitespace-pre-wrap rounded-[12px] bg-slate-50 px-3 py-2.5 text-[14px] leading-snug text-slate-800">
                {renderLeadTemplate(LEAD_FOLLOWUP_TEMPLATE, language, [lead.name?.split(" ")[0] ?? "", viewer?.name.split(" ")[0] ?? ""])}
              </p>
              {templateApproved ? (
                <button type="button" disabled={busy} className={`${PRIMARY_BUTTON_COMPACT} mt-3`} onClick={() => void run(() => data.sendTemplate(lead.id, LEAD_FOLLOWUP_TEMPLATE.name))}>
                  {t("Enviar la plantilla", "Send the template")}
                </button>
              ) : (
                <p className="mt-2 text-[13px] leading-snug text-slate-600">
                  {t("Todavía no está aprobada en Meta, así que no se puede enviar nada hasta que escriba de nuevo.", "It isn't approved in Meta yet, so nothing can be sent until they write again.")}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={ROW_BUTTON}
                  disabled={draft === "loading" || !question}
                  onClick={async () => {
                    setDraft("loading");
                    setDraft(await data.suggest(lead.id));
                  }}
                  data-testid="suggest-reply"
                >
                  <span aria-hidden="true" className="mr-1.5">✨</span>
                  {t("Sugerir respuesta", "Suggest reply")}
                </button>
                <button type="button" className={QUIET_BUTTON} onClick={() => setShowAnswers(!showAnswers)} aria-expanded={showAnswers} data-testid="saved-answers">
                  <Icon name="book" size={16} />
                  {t("Respuestas guardadas", "Saved answers")}
                </button>
              </div>
              {draft === "loading" && <p className="mt-3 text-[13.5px] text-slate-500">{t(`${BRAND.assistant} está escribiendo un borrador…`, `${BRAND.assistant} is writing a draft…`)}</p>}
              {draft && draft !== "loading" && (
                <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3" data-testid="lead-draft">
                  <p className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
                    <CharacterAvatar character="assistant" size={32} tone="navy" decorative />
                    <span>
                      <span className="block text-slate-900">{aiByline(locale)}</span>
                      <span className="block font-medium">{t(`Borrador de ${BRAND.assistant} (IA): revísalo antes de enviar`, `${BRAND.assistant}'s draft (AI): check it before sending`)}</span>
                    </span>
                    {draft.demoDraft && <span className="font-normal text-slate-500">{t(" · demo, sin modelo", " · demo, no model")}</span>}
                  </p>
                  {draft.ok ? (
                    <>
                      <p className="mt-2 whitespace-pre-wrap text-[14.5px] leading-snug text-slate-900">{draft.draft}</p>
                      <div className="mt-3 flex gap-2">
                        <button type="button" className={SECONDARY_BUTTON_COMPACT} onClick={() => setText(draft.draft)} data-testid="use-draft">
                          {t("Usar este borrador", "Use this draft")}
                        </button>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
                        {t("Solo hechos del servicio y de las preguntas frecuentes. Ya pasó las reglas; se revisan otra vez al enviar.", "Only facts about the service and from the FAQ. It already passed the rules; they're checked again when you send.")}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[14px] leading-snug text-slate-700">{draft.message}</p>
                  )}
                </div>
              )}
              {showAnswers && (
                <div className="mt-3 rounded-[12px] bg-slate-50 px-3 py-3" data-testid="answers-list">
                  {inLanguage.length === 0 ? (
                    <p className="text-[13.5px] text-slate-600">{t("No hay respuestas aprobadas en este idioma todavía.", "No approved answers in this language yet.")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {[...(match ? [match.answer] : []), ...inLanguage.filter((a) => a.id !== match?.answer.id)].slice(0, 4).map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => setText(a.answer)} className="pressable block w-full rounded-xl bg-white px-3 py-2 text-left shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:bg-blue-50">
                            <span className="block text-[12.5px] font-semibold text-slate-500">
                              {match?.answer.id === a.id ? t("La que más se parece · ", "Closest match · ") : ""}
                              {a.question}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug text-slate-800">{a.answer}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <label htmlFor="lead-reply" className="sr-only">
                {t("Tu respuesta", "Your reply")}
              </label>
              <textarea
                id="lead-reply"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder={t("Escribe tu respuesta. Va firmada con tu nombre.", "Write your reply. It goes out signed with your name.")}
                className="mt-3 w-full rounded-[12px] border border-slate-300 bg-white px-3.5 py-3 text-[16px] leading-snug"
                data-testid="lead-reply"
              />
              {typed.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-xl bg-red-50 px-3 py-2 text-[13px] leading-snug text-red-800" data-testid="reply-problems">
                  {typed.map((p, i) => (
                    <li key={i}>
                      <span className="font-semibold">«{p.phrase}»</span> — {p.why}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[12px] leading-snug text-slate-500">{t("Sin resultados, sin precios fuera del plan, sin presión. Nada de vender por teléfono.", "No results, no prices outside the plan, no pressure. No selling by phone.")}</p>
                <button type="button" disabled={busy || !text.trim() || typed.length > 0} className={`${PRIMARY_BUTTON_COMPACT} shrink-0`} onClick={send} data-testid="send-reply">
                  {t("Enviar", "Send")}
                </button>
              </div>
            </>
          )}
          {error && (
            <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[13.5px] leading-snug text-red-800" role="alert">
              {error.message}
            </div>
          )}
        </section>
      )}

      {/* Notes and history */}
      <section className="card px-4 py-4 sm:px-5" aria-labelledby="lead-notes">
        <h3 id="lead-notes" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {t("Notas del equipo", "Team notes")}
        </h3>
        {thread.notes.length === 0 ? (
          <p className="mt-2 text-[14px] text-slate-500">{t("Sin notas todavía.", "No notes yet.")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {thread.notes.map((n) => (
              <li key={n.id} className="rounded-xl bg-slate-50 px-3 py-2 text-[14px] leading-snug text-slate-800">
                {n.text}
                <span className="mt-0.5 block text-[12px] text-slate-500">
                  {n.author} · {shortDateTime(n.at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <label htmlFor="lead-note" className="sr-only">
            {t("Nota", "Note")}
          </label>
          <input
            id="lead-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder={t("Agrega una nota (solo la ve el equipo)", "Add a note (only the team sees it)")}
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-[16px]"
          />
          <button
            type="button"
            className={SECONDARY_BUTTON_COMPACT}
            disabled={busy || note.trim().length < 2}
            onClick={async () => {
              if (await run(() => data.note(lead.id, note))) setNote("");
            }}
          >
            {t("Guardar", "Save")}
          </button>
        </div>
        {(thread.stageEvents.length > 0 || thread.autoMessages.length > 0) && (
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13.5px] font-semibold text-blue-700 md:min-h-8">{t("Historial", "History")}</summary>
            <ul className="mt-1 space-y-1 text-[13px] leading-snug text-slate-600">
              {[
                ...thread.stageEvents.map((e) => ({ at: e.at, text: t(`${e.by} lo pasó a ${STAGE_LABELS.es[e.to]}`, `${e.by} moved it to ${STAGE_LABELS.en[e.to]}`) })),
                ...thread.autoMessages.map((m) => ({
                  at: m.at,
                  text:
                    m.kind === "handoff"
                      ? t(`Piloto automático: se lo pasó a una persona (${HANDOFF_LABELS.es[(m.reason ?? "no_fact") as keyof typeof HANDOFF_LABELS.es] ?? m.reason})`, `Autopilot: handed to a person (${HANDOFF_LABELS.en[(m.reason ?? "no_fact") as keyof typeof HANDOFF_LABELS.en] ?? m.reason})`)
                      : t(`Piloto automático: ${m.kind} · ${m.status}`, `Autopilot: ${m.kind} · ${m.status}`),
                })),
              ]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((line, i) => (
                  <li key={i} className="tabular-nums">
                    {shortDateTime(line.at, locale)} · {line.text}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
