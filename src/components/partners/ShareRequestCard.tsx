"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useClientSharing } from "@/lib/partners/clientSharing";
import { openShareRequest, SHARE_REQUEST_CARD, type L } from "@/lib/partners/portal";
import Icon from "@/components/Icon";
import { PartnerBadge } from "./ShareChoice";

// On the client's home: a partner who referred them asked to follow their
// progress (migration 0033). Two calm choices: see exactly what they would
// see (the existing choice on /mas/compartir, off by default), or "Not now".
// Nothing is shared from here. The card goes away once the client decides,
// says not now, or after 14 days.

export default function ShareRequestCard({ locale }: { locale: L }) {
  const { state, dismissRequest } = useClientSharing();
  const [now, setNow] = useState<Date | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => setNow(new Date()), []);
  if (!state || !now || hidden) return null;
  const request = openShareRequest(
    state.requests ?? [],
    state.history.map((h) => ({ partnerId: h.partnerId, at: h.at })),
    state.partners.map((p) => ({ partnerId: p.id, level: p.level })),
    now,
  );
  if (!request) return null;
  const partner = state.partners.find((p) => p.id === request.partnerId);
  const c = SHARE_REQUEST_CARD[locale];
  const name = partner?.name ?? request.partnerName;
  return (
    <section className="card p-5" aria-labelledby="share-request" data-testid="share-request-card">
      {partner && <PartnerBadge partner={partner} line={locale === "es" ? "Te recomendó" : "Referred you"} />}
      <h2 id="share-request" className={`${partner ? "mt-4" : ""} text-[19px] font-semibold leading-snug text-slate-900`}>
        {c.title(name)}
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{c.body}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link href="/mas/compartir" className="pressable flex h-12 items-center justify-center gap-2 rounded-full bg-blue-900 px-5 text-[15px] font-semibold text-white">
          <Icon name="person" size={17} />
          {c.choose}
        </Link>
        <button
          type="button"
          onClick={async () => {
            setHidden(true);
            await dismissRequest(request.id);
          }}
          className="pressable flex h-12 items-center justify-center rounded-full bg-slate-100 px-5 text-[15px] font-semibold text-slate-800 hover:bg-slate-200"
        >
          {c.later}
        </button>
      </div>
    </section>
  );
}
