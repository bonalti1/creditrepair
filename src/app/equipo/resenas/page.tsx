"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { STATUS_TEMPLATES, renderTemplate } from "@/lib/autopilot/templates";
import { fallbackReply } from "@/lib/reviews/reply";
import {
  MILESTONE_LABEL,
  overallRating,
  PLATFORM_LONG_NAME,
  PLATFORM_NAME,
  REVIEW_COPY,
  REVIEW_MILESTONES,
  REVIEW_PAGE_PATH,
  reviewRequestSummary,
  type ReviewPlatform,
  type ReviewPlatformKey,
} from "@/lib/reviews/reviews";
import { useReviewsAdmin } from "@/lib/reviews/store";
import { deniedReason } from "@/lib/staff/permissions";
import { shortDateTime } from "@/lib/staff/format";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { useStaff } from "@/lib/staff/useStaff";
import { DeniedNote, SectionTitle } from "@/components/staff/ui";

// Reviews: where clients are asked to leave one, when, how many were asked,
// what each platform shows (typed in by a person), and Alti's draft of a
// reply to a review someone pasted. Read by the team; changed by an
// administrator. The rules this page cannot break are written on it.

const URL_PROBLEM: Record<string, [string, string]> = {
  not_a_url: ["No es una dirección web.", "That is not a web address."],
  not_https: ["Tiene que empezar con https://.", "It has to start with https://."],
  wrong_host: ["No es una dirección de ese sitio.", "That is not an address on that site."],
  invalid: ["No se pudo guardar.", "It could not be saved."],
};

