"use client";

import { useEffect, useRef, useState } from "react";
import { clientLetterSummary } from "@/lib/intake/letterSummary";
import type { BureauLetterSummary, IntakeStatus } from "@/lib/intake/types";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";

// "Llegó una carta de un buró": an OPTIONAL extra on the rounds page. The
// results of each round come from the client's next report; nothing waits for
// a letter, nothing asks for one, and there is no reminder or count here. If a
// letter does arrive and the client wants to, they photograph it and see, in
// plain words, what the letter says. Facts about the letter only: no score,
// no promise.

interface Letter {
  status: IntakeStatus;
  letter: BureauLetterSummary | null;
  simulated: boolean;
}

export default function BureauLetterUpload() {
  const { locale } = useLocale();
  const es = locale === "es";
  const supabase = getBrowserSupabase();
  const input = useRef<HTMLInputElement>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [letters, setLetters] = useState<Letter[]>([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setSignedIn(true);
      const response = await fetch("/api/intake/letter").catch(() => null);
      const body = response?.ok ? ((await response.json()) as { letters?: Letter[] }) : null;
      setLetters(body?.letters ?? []);
    });
  }, [supabase]);

  // With a database only the signed-in client uploads; the demo shows a simulated letter.
  if (supabase && !signedIn) return null;

  const upload = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/intake/letter", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as Partial<Letter> & { error?: string };
      if (!response.ok || !body.status) {
        setProblem(body.error ?? (es ? "No se pudo subir la carta. Intenta de nuevo." : "Could not upload the letter. Please try again."));
        return;
      }
      setLetters((l) => [{ status: body.status!, letter: body.letter ?? null, simulated: body.simulated === true }, ...l]);
    } catch {
      setProblem(es ? "No se pudo subir la carta. Revisa tu conexión." : "Could not upload the letter. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-1" data-testid="bureau-letter">
      <h2 className="text-[15px] font-semibold text-slate-700">{es ? "¿Llegó una carta de un buró?" : "Did a letter from a bureau arrive?"}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-slate-500">
        {es
          ? "Si te llega una carta de un buró, puedes subirla aquí. No es necesario: revisamos tu reporte de nuevo de todas formas."
          : "If a letter from a bureau reaches you, you can upload it here. It is not necessary: we review your report again either way."}
      </p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="pressable mt-2 inline-flex h-10 items-center gap-2 rounded-full bg-slate-100 px-4 text-[14px] font-medium text-slate-800 hover:bg-slate-200 disabled:text-slate-400"
      >
        <Icon name="mail" size={16} />
        {busy ? (es ? "Leyendo la carta…" : "Reading the letter…") : es ? "Subir foto de la carta" : "Upload a photo of the letter"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,application/pdf,.heic,.heif"
        className="hidden"
        aria-label={es ? "Elegir la foto de la carta" : "Choose the photo of the letter"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {problem && (
        <p className="mt-2 text-[13px] leading-relaxed text-red-700" role="alert">
          {problem}
        </p>
      )}
      {letters.map((l, i) => {
        const summary = clientLetterSummary(l.letter, l.status, locale);
        return (
          <div key={i} className="card mt-3 px-4 py-3.5" data-testid="bureau-letter-summary">
            <p className="text-[15px] font-semibold text-slate-900">
              {summary.title}
              {l.simulated && <span className="font-normal text-slate-500">{es ? " · ejemplo simulado" : " · simulated example"}</span>}
            </p>
            {summary.lines.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {summary.lines.map((line) => (
                  <li key={line} className="flex gap-2 text-[14px] leading-snug text-slate-800">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{summary.note}</p>
          </div>
        );
      })}
    </section>
  );
}
