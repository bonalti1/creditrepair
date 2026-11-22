"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";
import { reuploadRequest } from "@/lib/intake/reupload";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// "Sube tu documento de nuevo": the screen the automatic message links to
// when the automatic check could not accept the client's ID or proof of
// address for a reason they can fix. It says the reason in plain words ("La
// foto está borrosa.", "Tiene más de 90 días…") and offers one button to
// upload another (POST /api/intake/document, the same check as always).
// A second failure, or a reason another photo does not fix, goes to a person.
// In the demo the check is simulated and nothing is stored.

type Kind = "government_id" | "proof_of_address";

interface Check {
  kind: Kind;
  status: "accepted" | "needs_person" | "read" | "failed";
  reasons: string[];
  simulated: boolean;
}

const NAME: Record<Kind, { es: string; en: string }> = {
  government_id: { es: "Tu identificación", en: "Your photo ID" },
  proof_of_address: { es: "Tu comprobante de domicilio", en: "Your proof of address" },
};

const TIPS: Record<Kind, { es: string[]; en: string[] }> = {
  government_id: {
    es: ["Pon la identificación sobre una mesa oscura, con buena luz y sin reflejos.", "Que se vean las cuatro esquinas.", "Que no esté vencida."],
    en: ["Lay the ID on a dark table, in good light, without glare.", "Make sure all four corners show.", "It must not be expired."],
  },
  proof_of_address: {
    es: ["Un recibo o estado de cuenta de los últimos 90 días.", "Con tu nombre y la misma dirección que tienes en la app.", "La página completa, con la fecha visible."],
    en: ["A bill or statement from the last 90 days.", "With your name and the same address you have in the app.", "The whole page, with the date visible."],
  },
};

/** DEMO: an invented check, so the screen can be seen. */
const DEMO_CHECKS: Check[] = [
  {
    kind: "proof_of_address",
    status: "needs_person",
    simulated: true,
    reasons: ["Es un recibo de servicios.", "La foto está borrosa.", "Tiene más de 90 días (es del 3 de agosto). Se necesita uno más reciente."],
  },
];

const COPY = {
  es: {
    title: "Sube tu documento de nuevo",
    lead: "Revisamos tu documento y no lo pudimos usar. Va junto con cada carta, así que hace falta otro.",
    why: "Por qué",
    tips: "Para que pase",
    upload: "Subir otra foto",
    checking: "Revisando…",
    accepted: "Listo: la revisión automática lo aceptó. No tienes que hacer nada más.",
    again: "Tampoco lo pudimos aceptar. Una persona del equipo lo revisa y te escribe.",
    none: "No hay nada que subir de nuevo. Tus documentos están al día.",
    demo: "Demo: la revisión es simulada y no se guarda nada.",
    back: "Más",
    privacy: "No guardamos los números de tu identificación.",
    error: "No se pudo subir. Intenta de nuevo.",
  },
  en: {
    title: "Upload your document again",
    lead: "We checked your document and could not use it. It goes with each letter, so another one is needed.",
    why: "Why",
    tips: "So it goes through",
    upload: "Upload another photo",
    checking: "Checking…",
    accepted: "Done: the automatic check accepted it. There is nothing else to do.",
    again: "We could not accept this one either. A person on our team will review it and write to you.",
    none: "There is nothing to upload again. Your documents are up to date.",
    demo: "Demo: the check is simulated and nothing is stored.",
    back: "More",
    privacy: "We do not store your ID numbers.",
    error: "Could not upload. Please try again.",
  },
} as const;

export default function DocumentosPage() {
  const { locale } = useLocale();
  const l = locale === "en" ? "en" : "es";
  const c = COPY[l];
  const live = isSupabaseConfigured();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [result, setResult] = useState<Partial<Record<Kind, "accepted" | "again">>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setChecks(DEMO_CHECKS);
      return;
    }
    fetch("/api/intake/document")
      .then(async (res) => (res.ok ? (((await res.json()) as { checks?: Check[] }).checks ?? []) : []))
      .then(setChecks)
      .catch(() => setChecks([]));
  }, [live]);

  if (!checks) return null;
  const toFix = checks.filter((check) => check.status === "needs_person");

  const upload = async (kind: Kind, file: File) => {
    setBusy(kind);
    setError(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const res = await fetch("/api/intake/document", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok || !body.status) throw new Error(body.error ?? "upload");
      setResult((r) => ({ ...r, [kind]: body.status === "accepted" ? "accepted" : "again" }));
    } catch {
      setError(c.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="animate-rise space-y-5" data-testid="documentos">
      <Link href="/mas" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {c.back}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{c.lead}</p>
      </header>
      {!live && (
        <p role="note" className="rounded-2xl bg-amber-100 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {c.demo}
        </p>
      )}

      {toFix.length === 0 && <section className="card px-5 py-5 text-[16px] leading-relaxed text-slate-700">{c.none}</section>}

      {toFix.map((check) => {
        const request = reuploadRequest(check);
        const reasons = request?.reasons ?? check.reasons.filter((r) => !/^Es /.test(r));
        const done = result[check.kind];
        return (
          <section key={check.kind} className="card px-5 py-5" data-testid={`reupload-${check.kind}`}>
            <h2 className="text-[19px] font-semibold text-slate-900">{NAME[check.kind][l]}</h2>
            {done ? (
              <p className={`mt-3 flex items-start gap-2.5 text-[16px] leading-relaxed ${done === "accepted" ? "text-green-700" : "text-blue-900"}`} role="status">
                <Icon name={done === "accepted" ? "check" : "doc"} size={20} className="mt-0.5 shrink-0" />
                <span>{done === "accepted" ? c.accepted : c.again}</span>
              </p>
            ) : (
              <>
                <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.why}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {reasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[15px] leading-snug text-blue-900">
                      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      {reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.tips}</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-snug text-slate-700">
                  {TIPS[check.kind][l].map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
                <label className="pressable mt-5 flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500" data-testid="reupload-button">
                  <Icon name="doc" size={18} />
                  {busy === check.kind ? c.checking : c.upload}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf,.heic,.heif"
                    capture="environment"
                    className="hidden"
                    disabled={busy !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void upload(check.kind, f);
                    }}
                  />
                </label>
              </>
            )}
          </section>
        );
      })}
      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
          {error}
        </p>
      )}
      <p className="px-1 text-[13px] leading-relaxed text-slate-500">{c.privacy}</p>
    </main>
  );
}
