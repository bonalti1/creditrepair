"use client";

import Link from "next/link";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useReviewLinks } from "@/lib/reviews/store";
import { companyDetails, LOCAL_ITEMS, localOpen } from "@/lib/seo/local";
import { useSeo } from "@/lib/seo/store";
import { SEO_TEXT } from "@/lib/seo/text";
import Icon from "@/components/Icon";
import { PassChip, SampleNote, SeoGate, SeoHeader, when } from "@/components/staff/seo/ui";
import { SectionTitle } from "@/components/staff/ui";

// Local SEO: what puts Credalti on the map in Texas. The Google Business
// Profile steps (the owner's, in his Google account), the name, address and
// phone exactly as the agreement prints them (the same NEXT_PUBLIC_COMPANY_*
// variables) to use everywhere, and the review links (the Reviews tab).
// Each item is a tick a person makes; who and when is kept.

function Local() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const seo = useSeo();
  const reviews = useReviewLinks();
  const text = SEO_TEXT[locale];
  const details = companyDetails();
  const mayTick = can(seo.role, "seo.edit");
  const googleLink = reviews.platforms.find((p) => p.key === "google" && p.url);

  if (!seo.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <SeoHeader
        title={t("SEO local", "Local SEO")}
        lead={t("Para aparecer en Google Maps y en las búsquedas de Texas: el Perfil de Empresa, los mismos datos en todas partes y las reseñas.", "To show up on Google Maps and in Texas searches: the Business Profile, the same details everywhere, and reviews.")}
        aside={<span className="text-[14px] text-slate-600">{t(`${localOpen(seo.localTicks)} pendientes`, `${localOpen(seo.localTicks)} to do`)}</span>}
      />
      <SampleNote live={seo.live} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card px-4 py-4 sm:px-5" aria-labelledby="todo">
          <SectionTitle>
            <span id="todo">{t("Lo que falta", "To-dos")}</span>
          </SectionTitle>
          <ul className="divide-y divide-slate-100" data-testid="local-items">
            {LOCAL_ITEMS.map((item) => {
              const tick = seo.localTicks[item.key];
              const info = text.local[item.key];
              return (
                <li key={item.key} className="py-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-blue-900" checked={Boolean(tick?.done)} disabled={!mayTick} onChange={(e) => void seo.tickLocal(item.key, e.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`font-semibold ${tick?.done ? "text-slate-500 line-through" : "text-blue-900"}`}>{info.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${item.who === "owner" ? "bg-amber-100 text-blue-900" : "bg-blue-50 text-blue-700"}`}>{item.who === "owner" ? t("Dueño", "Owner") : t("Equipo", "Team")}</span>
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-snug text-slate-600">{info.how}</span>
                      {tick?.done && <span className="mt-0.5 block text-[12px] text-slate-500">{t(`Hecho por ${tick.by} · ${when(tick.at, locale)}`, `Done by ${tick.by} · ${when(tick.at, locale)}`)}</span>}
                    </span>
                  </label>
                  {item.href && (
                    <p className="mt-1 pl-8">
                      {item.href.startsWith("/") ? (
                        <Link href={item.href} className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-blue-700 md:min-h-0">
                          {t("Abrir", "Open")}
                          <Icon name="chevron" size={15} />
                        </Link>
                      ) : (
                        <a href={item.href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-blue-700 md:min-h-0">
                          {item.href.replace(/^https:\/\//, "").replace(/\/$/, "")}
                          <Icon name="link" size={15} />
                        </a>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="min-w-0 space-y-5">
          <section className="card px-4 py-4" aria-labelledby="nap">
            <SectionTitle>
              <span id="nap">{t("Nombre, dirección y teléfono", "Name, address and phone")}</span>
            </SectionTitle>
            <p className="mb-3 text-[13px] text-slate-500">{t("Los mismos datos que imprime el contrato. Cópialos tal cual en cada perfil y directorio.", "The same details the agreement prints. Copy them exactly into every profile and directory.")}</p>
            <dl className="space-y-2.5" data-testid="nap">
              {details.map((d) => (
                <div key={d.key}>
                  <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{text.nap[d.key]}</dt>
                  <dd className="text-[14px] text-blue-900 [overflow-wrap:anywhere]">
                    {d.value ?? <span className="font-semibold text-red-700">{text.nap.missing(d.variable ?? "")}</span>}
                    {d.problem && <span className="block text-[13px] font-semibold text-red-700">{text.nap[d.problem]}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card px-4 py-4" aria-labelledby="reviews">
            <SectionTitle aside={<PassChip pass={Boolean(googleLink)} label={googleLink ? t("Enlace listo", "Link set") : t("Sin enlace de Google", "No Google link")} />}>
              <span id="reviews">{t("Reseñas", "Reviews")}</span>
            </SectionTitle>
            <p className="text-[14px] leading-snug text-slate-600">{t("Las reseñas reales ayudan a aparecer en el mapa. Se piden y se contestan desde Reseñas, con sus reglas: nunca se ofrece nada a cambio.", "Real reviews help the profile show on the map. They are asked for and answered from Reviews, with its rules: nothing is ever offered in exchange.")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/equipo/resenas" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-blue-700">
                {t("Abrir Reseñas", "Open Reviews")}
                <Icon name="chevron" size={15} />
              </Link>
              <a href="/opina" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-blue-700">
                {t("La página para dejar reseñas (/opina)", "The page to leave a review (/opina)")}
                <Icon name="link" size={15} />
              </a>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function LocalPage() {
  return (
    <SeoGate>
      <Local />
    </SeoGate>
  );
}
