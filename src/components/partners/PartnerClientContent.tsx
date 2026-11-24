"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { DEMO_PORTAL_PARTNER } from "@/lib/partners/demo";
import type { PartnerProgress } from "@/lib/partners/sharing";
import { PARTNER_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { demoPartnerClients, demoPartnerHomeReady } from "@/lib/partners/sharingDemo";
import type { PartnerHomeRow } from "@/lib/aftercare/homeReady";
import PartnerHomeReady from "./PartnerHomeReady";
import { getStaffData } from "@/lib/staff/data";
import { isDemoMode } from "@/lib/supabase/config";
import Icon from "@/components/Icon";
import LocaleToggle from "@/components/LocaleToggle";
import Logo from "@/components/Logo";
import ClientProgressView from "./ClientProgressView";

// One client's page in the partner portal: the stage, what comes next, the
// milestone dates and, at the "summary" level, the two counts. With a
// database it is GET /api/partners/clients/<id>, which the database logs as a
// view the client can see. "Escribir al equipo" sends a note to the team
// about this client; the client never sees it.

export default function PartnerClientContent({ id }: { id: string }) {
  const { locale } = useLocale();
  const s = PARTNER_SHARING_COPY[locale];
  const demo = isDemoMode();
  const [client, setClient] = useState<PartnerProgress | null | "missing">(null);
  const [homeReady, setHomeReady] = useState<PartnerHomeRow[]>([]);
  const [now] = useState(() => new Date());
  const [text, setText] = useState("");
  const [send, setSend] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (demo) {
        const clients = await getStaffData().listClients();
        const found = demoPartnerClients(DEMO_PORTAL_PARTNER, clients, new Date()).find((c) => c.clientId === id);
        const record = clients.find((c) => c.id === id);
        if (!cancelled) {
          setClient(found ?? "missing");
          setHomeReady(found && record ? demoPartnerHomeReady(DEMO_PORTAL_PARTNER, record, found) : []);
        }
        return;
      }
      const res = await fetch(`/api/partners/clients/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
      if (res?.status === 403) return window.location.assign("/socios/portal");
      const body = res?.ok ? ((await res.json()) as { client: PartnerProgress; homeReady?: PartnerHomeRow[] }) : null;
      if (!cancelled) {
        setClient(body?.client ?? "missing");
        setHomeReady(body?.homeReady ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, id]);

  const write = async (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2 || send === "sending") return;
    setSend("sending");
    if (!demo) {
      const res = await fetch("/api/partners/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", clientId: id, text }) }).catch(() => null);
      if (!res?.ok) return setSend("error");
    }
    setText("");
    setSend("sent");
  };

  return (
    <main className="min-h-dvh bg-slate-50 pb-12">
      <header className="sticky top-0 z-20 border-b hairline bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-3 px-4">
          <Link href="/socios/portal" className="inline-flex items-center gap-1 text-[15px] font-medium text-blue-700">
            <Icon name="chevron" size={16} className="rotate-180" />
            {s.back}
          </Link>
          <div className="flex items-center gap-2">
            {demo && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900">Demo</span>}
            <LocaleToggle />
            <Logo size={22} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-xl space-y-6 px-4 pt-6">
        {client === "missing" && <p className="card p-5 text-[15px] text-slate-600">{s.notFound}</p>}
        {client && client !== "missing" && (
          <>
            <ClientProgressView progress={client} locale={locale} now={now} />
            {homeReady.length > 0 && <PartnerHomeReady rows={homeReady} locale={locale} />}
            <section className="card p-5" aria-labelledby="escribir" data-testid="partner-write">
              <h2 id="escribir" className="text-[17px] font-semibold text-slate-900">{s.writeTitle}</h2>
              <p className="mt-1 text-[13.5px] leading-snug text-slate-600">{s.writeHelp}</p>
              <form onSubmit={write} className="mt-3 space-y-3">
                <textarea
                  aria-label={s.writeTitle}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={s.writePlaceholder}
                  maxLength={1500}
                  rows={3}
                  className="w-full rounded-2xl bg-white px-4 py-3 text-[16px] shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button type="submit" disabled={text.trim().length < 2 || send === "sending"} className="pressable flex h-11 w-full items-center justify-center rounded-full bg-blue-900 text-[15px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">
                  {send === "sending" ? s.sending : s.send}
                </button>
                {send === "sent" && <p className="rounded-2xl bg-green-50 px-4 py-3 text-[14px] text-green-700" role="status">{s.sent}</p>}
                {send === "error" && <p className="text-[14px] text-red-600" role="alert">{s.error}</p>}
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
