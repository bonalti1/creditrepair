import { BRAND } from "@/lib/brand";

// Where the unsubscribe link of an automatic email lands. One tap records it
// (/api/unsubscribe); nothing is recorded just by opening the page.

export const metadata = { title: `Dejar de recibir mensajes · ${BRAND.name}` };

export default async function Baja({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const done = one(params.hecho) === "1";
  const u = one(params.u);
  const t = one(params.t);
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-[26px] font-bold text-blue-900">{done ? "Listo" : "Dejar de recibir mensajes automáticos"}</h1>
      {done ? (
        <p className="mt-3 text-[16px] leading-relaxed text-slate-700">
          Ya no te enviaremos mensajes automáticos por correo ni por WhatsApp. Puedes seguir escribiéndonos cuando quieras y una persona del
          equipo te responde. Si lo que quieres es cancelar tu acuerdo de servicio, lo haces en la app, en «Mi acuerdo».
        </p>
      ) : u && t ? (
        <form method="post" action="/api/unsubscribe" className="mt-4">
          <p className="text-[16px] leading-relaxed text-slate-700">
            Con un toque dejas de recibir los recordatorios y avisos automáticos de {BRAND.name}, por correo y por WhatsApp.
          </p>
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="pressable mt-5 inline-flex h-12 items-center justify-center rounded-full bg-amber-400 px-6 text-[16px] font-semibold text-blue-900 hover:bg-amber-500">
            Dejar de recibirlos
          </button>
        </form>
      ) : (
        <p className="mt-3 text-[16px] leading-relaxed text-slate-700">Este enlace no está completo. Usa el enlace del último correo que te enviamos.</p>
      )}
    </main>
  );
}
