"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { openQuestions } from "@/lib/staff/conversation";
import { EXCEPTION_KINDS } from "@/lib/staff/stage";
import { HOUSE_RULES, SCREENS_TOUR, TOUR_STEPS, playbookFor } from "@/lib/staff/playbook";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { TOUR_DONE_KEY } from "@/components/staff/NewHireChecklist";
import { PlaybookCard } from "@/components/staff/PlaybookCard";
import { TOUR_CLIENT_KEY, tourHref } from "@/components/staff/TourBar";
import { PRIMARY_BUTTON, SectionTitle } from "@/components/staff/ui";

// Welcome: for someone on their first day. What each screen does, a 5-minute
// tour of an example client (in the demo, an invented one; with a database,
// one of yours with a question waiting), the rules, and every «Cómo se
// resuelve» card in one place.

export default function Bienvenida() {
  const { ready, clients, viewer, data } = useStaff();
  const router = useRouter();
  const [tourDone, setTourDone] = useState(false);

  useEffect(() => {
    if (!viewer) return;
    const key = `${TOUR_DONE_KEY}:${viewer.handle}`;
    try {
      if (new URLSearchParams(window.location.search).get("recorrido_hecho") === "1") window.localStorage.setItem(key, new Date().toISOString());
      setTourDone(Boolean(window.localStorage.getItem(key)));
    } catch {
      // This visit only.
    }
  }, [viewer]);

  if (!ready || !viewer) return null;

  const startTour = () => {
    // The demo follows its invented client; with a database, one of yours, a question waiting if there is one.
    const example = data.demo ? null : (clients.find((c) => openQuestions(c).length > 0) ?? clients.find((c) => c.signedUpAt) ?? clients[0]);
    try {
      if (example) window.sessionStorage.setItem(TOUR_CLIENT_KEY, example.id);
      else window.sessionStorage.removeItem(TOUR_CLIENT_KEY);
    } catch {
      // The demo's client.
    }
    router.push(tourHref(1));
  };

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Bienvenida, {viewer.name.split(" ")[0]}</h1>
      <p className="mt-1 max-w-3xl text-[15px] leading-relaxed text-slate-500">
        Aquí trabajas los casos de los clientes desde una sola lista. El sistema hace lo de rutina (recordatorios, avisos, preparar cartas) y te deja solo lo que
        necesita una persona, con los pasos para resolverlo.
      </p>

      <section className="mt-7 scroll-mt-28" id="recorrido" aria-labelledby="recorrido-title">
        <SectionTitle aside={tourDone ? <span className="text-[13px] font-medium text-green-700">Hecho</span> : undefined}>
          <span id="recorrido-title">Recorrido de 5 minutos</span>
        </SectionTitle>
        <div className="card px-5 py-5">
          <ol className="space-y-2.5">
            {TOUR_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-900 text-[13px] font-semibold text-white tabular-nums">{i + 1}</span>
                <span className="min-w-0 text-[14.5px] leading-snug text-slate-700">
                  <span className="font-semibold text-slate-900">{step.title}.</span> {step.text}
                </span>
              </li>
            ))}
          </ol>
          <button type="button" onClick={startTour} className={`${PRIMARY_BUTTON} mt-5 w-full gap-2 sm:w-auto`} data-testid="start-tour">
            {tourDone ? "Hacerlo otra vez" : "Empezar el recorrido"}
            <Icon name="chevron" size={18} />
          </button>
          <p className="mt-2 text-[12.5px] leading-snug text-slate-500">
            {data.demo ? "Sigue a una clienta inventada con una pregunta esperando." : "Sigue a uno de tus clientes; no se envía nada durante el recorrido."}
          </p>
        </div>
      </section>

      <section className="mt-7 scroll-mt-28" id="reglas" aria-labelledby="reglas-title">
        <SectionTitle>
          <span id="reglas-title">Las reglas</span>
        </SectionTitle>
        <ul className="card divide-y divide-slate-900/[0.06] overflow-hidden" data-testid="house-rules">
          {HOUSE_RULES.map((rule, i) => (
            <li key={rule} className="flex gap-3 px-5 py-3 text-[15px] leading-snug text-slate-800">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[12px] font-semibold text-blue-900 tabular-nums">{i + 1}</span>
              <span className="min-w-0">{rule}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-7 scroll-mt-28" id="pantallas" aria-labelledby="pantallas-title">
        <SectionTitle>
          <span id="pantallas-title">Qué hace cada pantalla</span>
        </SectionTitle>
        <ul className="card overflow-hidden">
          {SCREENS_TOUR.map((screen, i) => (
            <li key={screen.href} className={i > 0 ? "border-t hairline" : ""}>
              <Link href={screen.href} className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-slate-900">{screen.name}</span>
                  <span className="block text-[13.5px] leading-snug text-slate-600">{screen.what}</span>
                </span>
                <Icon name="chevron" size={16} className="shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 px-1 text-[13px] text-slate-500">En cualquier pantalla, «¿Qué hago aquí?» arriba a la derecha explica esa pantalla.</p>
      </section>

      <section className="mt-7" aria-labelledby="tarjetas-title">
        <SectionTitle>
          <span id="tarjetas-title">Cómo se resuelve cada aviso</span>
        </SectionTitle>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
          {EXCEPTION_KINDS.map((kind) => (
            <details key={kind} className="group card overflow-hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-5 text-[15px] font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                {playbookFor(kind).title}
                <Icon name="chevron" size={16} className="shrink-0 rotate-90 text-slate-400 group-open:-rotate-90" />
              </summary>
              <div className="px-2 pb-2">
                <PlaybookCard kind={kind} title={false} />
              </div>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
