"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { aiByline } from "@/lib/brand";
import { adChecklist, AD_CTAS, AD_FORMATS, AD_GOALS, AD_LANGUAGES, checkAdDraft, languagesOfAd, type AdCopyOutput, type AdCopyResult, type AdFormat, type AdGoal, type AdLanguage } from "@/lib/ads/copy";
import type { useAds } from "@/lib/ads/data";
import { ADS_TEXT } from "@/lib/ads/text";
import type { AdBrief } from "@/lib/ads/types";
import type { ContentIssue } from "@/lib/content/check";
import { useContent } from "@/lib/content/store";
import type { Bilingual } from "@/lib/content/types";
import { shortDay } from "@/lib/staff/format";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import { CharacterAvatar } from "@/components/Character";
import Icon from "@/components/Icon";
import { Chip, DeniedNote, pillTab, PRIMARY_BUTTON, PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, LABEL, Notice } from "@/components/staff/content/ui";

// Ad copy by Alti, the AI assistant (src/lib/ads/copy.ts). A person writes
// the angle; Alti drafts hooks, a headline, the primary text, a description
// and (for a video) the script, in English and Spanish; the draft is checked
// as it is edited (the claim guardrails, the content rules and the
// credit-repair ad checklist). A draft with no blocking issue can go to
// Content (as a new piece, through its normal review and approval) or to
// Video Studio (as a brief). Nothing is posted, and nothing reaches Meta.

export interface CopyExample {
  adId: string;
  name: string;
  headline: string;
  body: string;
}

type Ads = ReturnType<typeof useAds>;

const EMPTY_BI: Bilingual = { en: "", es: "" };

function IssueItem({ issue }: { issue: ContentIssue }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const block = issue.severity === "block";
  return (
    <li className={`rounded-[12px] px-3.5 py-2.5 ${block ? "bg-red-50" : "bg-amber-50"}`} data-testid={`ad-issue-${issue.rule}`} data-severity={issue.severity}>
      <p className={`text-[12px] font-semibold uppercase tracking-wide ${block ? "text-red-700" : "text-blue-900"}`}>
        {block ? t("Impide enviarlo", "Blocks sending") : t("Conviene revisar", "Worth fixing")}
        {issue.lang ? <span className="font-medium normal-case tracking-normal text-slate-600"> · {issue.lang.toUpperCase()}</span> : null}
      </p>
      {issue.match ? <p className="mt-1 text-[13.5px] text-slate-900">“{issue.match}”</p> : null}
      <p className="mt-0.5 text-[13.5px] leading-snug text-slate-700">{issue.explain[locale]}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-slate-600">
        <span className="font-semibold">{t("Qué hacer: ", "What to do: ")}</span>
        {issue.fix[locale]}
      </p>
    </li>
  );
}

