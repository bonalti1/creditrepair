"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can, type Viewer } from "@/lib/staff/permissions";
import { useWebinarsData } from "@/lib/webinars/data";
import { WEBINARS_TEXT } from "@/lib/webinars/text";
import { webinarWhen } from "@/lib/webinars/time";
import { nextWebinar, type WebinarSummary } from "@/lib/webinars/views";
import Icon from "@/components/Icon";
import { GOLD_ROW_BUTTON, ROW_BUTTON } from "@/components/staff/ui";
import { PhaseChip } from "./bits";

// The Overview's compact «Next webinar» card (docs/CONTROL.md): the next
// class (or the one live now), its date on Texas time, how many registered,
// and the way to the live console. Nothing when there is no upcoming one.

export default function NextWebinarCard({ viewer }: { viewer: Viewer | null }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(WEBINARS_TEXT);
  const data = useWebinarsData(viewer);
  const [next, setNext] = useState<WebinarSummary | null>(null);
  const allowed = can(viewer?.role, "webinars.view");

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    void data.list().then((l) => alive && setNext(l ? nextWebinar(l.webinars) : null));
    return () => {
      alive = false;
    };
  }, [data, allowed]);

  if (!allowed || !next) return null;
  const w = next.webinar;
  return (
    <section className="card mt-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4" aria-labelledby="next-webinar" data-testid="next-webinar-card">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-900" aria-hidden="true">
          <Icon name="video" size={20} />
        </span>
        <div className="min-w-0">
          <h2 id="next-webinar" className="font-display text-[12.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {next.phase === "live" ? t("Webinar en vivo", "Webinar live now") : t("Próximo webinar", "Next webinar")}
          </h2>
          <p className="mt-0.5 font-semibold text-blue-900 [overflow-wrap:anywhere]">{(locale === "es" ? w.title.es : w.title.en) || w.title.en}</p>
          <p className="text-[13.5px] text-slate-600">
            {webinarWhen(w.startsAt, locale)} · <span className="tabular-nums">{t(`${next.registered} registrados`, `${next.registered} registered`)}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PhaseChip phase={next.phase} label={text.phase[next.phase]} />
        <Link href={`/equipo/webinars/${w.id}/en-vivo`} className={next.phase === "live" ? GOLD_ROW_BUTTON : ROW_BUTTON} data-testid="next-webinar-console">
          {t("Consola en vivo", "Live console")}
        </Link>
      </div>
    </section>
  );
}
