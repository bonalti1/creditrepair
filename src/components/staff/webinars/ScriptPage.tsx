"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { can, deniedReason } from "@/lib/staff/permissions";
import { useViewer } from "@/lib/staff/useStaff";
import { useWebinarsData } from "@/lib/webinars/data";
import { webinarWhen } from "@/lib/webinars/time";
import type { WebinarDetail } from "@/lib/webinars/views";
import { BACK_LINK, NoAccess } from "@/components/staff/ui";
import ScriptView from "./ScriptView";

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null;

export default function ScriptPage({ prices }: { prices: { complete: string; diy: string } }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const { id } = useParams<{ id: string }>();
  const { viewer, ready } = useViewer();
  const data = useWebinarsData(viewer);
  const [detail, setDetail] = useState<WebinarDetail | null | undefined>(undefined);
  const [lang, setLang] = useState<"en" | "es">("es");

  useEffect(() => {
    if (!ready || !viewer) return;
    void data.detail(id).then((d) => {
      setDetail(d);
      if (d) setLang(d.webinar.language === "en" ? "en" : d.webinar.language === "es" ? "es" : locale);
    });
  }, [ready, viewer, data, id, locale]);

  if (!ready) return null;
  if (!can(viewer?.role, "webinars.view")) return <NoAccess title={t("Guion", "Script")} reason={deniedReason("webinars.view", locale)} />;
  if (detail === undefined) return <div className="h-40" aria-busy="true" />;
  if (detail === null) return <p className="card px-5 py-4 text-[14px] text-slate-600">{t("No encontramos este webinar.", "We couldn't find this webinar.")}</p>;
  const w = detail.webinar;
  return (
    <main className="animate-rise min-w-0" data-testid="script-page">
      <Link href={`/equipo/webinars/${w.id}`} className={BACK_LINK}>
        ‹ {(locale === "es" ? w.title.es : w.title.en) || w.title.en}
      </Link>
      <h1 className="page-title mt-2">{t("Guion y orden del show", "Script & run of show")}</h1>
      <p className="mt-1 text-[14px] text-slate-600">{webinarWhen(w.startsAt, locale)} · {w.host}</p>
      <div className="mt-4">
        <ScriptView vars={{ keyword: w.keyword, signupLink: detail.links.signup, pageLink: detail.links.page, whatsapp: WHATSAPP, prices }} lang={lang} setLang={setLang} title={lang === "es" ? w.title.es : w.title.en} />
      </div>
    </main>
  );
}
