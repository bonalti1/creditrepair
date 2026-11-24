"use client";

import { useState } from "react";
import { CaseStatus, CaseTimelineList } from "@/components/case/CaseViews";
import GraduationCard from "@/components/aftercare/Graduation";
import { useAftercare } from "@/lib/aftercare/useAftercare";
import { clearDemoCase, loadExampleCase } from "@/lib/case/demo";
import { useCase } from "@/lib/case/useCase";
import Icon from "@/components/Icon";
import { useLocale } from "@/lib/i18n";
import { forgetClientCase } from "@/lib/ux/caseApi";

// "Mi caso": everything that has happened in the client's case and what comes
// next, newest first, in plain words. Facts only: what is on record, with its
// date. No scores and no promises: the bureaus decide how they answer.
// The words and the rules are in src/lib/case/timeline.ts; where the facts come
// from (the demo's device, or the client's own rows) is src/lib/case/useCase.ts.

export default function CasoPage() {
  const { locale } = useLocale();
  const es = locale === "es";
  const view = useCase(locale);
  // After-care: graduation lives here (src/lib/aftercare/graduation.ts).
  const aftercare = useAftercare();
  const [busy, setBusy] = useState(false);

  if (!view.ready || !aftercare.state) return null;
  const graduated = aftercare.state.graduation !== null;

  const reload = (change: () => void) => {
    setBusy(true);
    change();
    forgetClientCase();
    window.location.reload();
  };

  return (
    <main className="animate-rise space-y-5" data-testid="mi-caso">
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{es ? "Mi caso" : "My case"}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
          {es
            ? "Todo lo que ha pasado y lo que sigue, con sus fechas. Lo más nuevo va arriba."
            : "Everything that has happened and what comes next, with dates. The newest is on top."}
        </p>
      </header>

      {/* Once the client finished the program, the graduation says where things stand. */}
      {!graduated && <CaseStatus view={view} showLink={false} />}

      <GraduationCard caseView={view} locale={locale} aftercare={aftercare} where="top" />

      <CaseTimelineList timeline={view.timeline} />

      <GraduationCard caseView={view} locale={locale} aftercare={aftercare} where="bottom" />

      <section className="flex items-start gap-3 px-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
          <Icon name="info" size={20} />
        </span>
        <p className="min-w-0 text-[14px] leading-relaxed text-slate-600">
          {es
            ? "Aquí solo ponemos lo que está registrado. Los burós deciden cómo responden, y los resultados varían. ¿Tienes una pregunta? Escríbele a tu equipo desde Más."
            : "We only show what is on record. The bureaus decide how they answer, and results vary. Have a question? Write to your team from More."}
        </p>
      </section>

      {/* Demo only: an example case, written into this device's stores so every screen tells the same story. */}
      {!view.live && (
        <section className="card px-5 py-5" data-testid="case-demo">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Demo</p>
          <p className="mt-1 text-[15px] leading-relaxed text-slate-700">
            {view.example
              ? es
                ? "Estás viendo un caso de ejemplo, con datos inventados. Puedes volver a empezar."
                : "You are looking at an example case, with made-up data. You can start over."
              : es
                ? "En la demo nadie envía cartas. Carga un caso de ejemplo para ver cómo se ve un caso con cartas enviadas."
                : "In the demo nobody mails letters. Load an example case to see a case with letters mailed."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => reload(view.example ? clearDemoCase : () => loadExampleCase())}
            className="pressable mt-3 flex h-12 w-full items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-semibold text-slate-900 hover:bg-slate-200"
            data-testid={view.example ? "case-demo-clear" : "case-demo-load"}
          >
            {view.example ? (es ? "Volver a empezar" : "Start over") : es ? "Ver un caso de ejemplo" : "See an example case"}
          </button>
        </section>
      )}
    </main>
  );
}
