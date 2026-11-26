import { BRAND } from "@/lib/brand";
import { inRequestLocale, requestLocale } from "@/lib/i18n/server";

// Where the unsubscribe link of a webinar reminder email lands
// (src/lib/webinars/unsubscribe.ts). One tap records it (/api/webinars/unsubscribe);
// nothing is recorded just by opening the page. In the email's language (?lang=).

const COPY = {
  en: {
    title: "Stop the class reminders",
    doneTitle: "Done",
    done: `We will no longer send you automated messages from ${BRAND.name}, by email or WhatsApp. You can still write to us any time, and a person on our team will answer.`,
    ask: `One tap stops the reminders about this class, and every other automated message from ${BRAND.name}, by email and by WhatsApp.`,
    button: "Stop them",
    broken: "This link is not complete. Please use the link in the last email we sent you.",
    other: "Español",
  },
  es: {
    title: "Dejar de recibir los recordatorios de la clase",
    doneTitle: "Listo",
    done: `Ya no te enviaremos mensajes automáticos de ${BRAND.name}, por correo ni por WhatsApp. Puedes seguir escribiéndonos cuando quieras y una persona del equipo te responde.`,
    ask: `Con un toque dejas de recibir los recordatorios de esta clase, y cualquier otro mensaje automático de ${BRAND.name}, por correo y por WhatsApp.`,
    button: "Dejar de recibirlos",
    broken: "Este enlace no está completo. Usa el enlace del último correo que te enviamos.",
    other: "English",
  },
} as const;

export async function generateMetadata() {
  return { title: `${await inRequestLocale({ en: COPY.en.title, es: COPY.es.title })} · ${BRAND.name}`, robots: { index: false, follow: false } };
}

export default async function WebinarBaja({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const done = one(params.hecho) === "1";
  const r = one(params.r);
  const t = one(params.t);
  const locale = (await requestLocale()).locale;
  const c = COPY[locale];
  const other = new URLSearchParams({ ...(done ? { hecho: "1" } : {}), ...(r ? { r } : {}), ...(t ? { t } : {}), lang: locale === "es" ? "en" : "es" });
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="mb-6 flex justify-end">
        <a href={`/webinar/baja?${other.toString()}`} lang={locale === "es" ? "en" : "es"} className="pressable inline-flex h-11 items-center rounded-full bg-slate-100 px-4 text-[13px] font-semibold text-slate-700">
          {c.other}
        </a>
      </div>
      <h1 className="font-display text-[26px] font-bold text-blue-900">{done ? c.doneTitle : c.title}</h1>
      {done ? (
        <p className="mt-3 text-[16px] leading-relaxed text-slate-700">{c.done}</p>
      ) : r && t ? (
        <form method="post" action="/api/webinars/unsubscribe" className="mt-4">
          <p className="text-[16px] leading-relaxed text-slate-700">{c.ask}</p>
          <input type="hidden" name="r" value={r} />
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="pressable mt-5 inline-flex h-12 items-center justify-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
            {c.button}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-[16px] leading-relaxed text-slate-700">{c.broken}</p>
      )}
    </main>
  );
}
