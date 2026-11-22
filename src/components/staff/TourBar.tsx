"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TOUR_STEPS, TOUR_STEP_TEXT } from "@/lib/staff/playbook";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";

// The 5-minute tour's guide: with ?recorrido=N on any staff page, a bar under
// the header says what to look at here and links to the next step. The tour
// starts on the welcome page (/equipo/bienvenida). In the demo it follows an
// invented client; with a database, the welcome page picks one of yours and
// remembers it for the tour (TOUR_CLIENT_KEY).

export const TOUR_CLIENT_KEY = "bonalti.staff.tourClient";
const DEMO_TOUR_CLIENT = "/equipo/clientes/c04";

/** A step's address, with the tour's client and the step number in it. */
export function tourHref(step: number): string {
  const target = TOUR_STEPS[step - 1];
  if (!target) return "/equipo/bienvenida";
  let href = target.href;
  try {
    const client = window.sessionStorage.getItem(TOUR_CLIENT_KEY);
    if (client) href = href.replace(DEMO_TOUR_CLIENT, `/equipo/clientes/${client}`);
  } catch {
    // The demo's client.
  }
  const [path, hash] = href.split("#");
  return `${path}?recorrido=${step}${hash ? `#${hash}` : ""}`;
}

export default function TourBar() {
  const params = useSearchParams();
  const { locale } = useStaffLocale();
  const t = useTx();
  const step = Number(params.get("recorrido"));
  const current = Number.isInteger(step) ? TOUR_STEP_TEXT[locale][step - 1] : undefined;
  if (!current) return null;
  const last = step >= TOUR_STEPS.length;
  return (
    <div className="border-t border-blue-800 bg-blue-900 text-white" data-testid="tour-bar">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <p className="min-w-0 flex-1 text-[14px] leading-snug">
          <span className="font-semibold text-amber-300" data-on-navy>
            {t(`Recorrido · ${step} de ${TOUR_STEPS.length}`, `Tour · ${step} of ${TOUR_STEPS.length}`)}: {current.title}.
          </span>{" "}
          {current.text}
        </p>
        <div className="flex shrink-0 gap-2">
          <Link href="/equipo/bienvenida#recorrido" className="pressable flex h-11 items-center rounded-full px-3 text-[14px] font-medium text-blue-100 hover:bg-blue-800">
            {t("Salir", "Exit")}
          </Link>
          <Link
            href={last ? "/equipo/bienvenida?recorrido_hecho=1#recorrido" : tourHref(step + 1)}
            className="pressable flex h-11 items-center rounded-full bg-amber-400 px-4 text-[14px] font-semibold text-blue-900 hover:bg-amber-500"
          >
            {last ? t("Terminar", "Finish") : t("Siguiente paso", "Next step")}
          </Link>
        </div>
      </div>
    </div>
  );
}
