"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

// "Más": everything beyond the conversation and the report, in plain words.
// Each row says what it's for — no jargon tab names to decode.

export default function Mas() {
  const { locale, d } = useLocale();
  const es = locale === "es";
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

  const rows = [
    {
      href: "/audit",
      icon: "📋",
      title: d.nav.audit,
      desc: es ? "El resumen completo de lo que encontramos en tu reporte." : "The full summary of what we found on your report.",
    },
    {
      href: "/items",
      icon: "🔍",
      title: d.nav.review,
      desc: es ? "Revisa o cambia tus decisiones, elemento por elemento." : "Review or change your decisions, item by item.",
    },
    {
      href: "/attack",
      icon: "✉️",
      title: es ? "Mis cartas" : "My letters",
      desc: es ? "Lee cada carta completa antes de enviar." : "Read every letter in full before sending.",
    },
    {
      href: "/rounds",
      icon: "📬",
      title: d.nav.rounds,
      desc: es ? "Qué enviaste, cuándo responden y qué sigue." : "What you sent, when they respond, and what's next.",
    },
  ];

  return (
    <main className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">{d.nav.more}</h1>
      <div className="mt-5 space-y-3">
        {rows.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-300"
          >
            <span className="text-3xl">{r.icon}</span>
            <span>
              <span className="block text-lg font-semibold text-slate-900">{r.title}</span>
              <span className="block text-sm text-slate-600">{r.desc}</span>
            </span>
          </Link>
        ))}

        <a
          href={
            whatsapp
              ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(es ? "Hola, necesito ayuda con mi cuenta de Bonalti." : "Hi, I need help with my Bonalti account.")}`
              : "/asistente"
          }
          className="flex items-center gap-4 rounded-2xl border-2 border-green-300 bg-green-50 p-4 hover:border-green-500"
        >
          <span className="text-3xl">🤝</span>
          <span>
            <span className="block text-lg font-semibold text-slate-900">
              {es ? "Hablar con una persona" : "Talk to a person"}
            </span>
            <span className="block text-sm text-slate-600">
              {es ? "Nuestro equipo te ayuda por WhatsApp, en español. Gratis." : "Our team helps you on WhatsApp. Free."}
            </span>
          </span>
        </a>
      </div>
    </main>
  );
}
