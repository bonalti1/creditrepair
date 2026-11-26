"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CharacterAvatar } from "@/components/Character";
import { useLocale } from "@/lib/i18n";
import { firstTimeFor } from "@/lib/service/optionLocal";
import { useServiceOption } from "@/lib/service/useServiceOption";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Alti's offer to a Credalti DIY client: "Want our team to handle it from
// here?" (the owner's decision, 2026-11-25). No pressure: shown at most once
// per moment (a new round due; letters prepared 14 days ago and not marked as
// mailed), dismissed with one tap, never to a client who turned off reminders
// or opted out of automatic messages, and never to a Complete client. Saying
// yes only opens the comparison; nothing changes until they sign.

export default function UpgradeOffer({ moment }: { moment: string }) {
  const { locale, d } = useLocale();
  const { option, hydrated } = useServiceOption();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!hydrated || option !== "diy") return;
    let cancelled = false;
    const decide = async () => {
      if (isSupabaseConfigured()) {
        const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
        if (res?.ok) {
          const body = (await res.json()) as { settings?: { reminders?: boolean }; optedOutAt?: string | null };
          if (body.optedOutAt || body.settings?.reminders === false) return;
        }
      }
      if (!cancelled && firstTimeFor(moment)) setShow(true);
    };
    void decide();
    return () => {
      cancelled = true;
    };
  }, [hydrated, option, moment]);

  if (!show) return null;
  return (
    <section data-testid="upgrade-offer" aria-live="polite" className="card flex items-start gap-3.5 px-5 py-4">
      <CharacterAvatar character="assistant" size={44} className="shrink-0" />
      <div className="min-w-0 flex-1">
        {/* Alti is AI, always labelled as such. */}
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{locale === "es" ? "Alti · Asistente con IA" : "Alti · AI assistant"}</p>
        <h2 className="mt-0.5 text-[17px] font-semibold leading-snug text-slate-900">{d.diy.upgradeTitle}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{d.diy.upgradeBody}</p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <Link href="/mas/opcion" className="pressable flex h-11 items-center rounded-full bg-amber-400 px-5 text-[15px] font-semibold text-blue-900 hover:bg-amber-500">
            {d.diy.upgradeYes}
          </Link>
          <button type="button" onClick={() => setShow(false)} className="pressable h-11 rounded-full bg-slate-100 px-5 text-[15px] font-medium text-slate-900 hover:bg-slate-200">
            {d.diy.upgradeNo}
          </button>
        </div>
      </div>
    </section>
  );
}
