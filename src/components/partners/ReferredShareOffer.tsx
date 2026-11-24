"use client";

import { useEffect, useState } from "react";
import { EMPTY_CASE_FACTS } from "@/lib/case/timeline";
import { progressFromCaseFacts, SHARING_CONSENT_VERSION } from "@/lib/partners/sharing";
import { CLIENT_SHARING_COPY } from "@/lib/partners/sharingCopy";
import { demoPartnerByCode, writeDemoClientSharing } from "@/lib/partners/sharingDemo";
import { isDemoMode } from "@/lib/supabase/config";
import ShareChoice, { PartnerBadge, type SharePartnerFace } from "./ShareChoice";

// The chat signup (/registro) with a partner's code in the link: once the
// person is signed in, before their documents, the same choice as the
// onboarding's: whether the partner who referred them may follow their
// progress. Off by default ("Don't share" is selected), with the exact
// consent text, the preview and the record of migration 0023 (POST
// /api/sharing, the hash of the words on screen). "I'll decide later" moves
// on with nothing shared. Asked once on this device.

const PARTNER_KEY = "bonalti.partner";
const DONE_KEY = "bonalti.partnerShareOffered";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function markDone() {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Asked again next time: harmless.
  }
}

export default function ReferredShareOffer({ locale, name, goal, children }: { locale: "es" | "en"; name: string; goal: string | null; children: React.ReactNode }) {
  const [partner, setPartner] = useState<(SharePartnerFace & { id: string | null; code: string }) | null | "none">(null);

  useEffect(() => {
    const code = read(PARTNER_KEY);
    if (!code || read(DONE_KEY)) return setPartner("none");
    if (isDemoMode()) {
      const p = demoPartnerByCode(code);
      return setPartner(p ? { id: p.id, name: p.name, company: p.company, logo: null, code } : "none");
    }
    fetch(`/api/partners/public?code=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ partner?: SharePartnerFace }>) : null))
      .then((body) => setPartner(body?.partner ? { ...body.partner, id: null, code } : "none"))
      .catch(() => setPartner("none"));
  }, []);

  if (partner === null) return null;
  if (partner === "none") return <>{children}</>;
  const c = CLIENT_SHARING_COPY[locale];
  const done = () => {
    markDone();
    setPartner("none");
  };

  return (
    <div className="space-y-4 rounded-3xl bg-white p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" data-testid="registro-share">
      <PartnerBadge partner={partner} line={locale === "es" ? "Te recomendó" : "Referred by"} />
      <div>
        <p className="text-[18px] font-semibold leading-snug text-slate-900">{c.shareTitle(partner.name)}</p>
        <p className="mt-1 text-[14.5px] leading-relaxed text-slate-600">{c.shareLead(partner.name)}</p>
      </div>
      <ShareChoice
        partner={partner}
        current="none"
        locale={locale}
        now={new Date()}
        saveLabel={c.continue}
        preview={(level) => progressFromCaseFacts(EMPTY_CASE_FACTS, { name: name || (locale === "es" ? "Tu nombre" : "Your name"), goal, level })}
        onSave={async (level, textHash) => {
          if (level === "none") {
            done();
            return { ok: true };
          }
          if (isDemoMode()) {
            if (partner.id) writeDemoClientSharing(partner.id, level);
            done();
            return { ok: true };
          }
          // Signed in by now: recorded like any choice on the sharing screen.
          const res = await fetch("/api/sharing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "set", code: partner.code, level, locale, version: SHARING_CONSENT_VERSION, textHash }),
          }).catch(() => null);
          if (!res?.ok) return { ok: false, message: c.error };
          done();
          return { ok: true };
        }}
      />
      <button type="button" onClick={done} className="pressable flex h-12 w-full items-center justify-center text-[15px] font-medium text-blue-700">
        {c.later}
      </button>
      <p className="text-center text-[13px] text-slate-500">{c.laterNote}</p>
    </div>
  );
}