function Switch({ on, label, disabled, onChange, testId }: { on: boolean; label: string; disabled: boolean; onChange: (next: boolean) => void; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-green-600" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function PlatformRow({ platform, disabled, save }: { platform: ReviewPlatform; disabled: boolean; save: (body: Record<string, unknown>) => Promise<string | null> }) {
  const t = useTx();
  const { locale } = useStaff();
  const [url, setUrl] = useState(platform.url ?? "");
  const [rating, setRating] = useState(platform.rating?.toString() ?? "");
  const [count, setCount] = useState(platform.reviewCount?.toString() ?? "");
  const [note, setNote] = useState<string | null>(null);
  const name = PLATFORM_LONG_NAME[platform.key][locale];
  const run = async (body: Record<string, unknown>) => setNote(await save({ action: "platform", key: platform.key, ...body }));
  return (
    <div className="px-5 py-4" data-testid={`platform-${platform.key}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[15px] font-semibold text-slate-900">{name}</p>
        <Switch on={platform.enabled} label={t(`Mostrar ${name}`, `Show ${name}`)} disabled={disabled || !platform.url} onChange={(enabled) => void run({ enabled })} />
      </div>
      <label className="mt-2 block text-[13px] text-slate-500">
        {t("Enlace donde el cliente escribe la reseña", "Link where the client writes the review")}
        <div className="mt-1 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={disabled}
            placeholder="https://"
            className="h-10 min-w-0 flex-1 rounded-xl bg-slate-100 px-3 text-[14px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-70"
          />
          <button type="button" disabled={disabled || url === (platform.url ?? "")} onClick={() => void run({ url: url.trim() || null })} className="pressable h-10 rounded-full bg-blue-700 px-4 text-[14px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">
            {t("Guardar", "Save")}
          </button>
        </div>
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[13px] text-slate-500">
          {t("Calificación que muestra", "Rating it shows")}
          <input value={rating} onChange={(e) => setRating(e.target.value)} disabled={disabled} inputMode="decimal" placeholder="4.8" className="mt-1 block h-10 w-24 rounded-xl bg-slate-100 px-3 text-[14px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
        </label>
        <label className="text-[13px] text-slate-500">
          {t("Reseñas", "Reviews")}
          <input value={count} onChange={(e) => setCount(e.target.value)} disabled={disabled} inputMode="numeric" placeholder="120" className="mt-1 block h-10 w-24 rounded-xl bg-slate-100 px-3 text-[14px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-300" />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void run({ rating: rating.trim() ? Number(rating) : null, reviewCount: count.trim() ? Number(count) : null })}
          className="pressable h-10 rounded-full bg-slate-100 px-4 text-[14px] font-semibold text-blue-700 disabled:opacity-60"
        >
          {t("Anotar", "Record")}
        </button>
      </div>
      <p className="mt-1.5 text-[12px] text-slate-500">
        {platform.ratingUpdatedAt
          ? t(`Anotada a mano el ${shortDateTime(platform.ratingUpdatedAt, locale)} por ${platform.ratingUpdatedBy ?? "equipo"}, de la página del sitio.`, `Typed in on ${shortDateTime(platform.ratingUpdatedAt, locale)} by ${platform.ratingUpdatedBy ?? "the team"}, from the site's own page.`)
          : t("Sin calificación anotada.", "No rating recorded.")}
      </p>
      {note && (
        <p className="mt-1 text-[13px] font-medium text-red-700" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

export default function ResenasPage() {
  const { ready, can, locale } = useStaff();
  const t = useTx();
  const { ready: loaded, view, post, live } = useReviewsAdmin();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState("");
  const [stars, setStars] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [replyPlatform, setReplyPlatform] = useState<ReviewPlatformKey>("google");
  const [replyLocale, setReplyLocale] = useState<"es" | "en">(locale);
  const [draft, setDraft] = useState<{ text: string; source: string; reason: string | null } | null>(null);

  if (!ready || !loaded) return null;
  const admin = can("reviews.manage");
  const disabled = !admin || busy;
  const summary = reviewRequestSummary(view.requests, new Date());
  const overall = overallRating(view.platforms);

  const save = async (body: Record<string, unknown>): Promise<string | null> => {
    setBusy(true);
    const result = await post(body);
    setBusy(false);
    if (result.ok) return null;
    const words = URL_PROBLEM[result.code] ?? URL_PROBLEM.invalid!;
    return locale === "es" ? words[0] : words[1];
  };

  const askDraft = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/staff/reviews/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review, stars, reviewerName: reviewer || null, platform: replyPlatform, locale: replyLocale }),
      });
      const body = (await res.json()) as { draft?: string; source?: string; reason?: string | null };
      setDraft(body.draft ? { text: body.draft, source: body.source ?? "fallback", reason: body.reason ?? null } : null);
    } catch {
      setDraft({ text: fallbackReply({ stars, name: reviewer, locale: replyLocale }), source: "fallback", reason: "network" });
    }
    setBusy(false);
  };

  const sample = (l: "es" | "en") => renderTemplate(STATUS_TEMPLATES.review_request, l, [l === "es" ? "Rosa" : "Rosa", `https://app.credalti.com${REVIEW_PAGE_PATH}?lang=${l}`]);

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Reseñas", "Reviews")}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        {t(
          "A cada cliente se le pide una reseña una sola vez, en un momento al que llegan todos, le vaya como le vaya. Las mismas ligas para todos, en el mismo orden. Nunca damos nada a cambio y nunca pedimos solo a los contentos.",
          "Every client is asked for a review once, at a moment everyone reaches, however it is going for them. The same links for everyone, in the same order. We never give anything in exchange and never ask only happy clients.",
        )}
      </p>
      {!admin && (
        <div className="mt-3">
          <DeniedNote>{deniedReason("reviews.manage", locale)}</DeniedNote>
        </div>
      )}
      {!live && (
        <p className="mt-3 max-w-3xl rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {t("Demo: ligas de ejemplo en direcciones inventadas y pedidos de ejemplo. Nada sale de verdad.", "Demo: example links on made-up addresses and example requests. Nothing really goes out.")}
        </p>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("Números", "Numbers")} data-testid="review-numbers">
        <div className="card px-5 py-4">
          <p className="text-[13px] font-medium text-slate-500">{t("Calificación (todos los sitios)", "Rating (all sites)")}</p>
          <p className="mt-1 text-[32px] font-semibold tabular-nums text-slate-900" data-testid="overall-rating">
            {overall.rating === null ? "—" : overall.rating.toFixed(1)}
            <span className="text-[16px] font-medium text-slate-400"> / 5</span>
          </p>
          <p className="text-[12px] leading-snug text-slate-500">
            {t(`Promedio por número de reseñas, ${overall.reviews} en ${overall.platforms} sitios. Anotado a mano.`, `Weighted by review count, ${overall.reviews} across ${overall.platforms} sites. Typed in by hand.`)}
          </p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[13px] font-medium text-slate-500">{t("Pedidos de reseña", "Review requests")}</p>
          <p className="mt-1 text-[32px] font-semibold tabular-nums text-slate-900">{summary.total}</p>
          <p className="text-[12px] text-slate-500">{t(`${summary.last30Days} en los últimos 30 días`, `${summary.last30Days} in the last 30 days`)}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[13px] font-medium text-slate-500">{t("Por WhatsApp o correo", "By WhatsApp or email")}</p>
          <p className="mt-1 text-[32px] font-semibold tabular-nums text-slate-900">{summary.byChannel.whatsapp_or_email}</p>
          <p className="text-[12px] text-slate-500">{t("Con baja, horario, tope diario y sin repetir", "With opt-out, quiet hours, daily cap, never twice")}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-[13px] font-medium text-slate-500">{t("En la app (después de «¿Cómo vamos?»)", "In the app (after “How are we doing?”)")}</p>
          <p className="mt-1 text-[32px] font-semibold tabular-nums text-slate-900">{summary.byChannel.in_app}</p>
          <p className="text-[12px] text-slate-500">{t("Con cualquier carita", "After any face")}</p>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="sitios">
          <SectionTitle>
            <span id="sitios">{t("Sitios de reseñas", "Review sites")}</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            {view.platforms.map((p) => (
              <PlatformRow key={`${p.key}-${p.url}-${p.rating}`} platform={p} disabled={disabled} save={save} />
            ))}
          </div>
          <p className="mt-2 px-1 text-[12px] leading-snug text-slate-500">
            {t(
              "No leemos las calificaciones de Google, Trustpilot ni BBB: se anotan a mano desde la página de cada sitio. Leerlas por API (Google Business Profile, Trustpilot Business Units) queda preparado como conexión opcional, sin construir (docs/REVIEWS.md).",
              "We don't read Google, Trustpilot or BBB ratings: they're typed in from each site's own page. Reading them by API (Google Business Profile, Trustpilot Business Units) is prepared as an optional hook, not built (docs/REVIEWS.md).",
            )}
          </p>
        </section>

        <section aria-labelledby="cuando">
          <SectionTitle>
            <span id="cuando">{t("Cuándo se pide", "When we ask")}</span>
          </SectionTitle>
          <div className="card divide-y divide-slate-900/[0.06]">
            <div className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-[15px] font-semibold text-slate-900">{t("Pedir reseñas por WhatsApp o correo", "Ask for reviews by WhatsApp or email")}</p>
                <p className="mt-0.5 text-[14px] leading-snug text-slate-600">
                  {t("Una vez por cliente, en su idioma, con las reglas del piloto automático. Nunca por SMS.", "Once per client, in their language, under the autopilot's rules. Never by SMS.")}
                </p>
              </div>
              <Switch on={view.settings.requestsEnabled} label={t("Pedir reseñas", "Ask for reviews")} disabled={disabled} onChange={(v) => void save({ action: "settings", requestsEnabled: v })} testId="switch-review-requests" />
            </div>
            {REVIEW_MILESTONES.map((m) => (
              <div key={m} className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-[15px] font-semibold text-slate-900">
                    {MILESTONE_LABEL[locale][m].title} <span className="text-[13px] font-medium tabular-nums text-slate-500">· {summary.byMilestone[m]}</span>
                  </p>
                  <p className="mt-0.5 text-[14px] leading-snug text-slate-600">{MILESTONE_LABEL[locale][m].detail}</p>
                </div>
                <Switch on={view.settings.milestones[m]} label={MILESTONE_LABEL[locale][m].title} disabled={disabled} onChange={(v) => void save({ action: "settings", milestones: { [m]: v } })} />
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-2xl bg-blue-50 px-4 py-3 text-[13px] leading-snug text-blue-900" data-testid="review-rules">
            <p className="font-semibold">{t("Reglas (FTC, 16 C.F.R. parte 465, y las de cada sitio)", "Rules (FTC, 16 C.F.R. Part 465, and each site's)")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>{t("Nada a cambio de una reseña: ni descuento, ni crédito, ni regalo, ni sorteo.", "Nothing in exchange for a review: no discount, credit, gift or raffle.")}</li>
              <li>{t("Se pide a todos, le vaya como le vaya. Apagar un momento solo mueve el pedido al siguiente; no hay forma de excluir a un cliente.", "Everyone is asked, however it is going. Turning a moment off only moves the ask to the next one; there is no way to exclude a client.")}</li>
              <li>{t("Nunca pedimos quitar o cambiar una reseña, ni ocultamos las negativas.", "We never ask to remove or change a review, and never hide negative ones.")}</li>
              <li>{REVIEW_COPY[locale].staffNote}</li>
            </ul>
          </div>
        </section>
      </div>

      <section className="mt-6" aria-labelledby="mensaje">
        <SectionTitle>
          <span id="mensaje">{t("El mensaje que se envía", "The message that goes out")}</span>
        </SectionTitle>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {(["en", "es"] as const).map((l) => (
            <div key={l} className="card px-5 py-4" data-testid={`review-message-${l}`}>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                {l === "en" ? "English" : "Español"} · WhatsApp · {STATUS_TEMPLATES.review_request.name}
              </p>
              <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-slate-800">{sample(l)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 max-w-3xl" aria-labelledby="responder">
        <SectionTitle>
          <span id="responder">{t("Responder a una reseña", "Reply to a review")}</span>
        </SectionTitle>
        <div className="card px-5 py-4">
          <p className="text-[14px] leading-snug text-slate-600">
            {t(
              `Pega la reseña y ${BRAND.assistant} (IA) escribe un borrador: sin datos del caso (ni siquiera que es cliente), sin promesas, sin pedir que la cambie. Tú la lees, la corriges y la publicas en el sitio.`,
              `Paste the review and ${BRAND.assistant} (AI) writes a draft: no case details (not even that they're a client), no promises, never asking them to change it. You read it, edit it and post it on the site.`,
            )}
          </p>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            rows={4}
            maxLength={4000}
            aria-label={t("Texto de la reseña", "Review text")}
            placeholder={t("Texto de la reseña…", "Review text…")}
            className="mt-3 w-full rounded-2xl bg-slate-100 px-4 py-3 text-[15px] text-slate-900 outline-none focus:ring-2 focus:ring-blue-300"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label={t("Sitio", "Site")} value={replyPlatform} onChange={(e) => setReplyPlatform(e.target.value as ReviewPlatformKey)} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px]">
              {(["google", "trustpilot", "bbb"] as const).map((k) => (
                <option key={k} value={k}>
                  {PLATFORM_NAME[k]}
                </option>
              ))}
            </select>
            <select aria-label={t("Estrellas", "Stars")} value={stars ?? ""} onChange={(e) => setStars(e.target.value ? Number(e.target.value) : null)} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px]">
              <option value="">{t("Estrellas", "Stars")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select aria-label={t("Idioma", "Language")} value={replyLocale} onChange={(e) => setReplyLocale(e.target.value as "es" | "en")} className="h-10 rounded-xl bg-slate-100 px-3 text-[14px]">
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
            <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder={t("Nombre público (opcional)", "Public name (optional)")} className="h-10 min-w-0 flex-1 rounded-xl bg-slate-100 px-3 text-[14px]" />
            <button type="button" disabled={busy || review.trim().length < 3} onClick={() => void askDraft()} className="pressable h-10 rounded-full bg-amber-400 px-5 text-[14px] font-semibold text-blue-900 disabled:bg-slate-200 disabled:text-slate-500">
              {t("Escribir borrador", "Write a draft")}
            </button>
          </div>
          {draft && (
            <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3" data-testid="review-reply-draft">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                {draft.source === "model" ? t(`Borrador de ${BRAND.assistant} (IA) · revisado`, `${BRAND.assistant}'s draft (AI) · checked`) : t(`Respuesta segura (sin ${BRAND.assistant})`, `Safe reply (without ${BRAND.assistant})`)}
              </p>
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-slate-900">{draft.text}</p>
              <p className="mt-2 text-[12px] text-slate-500">{t("Nada se publica desde aquí. Cópiala y publícala tú en el sitio.", "Nothing is posted from here. Copy it and post it yourself on the site.")}</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
