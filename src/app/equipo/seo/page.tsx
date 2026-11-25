"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { groupFindings, healthToFix } from "@/lib/seo/health";
import { localOpen } from "@/lib/seo/local";
import { useSeo } from "@/lib/seo/store";
import { SEO_TEXT } from "@/lib/seo/text";
import Icon from "@/components/Icon";
import { EmptyState, PRIMARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { Notice, PassChip, SampleNote, SeoGate, SeoHeader, when } from "@/components/staff/seo/ui";

// SEO, the department's first screen: site health. The app reads its own
// public pages (the route list, the published guides, robots.txt and the
// sitemap) the way a search engine does and lists each check: pass, or what
// to fix, why it matters and how. No score. Works with no keys, in the demo
// too (the server really reads the pages). docs/SEO.md.

function Health() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const router = useRouter();
  const seo = useSeo();
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const text = SEO_TEXT[locale];

  // Ask Alti's «Draft a guide» lands here with ?vista=guias.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("vista") === "guias") router.replace("/equipo/seo/guias");
  }, [router]);

  const groups = useMemo(() => (seo.health ? groupFindings(seo.health) : []), [seo.health]);
  const toFix = healthToFix(seo.health);
  const waiting = seo.guides.filter((g) => g.status === "review").length;
  const live = seo.guides.filter((g) => g.published && g.status !== "archived").length;

  const run = async () => {
    setRunning(true);
    setNotice(null);
    const res = await seo.runHealth();
    setRunning(false);
    setNotice(res.ok ? { text: t("Revisión terminada.", "Check finished."), tone: "info" } : { text: res.message[locale], tone: "error" });
  };

  if (!seo.ready) return <div className="h-40" aria-busy="true" />;

  return (
    <main className="animate-rise">
      <SeoHeader
        title={t("Salud del sitio", "Site health")}
        lead={t(
          "El sistema lee las páginas públicas como lo hace un buscador y revisa lo que importa para que te encuentren. Sin puntaje: cada punto pasa o dice qué arreglar.",
          "The system reads the public pages the way a search engine does and checks what matters for being found. No score: each check passes or says what to fix.",
        )}
        aside={
          <button type="button" onClick={run} disabled={running} className={`${PRIMARY_BUTTON_COMPACT} gap-1.5 px-5`} data-testid="run-health">
            <Icon name="search" size={18} />
            {running ? t("Revisando…", "Checking…") : t("Revisar ahora", "Check now")}
          </button>
        }
      />
      <SampleNote live={seo.live}>{t("La revisión del sitio es real: el servidor lee sus propias páginas. Las guías y frases son de muestra.", "The site check is real: the server reads its own pages. The guides and phrases are sample data.")}</SampleNote>

      <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("Resumen", "Summary")}>
        <li className="card px-4 py-3.5">
          <p className="console-label">{t("Por arreglar", "To fix")}</p>
          <p className="mt-1 font-display text-[26px] font-semibold tabular-nums text-blue-900">{seo.health ? toFix : "—"}</p>
          <p className="text-[13px] text-slate-500">{seo.health ? t("revisiones con algo pendiente", "checks with something to do") : t("Sin revisar todavía", "Not checked yet")}</p>
        </li>
        <li className="card px-4 py-3.5">
          <Link href="/equipo/seo/guias" className="block">
            <p className="console-label">{t("Guías", "Guides")}</p>
            <p className="mt-1 font-display text-[26px] font-semibold tabular-nums text-blue-900">{live}</p>
            <p className="text-[13px] text-slate-500">{t(`publicadas · ${waiting} en espera`, `live · ${waiting} waiting for approval`)}</p>
          </Link>
        </li>
        <li className="card px-4 py-3.5">
          <Link href="/equipo/seo/busqueda" className="block">
            <p className="console-label">Search Console</p>
            <p className="mt-1.5">
              <PassChip pass={seo.connection.connected} label={seo.connection.connected ? t("Conectado", "Connected") : t("Sin conectar", "Not connected")} />
            </p>
            <p className="mt-1 text-[13px] text-slate-500">{seo.connection.connected ? when(seo.syncedAt, locale) || t("Esperando la primera sincronización", "Waiting for the first sync") : t("Lo conecta el dueño", "The owner connects it")}</p>
          </Link>
        </li>
        <li className="card px-4 py-3.5">
          <Link href="/equipo/seo/local" className="block">
            <p className="console-label">{t("SEO local", "Local SEO")}</p>
            <p className="mt-1 font-display text-[26px] font-semibold tabular-nums text-blue-900">{localOpen(seo.localTicks)}</p>
            <p className="text-[13px] text-slate-500">{t("pendientes del dueño y el equipo", "to-dos for the owner and team")}</p>
          </Link>
        </li>
      </ul>

      <div className="mt-4">
        <Notice text={notice?.text ?? null} tone={notice?.tone} />
      </div>

      {!seo.health ? (
        <div className="card mt-5">
          <EmptyState pose="thinking" title={t("Todavía no se ha revisado el sitio", "The site has not been checked yet")}>
            {t("Toca «Revisar ahora». Tarda alrededor de un minuto: se leen todas las páginas en los dos idiomas.", "Tap «Check now». It takes about a minute: every page is read in both languages.")}
          </EmptyState>
        </div>
      ) : (
        <section className="mt-6" aria-labelledby="checks">
          <SectionTitle
            aside={
              <span className="text-[13px] text-slate-500">
                {t(`Revisado ${when(seo.health.checkedAt, locale)} · ${seo.health.pages} páginas · ${seo.health.origin}`, `Checked ${when(seo.health.checkedAt, locale)} · ${seo.health.pages} pages · ${seo.health.origin}`)}
              </span>
            }
          >
            <span id="checks">{t("La lista", "The checklist")}</span>
          </SectionTitle>
          {seo.health.errors.length > 0 && (
            <div className="card mb-3 border-l-4 border-red-500 px-4 py-3.5">
              <p className="font-semibold text-blue-900">{t("Páginas que no se pudieron leer", "Pages that could not be read")}</p>
              <ul className="mt-1 space-y-0.5 text-[14px] text-slate-600">
                {seo.health.errors.map((e) => (
                  <li key={e.where} className="[overflow-wrap:anywhere]">
                    {e.where}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-3" data-testid="health-checks">
            {groups.map((g) => {
              const info = text.health[g.check];
              const fix = g.fix.length > 0;
              return (
                <li key={g.check} className={`card px-4 py-4 sm:px-5 ${fix ? "border-l-4 border-red-500" : ""}`} data-check={g.check} data-state={fix ? "fix" : "pass"}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-display text-[16px] font-semibold text-blue-900">{info.title}</h3>
                    <PassChip pass={!fix} label={fix ? t(`Arreglar · ${g.fix.length}`, `Fix · ${g.fix.length}`) : t(`Bien · ${g.pass}`, `Pass · ${g.pass}`)} />
                  </div>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-600">
                    <span className="font-semibold text-slate-700">{t("Por qué importa:", "Why it matters:")}</span> {info.why}
                  </p>
                  {fix && (
                    <>
                      <p className="mt-1 text-[14px] leading-relaxed text-slate-600">
                        <span className="font-semibold text-slate-700">{t("Cómo arreglarlo:", "How to fix it:")}</span> {info.how}
                      </p>
                      <ul className="mt-2 space-y-1 rounded-xl bg-red-50/60 px-3 py-2 text-[13.5px] text-slate-700">
                        {g.fix.slice(0, 12).map((f, i) => (
                          <li key={i} className="[overflow-wrap:anywhere]">
                            <span className="font-semibold text-blue-900">{f.where}</span> · {f.detail[locale]}
                          </li>
                        ))}
                        {g.fix.length > 12 && <li className="text-slate-500">{t(`y ${g.fix.length - 12} más`, `and ${g.fix.length - 12} more`)}</li>}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!can(seo.role, "seo.publish") && (
        <p className="mt-6 text-[13px] text-slate-500">{t("Solo un administrador publica guías y conecta Search Console.", "Only an administrator publishes guides and connects Search Console.")}</p>
      )}
    </main>
  );
}

export default function SeoPage() {
  return (
    <SeoGate>
      <Health />
    </SeoGate>
  );
}