/** Two boxes (or one), English and Spanish, for one field of the draft. */
function Pair({ label, value, langs, rows = 2, onChange, testId }: { label: string; value: Bilingual; langs: Array<"en" | "es">; rows?: number; onChange: (v: Bilingual) => void; testId?: string }) {
  return (
    <fieldset className="min-w-0" data-testid={testId}>
      <legend className={LABEL}>{label}</legend>
      <div className={`mt-1 grid gap-2 ${langs.length > 1 ? "md:grid-cols-2" : ""}`}>
        {langs.map((l) => (
          <label key={l} className="block min-w-0">
            <span className="sr-only">{`${label} (${l.toUpperCase()})`}</span>
            <span className="mb-0.5 block text-[11px] font-semibold text-slate-500" aria-hidden="true">
              {l.toUpperCase()}
            </span>
            <textarea lang={l} rows={rows} className={`${FIELD} py-2 leading-snug`} value={value[l]} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** «Send to Content»: a new piece from the draft, through Content's own rules (content.edit). Mounted only when a draft exists. */
function SendToContent({ copy, language, format, title, disabled }: { copy: AdCopyOutput; language: AdLanguage; format: AdFormat; title: string; disabled: boolean }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(ADS_TEXT);
  const content = useContent();
  const [state, setState] = useState<{ ok: true; id: string } | { ok: false; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = can(content.role, "content.edit");
  if (!allowed) return <DeniedNote>{deniedReason("content.edit", locale)}</DeniedNote>;
  const send = async () => {
    setBusy(true);
    const ctaText = (text.cta as Record<string, string>)[copy.cta] ?? copy.cta;
    const ctaEs = (ADS_TEXT.es.cta as Record<string, string>)[copy.cta] ?? copy.cta;
    const ctaEn = (ADS_TEXT.en.cta as Record<string, string>)[copy.cta] ?? ctaText;
    const res = await content.act({
      action: "create",
      title: `${t("Anuncio", "Ad")}: ${(copy.headline[locale] || copy.headline.en || title).slice(0, 100)}`,
      type: format === "video" ? "short_video" : format === "carousel" ? "carousel" : "image",
      channels: ["facebook", "instagram"],
      language,
      audience: "consumers",
      theme: "process",
      goal: t("Borrador de anuncio de Meta de Alti (IA), desde el Administrador de anuncios.", "A Meta ad draft by Alti (AI), from the Ads Manager."),
      copy: { hook: copy.hooks[0] ?? EMPTY_BI, onScreen: copy.onScreen, script: copy.script, caption: copy.primaryText, cta: { en: ctaEn, es: ctaEs } },
      characters: [],
      aiDraft: true,
    });
    setBusy(false);
    setState(res.ok && res.piece ? { ok: true, id: res.piece.id } : { ok: false, message: res.ok ? t("No se pudo crear la pieza.", "The piece could not be created.") : res.message[locale] });
  };
  return (
    <div className="min-w-0">
      {state?.ok ? (
        <Link href={`/equipo/contenido/pieza/${state.id}`} className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`} data-testid="open-piece">
          <Icon name="check" size={16} />
          {t("Pieza creada: abrirla", "Piece made: open it")}
        </Link>
      ) : (
        <button type="button" onClick={send} disabled={disabled || busy} className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`} data-testid="send-content">
          <Icon name="grid" size={16} />
          {busy ? t("Creando…", "Making it…") : t("Mandar a Contenido", "Send to Content")}
        </button>
      )}
      {state && !state.ok && <p className="mt-1 text-[13px] text-red-700" role="alert">{state.message}</p>}
    </div>
  );
}

export default function CopyStudio({ ads, examples, initialExample, briefs }: { ads: Ads; examples: CopyExample[]; initialExample: CopyExample | null; briefs: AdBrief[] }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(ADS_TEXT);
  const { viewer } = useViewer();
  const [angle, setAngle] = useState("");
  const [format, setFormat] = useState<AdFormat>("video");
  const [goal, setGoal] = useState<AdGoal>("whatsapp");
  const [language, setLanguage] = useState<AdLanguage>("both");
  const [exampleId, setExampleId] = useState<string>(initialExample?.adId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdCopyResult | null>(null);
  const [copy, setCopy] = useState<AdCopyOutput | null>(null);
  const [brief, setBrief] = useState<{ ok: true } | { ok: false; message: string } | null>(null);

  useEffect(() => {
    if (initialExample) {
      setExampleId(initialExample.adId);
      setAngle((a) => a || t(`Una variación de «${initialExample.name}»`, `A variation of “${initialExample.name}”`));
    }
    // Only when a new example is handed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExample?.adId]);

  const allowed = can(viewer?.role, "ads.draft");
  const example = examples.find((e) => e.adId === exampleId) ?? (initialExample?.adId === exampleId ? initialExample : null);
  const langs = languagesOfAd(language);
  const issues = useMemo(() => (copy ? checkAdDraft(copy, language) : []), [copy, language]);
  const blocking = issues.filter((i) => i.severity === "block");
  const checklist = adChecklist(issues);

  const write = async () => {
    setBusy(true);
    setError(null);
    setBrief(null);
    const out = await ads.draft({ angle, format, goal, language, example: example ? { headline: example.headline, body: example.body } : null });
    setBusy(false);
    if (!out.ok) return setError(out.message[locale]);
    setResult(out.value);
    setCopy({ hooks: out.value.hooks, primaryText: out.value.primaryText, headline: out.value.headline, description: out.value.description, script: out.value.script, onScreen: out.value.onScreen, cta: out.value.cta });
  };

  const sendBrief = async () => {
    if (!copy) return;
    const out = await ads.brief({ title: (copy.headline[locale] || copy.headline.en || angle).slice(0, 120) || "Ad brief", copy, format, goal, language, sourceAdId: example?.adId ?? null });
    setBrief(out.ok ? { ok: true } : { ok: false, message: out.message[locale] });
  };

  const sourceNote = (r: AdCopyResult) =>
    r.source === "model"
      ? t("Lo escribió Alti (IA). Léelo y edítalo antes de mandarlo a cualquier parte.", "Written by Alti (AI). Read and edit it before it goes anywhere.")
      : r.note === "not_configured"
        ? t("Escrito desde una plantilla ya revisada: el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY).", "Written from a pre-checked template: the server has no Claude key (ANTHROPIC_API_KEY).")
        : t("Claude no pudo escribir esta vez; esto sale de una plantilla ya revisada.", "Claude could not write this time; this comes from a pre-checked template.");

  const goalLabel: Record<AdGoal, string> = { whatsapp: t("Chat de WhatsApp", "WhatsApp chat"), website: t("El sitio (chat de registro)", "The website (signup chat)"), form: t("Formulario de Meta", "Meta lead form") };
  const formatLabel: Record<AdFormat, string> = { video: t("Video", "Video"), image: t("Imagen", "Picture"), carousel: t("Carrusel", "Carousel") };
  const languageLabel: Record<AdLanguage, string> = { en: "English", es: "Español", both: t("Los dos", "Both") };

  if (!allowed) return <DeniedNote>{deniedReason("ads.draft", locale)}</DeniedNote>;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]" data-testid="copy-studio">
      <div className="min-w-0">
        <section className="card px-5 py-4" aria-labelledby="copy-title">
          <div className="flex items-start gap-3">
            <CharacterAvatar character="assistant" size={44} tone="navy" ring decorative />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500" data-testid="copy-byline">
                {aiByline(locale)}
              </p>
              <h2 id="copy-title" className="mt-0.5 font-display text-[17px] font-semibold text-blue-900">
                {t("Textos de anuncios con Alti", "Ad copy with Alti")}
              </h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">
                {t(
                  "Dile de qué trata el anuncio. Alti escribe un borrador en inglés y español, revisado con las reglas de lo que se puede decir y la lista para anuncios de crédito. Una persona lo edita; nada se publica desde aquí.",
                  "Tell Alti what the ad is about. He drafts it in English and Spanish, checked against the claim rules and the credit ad checklist. A person edits it; nothing is published from here.",
                )}
              </p>
            </div>
          </div>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (angle.trim().length >= 3) void write();
            }}
          >
            <label className="block">
              <span className={LABEL}>{t("¿De qué trata el anuncio?", "What is the ad about?")}</span>
              <textarea className={`${FIELD} mt-1 py-2`} rows={2} maxLength={300} value={angle} onChange={(e) => setAngle(e.target.value)} placeholder={t("p. ej. tus derechos para disputar errores, en español", "e.g. your right to dispute errors, in Spanish")} required data-testid="copy-angle" />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <fieldset>
                <legend className={LABEL}>{t("Formato", "Format")}</legend>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {AD_FORMATS.map((f) => (
                    <button key={f} type="button" className={pillTab(format === f)} aria-pressed={format === f} onClick={() => setFormat(f)}>
                      {formatLabel[f]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className={LABEL}>{t("A dónde lleva", "Where it sends people")}</legend>
                <select className={`${FIELD} mt-1 h-11`} value={goal} onChange={(e) => setGoal(e.target.value as AdGoal)}>
                  {AD_GOALS.map((g) => (
                    <option key={g} value={g}>
                      {goalLabel[g]}
                    </option>
                  ))}
                </select>
              </fieldset>
              <fieldset>
                <legend className={LABEL}>{t("Idioma", "Language")}</legend>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {AD_LANGUAGES.map((l) => (
                    <button key={l} type="button" className={pillTab(language === l)} aria-pressed={language === l} onClick={() => setLanguage(l)}>
                      {languageLabel[l]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            {examples.length > 0 && (
              <label className="block">
                <span className={LABEL}>{t("Aprender de un ganador (opcional)", "Learn from a winner (optional)")}</span>
                <select className={`${FIELD} mt-1 h-11`} value={exampleId} onChange={(e) => setExampleId(e.target.value)} data-testid="copy-example">
                  <option value="">{t("Ninguno", "None")}</option>
                  {examples.map((e) => (
                    <option key={e.adId} value={e.adId}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className={`${PRIMARY_BUTTON} gap-2`} disabled={busy || angle.trim().length < 3} data-testid="copy-write">
              <Icon name="sparkle" size={18} />
              {busy ? t("Alti está escribiendo…", "Alti is writing…") : t("Escribir con Alti", "Write with Alti")}
            </button>
            <Notice message={error} tone="error" />
          </form>
        </section>

        {result && copy && (
          <section className="card mt-5 px-5 py-4" aria-labelledby="draft-title" data-testid="copy-draft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="draft-title" className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
                {t("Borrador de Alti", "Alti's draft")}
              </h2>
              <Chip tone="bg-blue-50 text-blue-700">{aiByline(locale)}</Chip>
            </div>
            <p className="mt-1 text-[13px] leading-snug text-slate-600">{sourceNote(result)}</p>
            <div className="mt-4 space-y-4">
              {copy.hooks.map((hook, i) => (
                <Pair key={i} label={t(`Gancho ${i + 1}`, `Hook ${i + 1}`)} value={hook} langs={langs} rows={2} onChange={(v) => setCopy({ ...copy, hooks: copy.hooks.map((h, j) => (j === i ? v : h)) })} />
              ))}
              <Pair label={t("Título", "Headline")} value={copy.headline} langs={langs} rows={1} onChange={(v) => setCopy({ ...copy, headline: v })} testId="draft-headline" />
              <Pair label={t("Texto principal", "Primary text")} value={copy.primaryText} langs={langs} rows={5} onChange={(v) => setCopy({ ...copy, primaryText: v })} testId="draft-primary" />
              <Pair label={t("Descripción", "Description")} value={copy.description} langs={langs} rows={1} onChange={(v) => setCopy({ ...copy, description: v })} />
              {format === "video" && <Pair label={t("Guion (hablado)", "Script (spoken)")} value={copy.script} langs={langs} rows={5} onChange={(v) => setCopy({ ...copy, script: v })} />}
              <Pair label={t("Texto en pantalla", "On-screen text")} value={copy.onScreen} langs={langs} rows={1} onChange={(v) => setCopy({ ...copy, onScreen: v })} />
              <label className="block max-w-xs">
                <span className={LABEL}>{t("Botón", "Button")}</span>
                <select className={`${FIELD} mt-1 h-11`} value={copy.cta} onChange={(e) => setCopy({ ...copy, cta: e.target.value as AdCopyOutput["cta"] })}>
                  {AD_CTAS.map((c) => (
                    <option key={c} value={c}>
                      {(text.cta as Record<string, string>)[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5" aria-live="polite">
              <SectionTitle>{blocking.length === 0 ? t("La revisión no encontró nada que impida enviarlo", "The check found nothing that blocks it") : t(`${blocking.length} cosas impiden enviarlo`, `${blocking.length} things block it`)}</SectionTitle>
              {issues.length > 0 && (
                <ul className="space-y-2">
                  {issues.map((i) => (
                    <IssueItem key={i.id} issue={i} />
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-start gap-2 border-t border-slate-100 pt-4">
              <SendToContent copy={copy} language={language} format={format} title={angle} disabled={blocking.length > 0} />
              {brief?.ok ? (
                <Link href="/equipo/video" className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-4`} data-testid="open-video">
                  <Icon name="check" size={16} />
                  {t("Brief enviado: abrir Video Studio", "Brief sent: open Video Studio")}
                </Link>
              ) : (
                <button type="button" onClick={sendBrief} disabled={blocking.length > 0 || format !== "video"} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-4`} data-testid="send-video">
                  <Icon name="play" size={16} />
                  {t("Mandar a Video Studio", "Send to Video Studio")}
                </button>
              )}
            </div>
            {format !== "video" && <p className="mt-2 text-[12.5px] text-slate-500">{t("Video Studio recibe briefs de video; una imagen o carrusel va a Contenido.", "Video Studio takes video briefs; a picture or carousel goes to Content.")}</p>}
            {brief && !brief.ok && <p className="mt-2 text-[13px] text-red-700" role="alert">{brief.message}</p>}
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-5">
        <section className="card px-5 py-4" aria-labelledby="checklist-title" data-testid="ad-checklist">
          <h2 id="checklist-title" className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
            {t("Lista para anuncios de crédito", "Credit ad checklist")}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-slate-600">
            {t("La Categoría Especial de Meta para crédito y sus reglas de atributos personales. La app revisa las palabras; una persona revisa el resto.", "Meta's Special Ad Category for credit and its personal-attribute rule. The app checks the words; a person checks the rest.")}
          </p>
          <ul className="mt-3 space-y-2">
            {checklist.map((item) => {
              const label = text.check[item.key];
              const state = !copy && item.mode === "auto" ? null : item.ok;
              return (
                <li key={item.key} className="flex items-start gap-2.5" data-testid={`check-${item.key}`} data-ok={state === null ? "unknown" : state ? "yes" : "no"}>
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${state === null ? "bg-slate-100 text-slate-500" : state ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                    aria-hidden="true"
                  >
                    {state === null ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <Icon name={state ? "check" : "close"} size={12} strokeWidth={2.4} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium leading-snug text-slate-800">{label.label}</span>
                    <span className="block text-[12px] leading-snug text-slate-500">
                      {item.mode === "auto" ? text.check.auto : text.check.person} · {label.help}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {briefs.length > 0 && (
          <section className="card px-5 py-4" aria-labelledby="briefs-title" data-testid="ads-briefs">
            <h2 id="briefs-title" className="font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
              {t("Briefs para Video Studio", "Briefs for Video Studio")}
            </h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {briefs.slice(0, 8).map((b) => (
                <li key={b.id} className="py-2">
                  <p className="text-[13.5px] font-medium leading-snug text-slate-900 [overflow-wrap:anywhere]">{b.title}</p>
                  <p className="text-[12px] text-slate-500">
                    {shortDay(b.createdAt, locale)} · {b.by}
                  </p>
                </li>
              ))}
            </ul>
            <Link href="/equipo/video" className="mt-2 inline-flex min-h-11 items-center gap-1 text-[13.5px] font-semibold text-blue-700 hover:underline md:min-h-0">
              {t("Abrir Video Studio", "Open Video Studio")}
              <Icon name="chevron" size={14} />
            </Link>
          </section>
        )}
      </aside>
    </div>
  );
}
