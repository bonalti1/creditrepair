"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { attributeLead, attributionIndex } from "@/lib/ads/attribution";
import type { AdRow } from "@/lib/ads/report";
import { ADS_TEXT } from "@/lib/ads/text";
import type { AdLead, AdsSnapshot } from "@/lib/ads/types";
import { shortDay } from "@/lib/staff/format";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Chip, PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { AdThumb, DeliveryChip, money, SourceTag, useCtaLabel, useNum, useReason, useResultLabel, VerdictChip } from "./bits";

// One ad, everything about it (ALTO's drawer): its creative (the picture, or
// the video played from Meta on a tap), its words, every number (Meta's and
// Credalti's, each labelled), the verdict with its reason and what to do,
// and the leads it brought, with how each was credited.

type VideoState = null | "loading" | { src: string | null; poster: string | null; reason: string | null };

export default function AdDrawer({
  row,
  snapshot,
  leads,
  sample,
  accountId,
  onClose,
  onDraft,
  loadVideo,
}: {
  row: AdRow;
  snapshot: AdsSnapshot;
  leads: AdLead[];
  sample: boolean;
  accountId: string | null;
  onClose: () => void;
  onDraft: ((row: AdRow) => void) | null;
  loadVideo: (adId: string) => Promise<{ src: string | null; poster: string | null; reason: string | null }>;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(ADS_TEXT);
  const num = useNum();
  const reason = useReason();
  const resultLabel = useResultLabel();
  const ctaLabel = useCtaLabel();
  const panel = useRef<HTMLDivElement>(null);
  const [video, setVideo] = useState<VideoState>(null);
  const [mounted, setMounted] = useState(false);
  const { ad, metrics: m, verdict } = row;
  const index = attributionIndex(snapshot);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const play = async () => {
    setVideo("loading");
    setVideo(await loadVideo(ad.id));
  };
  const videoProblem = (why: string | null) =>
    why === "sample"
      ? t("Anuncio de muestra: en la demo no hay video que reproducir.", "Sample ad: there is no video to play in the demo.")
      : why === "not_configured"
        ? t("Meta no está conectada en el servidor.", "Meta is not connected on the server.")
        : why === "no_permission"
          ? t("Meta no dio permiso para ver este video (el token necesita ads_read y acceso a la página).", "Meta did not allow this video (the token needs ads_read and access to the Page).")
          : why === "not_a_video"
            ? t("Este anuncio es una imagen, no un video.", "This ad is a picture, not a video.")
            : t("Meta no devolvió el video ahora. Ábrelo en el Administrador de anuncios.", "Meta did not return the video right now. Open it in Ads Manager.");

  const managerUrl = accountId ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId.replace(/^act_/, "")}&selected_ad_ids=${ad.id}` : null;
  const suggestion = verdict.verdict === "turn_off" && !row.stillSpending ? text.suggestion.turnOffDone : text.suggestion[verdict.verdict];
  const picture = ad.creative.imageUrl ?? ad.creative.thumbnailUrl;

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-display text-[18px] font-semibold leading-tight text-blue-900 tabular-nums">{value}</dd>
    </div>
  );

  if (!mounted) return null;
  return createPortal(
    <div className="console console-fade fixed inset-0 z-50 bg-blue-900/30 print:hidden" onClick={onClose} role="presentation">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-drawer-title"
        onClick={(e) => e.stopPropagation()}
        className="console-drawer absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[20px] bg-slate-50 outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[34rem] md:rounded-none"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="ad-drawer"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300 md:hidden" />
        <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 pb-3 pt-3 md:px-5 md:pt-5">
          <AdThumb ad={ad} size={44} />
          <div className="min-w-0 flex-1">
            <p id="ad-drawer-title" className="text-[16px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">
              {ad.name}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500 [overflow-wrap:anywhere]">{[row.campaign?.name, row.adset?.name].filter(Boolean).join(" › ")}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <VerdictChip verdict={verdict.verdict} />
              <DeliveryChip status={ad.status} />
              {sample && <Chip tone="bg-amber-100 text-blue-900">{t("Muestra", "Sample")}</Chip>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100" aria-label={t("Cerrar", "Close")} data-testid="ad-drawer-close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
          {/* The creative. */}
          <section aria-label={t("El anuncio", "The ad")} className="card overflow-hidden">
            <div className="relative bg-blue-900">
              {video && video !== "loading" && video.src ? (
                <video src={video.src} poster={video.poster ?? undefined} controls playsInline className="max-h-[22rem] w-full bg-black" data-testid="ad-video" />
              ) : picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picture} alt={t(`Imagen del anuncio ${ad.name}`, `Picture of the ad ${ad.name}`)} referrerPolicy="no-referrer" className="max-h-[22rem] w-full object-contain" />
              ) : (
                <div className="flex h-40 items-center justify-center text-amber-300" data-on-navy>
                  <Icon name="megaphone" size={40} />
                </div>
              )}
              {ad.creative.videoId && !(video && video !== "loading" && video.src) && (
                <button
                  type="button"
                  onClick={play}
                  className="pressable absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-400 text-blue-900 shadow-lg"
                  aria-label={t(`Reproducir ${ad.name}`, `Play ${ad.name}`)}
                  data-testid="ad-play"
                >
                  {video === "loading" ? <span className="text-[13px] font-semibold">…</span> : <Icon name="play" size={24} strokeWidth={2} />}
                </button>
              )}
            </div>
            {video && video !== "loading" && !video.src && <p className="bg-amber-50 px-4 py-2 text-[13px] leading-snug text-blue-900" role="status">{videoProblem(video.reason)}</p>}
            <div className="px-4 py-3">
              {ad.creative.title && <p className="text-[15px] font-semibold text-slate-900">{ad.creative.title}</p>}
              {ad.creative.body && <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-slate-700">{ad.creative.body}</p>}
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
                <span>
                  {t("Botón:", "Button:")} <span className="font-semibold text-slate-700">{ctaLabel(ad.creative.callToAction)}</span>
                </span>
                {ad.creative.link && <span className="[overflow-wrap:anywhere]">{ad.creative.link}</span>}
              </p>
            </div>
          </section>

          {/* What to do. */}
          <section className={`mt-4 rounded-[14px] border px-4 py-3 ${verdict.verdict === "turn_off" && row.stillSpending ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`} aria-labelledby="ad-verdict-title" data-testid="ad-suggestion">
            <h3 id="ad-verdict-title" className="console-label text-slate-600">
              {t("Qué hacer", "What to do")}
            </h3>
            <p className="mt-1 text-[15px] font-semibold leading-snug text-blue-900">{suggestion}</p>
            <p className="mt-1 text-[13.5px] leading-snug text-slate-700">
              {reason(verdict)} <span className="text-slate-500">({text.basis[verdict.basis]})</span>
            </p>
            {row.needsYou && <p className="mt-1 text-[13px] font-semibold text-red-700">{t("Sigue encendido y gastando.", "It is still on and spending.")}</p>}
          </section>

          {/* Every number. */}
          <section className="card mt-4 px-4 py-3" aria-labelledby="ad-numbers-title">
            <h3 id="ad-numbers-title" className="flex items-center gap-2">
              <SourceTag source="meta" />
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Stat label={t("Gasto", "Spend")} value={money(m.spendCents)} />
              <Stat label={t("Impresiones", "Impressions")} value={num(m.impressions)} />
              <Stat label={t("Clics al enlace", "Link clicks")} value={num(m.clicks)} />
              <Stat label="CTR" value={m.ctr === null ? "—" : `${m.ctr}%`} />
              <Stat label={resultLabel(row.resultKind)} value={num(m.results)} />
              <Stat label={t("Costo por resultado", "Cost per result")} value={money(m.costPerResultCents)} />
            </dl>
            <h3 className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
              <SourceTag source="credalti" />
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Stat label={t("Prospectos", "Leads")} value={num(m.leads)} />
              <Stat label={t("Costo por prospecto", "Cost per lead")} value={money(m.costPerLeadCents)} />
              <Stat label={t("Clientes firmados", "Signed clients")} value={num(m.signed)} />
              <Stat label={t("Costo por firmado", "Cost per signed")} value={money(m.costPerSignedCents)} />
              <Stat label={t("Días con gasto", "Days with spend")} value={num(m.daysWithSpend)} />
              <Stat label={t("Último gasto", "Last spent")} value={row.lastSpendDay ? shortDay(`${row.lastSpendDay}T12:00:00Z`, locale) : "—"} />
            </dl>
          </section>

          {/* Its leads. */}
          <section className="card mt-4 px-4 py-3" aria-labelledby="ad-leads-title" data-testid="ad-leads">
            <h3 id="ad-leads-title" className="console-label text-slate-600">
              {t(`Sus prospectos en estas fechas (${leads.length})`, `Its leads in these dates (${leads.length})`)}
            </h3>
            {leads.length === 0 ? (
              <p className="mt-2 text-[13.5px] leading-snug text-slate-600">
                {t(
                  "Ningún prospecto llegó con la etiqueta de este anuncio. Si Meta cuenta resultados y aquí no hay, revisa los parámetros del enlace (docs/ADS.md).",
                  "No lead arrived tagged with this ad. If Meta counts results and none show here, check the link's URL parameters (docs/ADS.md).",
                )}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {leads.slice(0, 25).map((lead) => {
                  const how = attributeLead(lead, index).how;
                  return (
                    <li key={lead.id} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-slate-900">{lead.name ?? t("Sin nombre todavía", "No name yet")}</span>
                        <span className="block text-[12px] text-slate-500">{how ? text.how[how] : "—"}</span>
                      </span>
                      <span className="shrink-0 text-right text-[12.5px] text-slate-600">
                        <span className="block tabular-nums">{shortDay(lead.createdAt, locale)}</span>
                        {lead.signedAt && <Chip tone="bg-green-50 text-green-800">{t("Firmó", "Signed")}</Chip>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {leads.length > 25 && <p className="mt-1 text-[12.5px] text-slate-500">{t(`Y ${leads.length - 25} más.`, `And ${leads.length - 25} more.`)}</p>}
          </section>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-3 md:px-5">
          {onDraft && (
            <button type="button" onClick={() => onDraft(row)} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-4`} data-testid="ad-draft-variation">
              <Icon name="sparkle" size={16} />
              {t("Variación con Alti", "Variation with Alti")}
            </button>
          )}
          {managerUrl && !sample && (
            <a href={managerUrl} target="_blank" rel="noreferrer noopener" className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`}>
              {t("Abrir en Meta", "Open in Meta")}
              <Icon name="link" size={15} />
            </a>
          )}
          {ad.previewUrl && !sample && (
            <a href={ad.previewUrl} target="_blank" rel="noreferrer noopener" className={`${SECONDARY_BUTTON_COMPACT} px-4`}>
              {t("Vista previa", "Preview")}
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
