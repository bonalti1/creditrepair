"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { contentGaps, phraseStats, targetOptions, TEXAS_CITIES, type Gap } from "@/lib/seo/keywords";
import { defaultRange } from "@/lib/seo/search";
import { useSeo } from "@/lib/seo/store";
import type { Lang, SearchTotals } from "@/lib/seo/types";
import Icon from "@/components/Icon";
import { DeniedNote, EmptyState, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, LABEL, Notice, SampleNote, SeoGate, SeoHeader } from "@/components/staff/seo/ui";

// Keywords and ideas: the phrases the site wants to be found for (English or
// Spanish, statewide or a Texas city), each tied to the page that answers it
// and, with Search Console connected, its average position; and «content
// gaps», each of which becomes a guide's brief in one tap. Texas only.

function Keywords() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const router = useRouter();
  const seo = useSeo();
  const [byQuery, setByQuery] = useState<SearchTotals[] | null>(null);
  const [sample, setSample] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  const [city, setCity] = useState("");
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const mayEdit = can(seo.role, "seo.edit");
  const { search } = seo;

  useEffect(() => {
    if (!seo.ready) return;
    void search(defaultRange(new Date(), 28)).then((v) => {
      setByQuery(v && (v.sample || v.connection.connected) ? v.byQuery : null);
      setSample(Boolean(v?.sample));
    });
  }, [seo.ready, search]);

  const targets = useMemo(() => targetOptions(seo.guides), [seo.guides]);
  const gaps = useMemo(() => contentGaps({ phrases: seo.phrases, guides: seo.guides, byQuery }), [seo.phrases, seo.guides, byQuery]);

  const add = async () => {
    const res = await seo.addPhrase({ phrase, lang, city: city || null, targetPath: target || null });
    if (res.ok) {
      setPhrase("");
      setCity("");
      setTarget("");
      setNotice({ text: t("Frase agregada.", "Phrase added."), tone: "info" });
    } else setNotice({ text: res.message[locale], tone: "error" });
  };

  const toBrief = async (gap: Gap) => {
    const res = await seo.act({ action: "create", topic: gap.brief.topic, brief: gap.brief.brief, phrase: gap.brief.phrase });
    if (res.ok && res.guide) router.push(`/equipo/seo/guias/${res.guide.id}?alti=1`);
    else if (!res.ok) setNotice({ text: res.message[locale], tone: "error" });
  };

  if (!seo.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <SeoHeader
        title={t("Palabras e ideas", "Keywords & ideas")}
        lead={t("Las frases por las que queremos que nos encuentren, cada una con la página que la responde, y las ideas para guías nuevas. Solo Texas.", "The phrases we want to be found for, each with the page that answers it, and ideas for new guides. Texas only.")}
      />
      <SampleNote live={seo.live} />

      <section className="card mt-5 px-4 py-4 sm:px-5" aria-labelledby="tracked">
        <SectionTitle aside={<span className="text-[13px] text-slate-500">{byQuery ? (sample ? t("Posición: muestra, últimos 28 días", "Position: sample, last 28 days") : t("Posición: Search Console, últimos 28 días", "Position: Search Console, last 28 days")) : t("Posición: conecta Search Console", "Position: connect Search Console")}</span>}>
          <span id="tracked">{t("Frases seguidas", "Tracked phrases")}</span>
        </SectionTitle>
        {seo.phrases.length === 0 ? (
          <EmptyState pose="thinking" title={t("Todavía no sigues ninguna frase", "No phrases tracked yet")} />
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="phrases">
            {seo.phrases.map((p) => {
              const stats = byQuery ? phraseStats(p, byQuery) : null;
              const targetLabel = targets.find((x) => x.path === p.targetPath)?.label ?? p.targetPath;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-blue-900 [overflow-wrap:anywhere]">{p.phrase}</p>
                    <p className="text-[13px] text-slate-500">
                      {p.lang === "en" ? t("Inglés", "English") : t("Español", "Spanish")}
                      {p.city ? ` · ${p.city}, TX` : ` · ${t("Todo Texas", "Statewide")}`}
                      {" · "}
                      {p.targetPath ? (
                        <Link href={p.targetPath.startsWith("/guias/") ? `/equipo/seo/guias/${seo.guides.find((g) => `/guias/${g.slug}` === p.targetPath)?.id ?? ""}` : p.targetPath} className="font-semibold text-blue-700 underline [overflow-wrap:anywhere]">
                          {targetLabel}
                        </Link>
                      ) : (
                        <span className="font-semibold text-red-700">{t("Sin página", "No page")}</span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-[13px] tabular-nums text-slate-600">
                    {stats?.position ? t(`posición ${stats.position.toFixed(1)} · ${stats.clicks} clics`, `position ${stats.position.toFixed(1)} · ${stats.clicks} clicks`) : byQuery ? t("sin datos aún", "no data yet") : "—"}
                  </span>
                  {mayEdit && (
                    <button type="button" className={QUIET_BUTTON} onClick={() => void seo.removePhrase(p.id)} aria-label={t(`Dejar de seguir «${p.phrase}»`, `Stop tracking “${p.phrase}”`)}>
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {mayEdit ? (
          <form
            className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[minmax(0,2fr)_120px_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            aria-label={t("Seguir una frase", "Track a phrase")}
          >
            <div className="min-w-0">
              <label className={LABEL} htmlFor="kw">{t("Frase", "Phrase")}</label>
              <input id="kw" className={`${FIELD} mt-1 h-12`} value={phrase} maxLength={100} onChange={(e) => setPhrase(e.target.value)} placeholder="credit repair dallas" />
            </div>
            <div>
              <label className={LABEL} htmlFor="kw-lang">{t("Idioma", "Language")}</label>
              <select id="kw-lang" className={`${FIELD} mt-1 h-12`} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option value="en">{t("Inglés", "English")}</option>
                <option value="es">{t("Español", "Spanish")}</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="kw-city">{t("Ciudad de Texas", "Texas city")}</label>
              <select id="kw-city" className={`${FIELD} mt-1 h-12`} value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">{t("Todo Texas", "Statewide")}</option>
                {TEXAS_CITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="kw-target">{t("Página que la responde", "Page that answers it")}</label>
              <select id="kw-target" className={`${FIELD} mt-1 h-12`} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t("Ninguna todavía", "None yet")}</option>
                {targets.map((o) => (
                  <option key={o.path} value={o.path}>{o.label}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={phrase.trim().length < 3} className={PRIMARY_BUTTON}>
              {t("Seguir", "Track")}
            </button>
          </form>
        ) : (
          <div className="mt-3">
            <DeniedNote>{t("Solo el equipo de contenido agrega frases.", "Only the content team adds phrases.")}</DeniedNote>
          </div>
        )}
        <div className="mt-3">
          <Notice text={notice?.text ?? null} tone={notice?.tone} />
        </div>
        <p className="mt-2 text-[12.5px] text-slate-500">{t("Solo ciudades de Texas: Credalti no atiende otros estados, y nunca Georgia. No hagas páginas de ciudad para lugares que no se atienden.", "Texas cities only: Credalti does not serve other states, and never Georgia. Never make city pages for places that are not served.")}</p>
      </section>

      <section className="card mt-5 px-4 py-4 sm:px-5" aria-labelledby="gaps">
        <SectionTitle>
          <span id="gaps">{t("Huecos de contenido", "Content gaps")}</span>
        </SectionTitle>
        <p className="mb-2 text-[13px] text-slate-500">{t("Lo que ninguna página responde bien todavía. Cada idea se vuelve el encargo de una guía nueva, y Alti puede escribir el borrador.", "What no page answers well yet. Each idea becomes a new guide's brief, and Alti can write the draft.")}</p>
        {gaps.length === 0 ? (
          <EmptyState pose="thumbsUp" title={t("Sin huecos por ahora", "No gaps for now")} />
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="gaps">
            {gaps.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <p className="min-w-0 flex-1 text-[14px] text-slate-700">{g.text[locale]}</p>
                {mayEdit && (
                  <button type="button" className={`${SECONDARY_BUTTON_COMPACT} gap-1.5`} onClick={() => void toBrief(g)}>
                    <Icon name="sparkle" size={16} />
                    {t("Hacer el encargo", "Make it a brief")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default function KeywordsPage() {
  return (
    <SeoGate>
      <Keywords />
    </SeoGate>
  );
}
