"use client";

import { aiByline, BRAND, type AssistantPose } from "@/lib/brand";
import {
  ALTI_RULES,
  ALTIBOT_RULES,
  APPROVED_LINES,
  CLAIM_RULES,
  FONT_RULES,
  KIT_COLOURS,
  KIT_CONTRAST,
  KIT_DOWNLOADS,
  KIT_FONTS,
  KIT_LOGOS,
  KIT_SPECS,
  LOGO_CLEAR_SPACE_SHARE,
  LOGO_DO,
  LOGO_DONT,
  POSE_LABEL,
  VOICE_RULES,
} from "@/lib/content/brandKit";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { AltiWaveLoop, CharacterAvatar, CharacterFigure } from "@/components/Character";
import Icon from "@/components/Icon";
import { SectionTitle } from "@/components/staff/ui";

// The brand kit (/equipo/contenido/marca), read-only, from the sources of
// truth (src/lib/content/brandKit.ts). The robot appears here once, small, as
// the reference for his cameo rule: this file is on the brand test's short
// list of files that may show him, and he never speaks here either.

const SECTIONS: Array<{ id: string; label: [string, string] }> = [
  { id: "logo", label: ["Logo", "Logo"] },
  { id: "colores", label: ["Colores", "Colours"] },
  { id: "fuentes", label: ["Fuentes", "Fonts"] },
  { id: "alti", label: ["Alti", "Alti"] },
  { id: "voz", label: ["Voz y tono", "Voice and tone"] },
  { id: "reglas", label: ["Lo que no decimos", "Claim rules"] },
  { id: "video", label: ["Video", "Video specs"] },
  { id: "descargas", label: ["Descargas", "Downloads"] },
];

function Bullet({ children, tone = "do" }: { children: React.ReactNode; tone?: "do" | "dont" }) {
  return (
    <li className="flex gap-2 text-[14px] leading-snug text-slate-700">
      <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone === "do" ? "bg-blue-700 text-white" : "bg-red-50 text-red-700"}`}>
        <Icon name={tone === "do" ? "check" : "close"} size={12} />
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function BrandKit() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const L = (b: { en: string; es: string }) => b[locale];
  const poses = Object.keys(BRAND.assistantPoses) as AssistantPose[];

  return (
    <div className="mt-5 lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
      <nav aria-label={t("Secciones del kit", "Kit sections")} className="mb-5 lg:sticky lg:top-20 lg:mb-0 lg:self-start">
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:block lg:space-y-0.5 lg:px-0">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex h-11 md:h-10 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium text-slate-600 hover:bg-slate-100 lg:w-full">
                {t(...s.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-9">
        <section id="logo" aria-labelledby="kit-logo" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-logo">{t("Logo", "Logo")}</span>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            {KIT_LOGOS.map((logo) => {
              const h = logo.file.includes("check") ? 56 : 44;
              const pad = Math.round(h * LOGO_CLEAR_SPACE_SHARE);
              return (
                <figure key={logo.file} className={`overflow-hidden rounded-3xl ${logo.on === "dark" ? "bg-blue-900" : "bg-white ring-1 ring-slate-200"}`}>
                  <div className="flex h-40 items-center justify-center">
                    <span className={`inline-block border border-dashed ${logo.on === "dark" ? "border-blue-300/60" : "border-blue-300"}`} style={{ padding: pad }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logo.file} alt={logo.file.includes("check") ? "" : BRAND.name} width={Math.round((h * logo.width) / logo.height)} height={h} style={{ height: h, width: "auto" }} />
                    </span>
                  </div>
                  <figcaption className={`border-t px-4 py-3 text-[13px] ${logo.on === "dark" ? "border-blue-800 text-blue-100" : "hairline text-slate-600"}`}>
                    <span className={`block font-semibold ${logo.on === "dark" ? "text-white" : "text-slate-900"}`}>{L(logo.name)}</span>
                    {L(logo.use)}
                  </figcaption>
                </figure>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-slate-500">
            {t(
              `La línea punteada es el espacio libre mínimo: la altura de la «C», un ${Math.round(LOGO_CLEAR_SPACE_SHARE * 100)}% del alto del logo, en cada lado.`,
              `The dashed line is the minimum clear space: the height of the "C", about ${Math.round(LOGO_CLEAR_SPACE_SHARE * 100)}% of the logo's height, on every side.`,
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="card px-4 py-4">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Sí", "Do")}</h3>
              <ul className="space-y-2">
                {LOGO_DO.map((x, i) => (
                  <Bullet key={i}>{L(x)}</Bullet>
                ))}
              </ul>
            </div>
            <div className="card px-4 py-4">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("No", "Don't")}</h3>
              <ul className="space-y-2">
                {LOGO_DONT.map((x, i) => (
                  <Bullet key={i} tone="dont">
                    {L(x)}
                  </Bullet>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="colores" aria-labelledby="kit-colours" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-colours">{t("Colores", "Colours")}</span>
          </SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {KIT_COLOURS.map((c) => (
              <li key={c.hex} className="card overflow-hidden">
                <div className="h-20" style={{ background: c.hex, boxShadow: c.hex === "#FFFFFF" || c.hex === "#F5F6F8" ? "inset 0 -1px 0 rgba(0,0,0,0.08)" : undefined }} aria-hidden="true" />
                <div className="px-4 py-3">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-semibold text-slate-900">{L(c.name)}</span>
                    <code className="text-[13px] tabular-nums text-slate-600">{c.hex}</code>
                  </p>
                  <p className="text-[12px] text-slate-500">{c.token}</p>
                  <p className="mt-1 text-[13.5px] leading-snug text-slate-700">{L(c.use)}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <caption className="px-4 pt-3 text-left text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Contraste (WCAG 2.x: 4.5 para texto)", "Contrast (WCAG 2.x: 4.5 for text)")}</caption>
              <tbody className="divide-y divide-slate-100">
                {KIT_CONTRAST.map((p) => (
                  <tr key={`${p.fg}-${p.bg}`}>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex h-8 min-w-14 items-center justify-center rounded-lg px-2 text-[13px] font-semibold" style={{ color: p.fg, background: p.bg, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }}>
                        Aa
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-slate-700">{L(p.note)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={`font-semibold ${p.ok ? "text-blue-900" : "text-red-700"}`}>{p.ratio.toFixed(1)}:1</span>
                      <span className="block text-[12px] text-slate-500">{p.ok ? t("Pasa", "Passes") : t("Nunca como texto", "Never as text")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-slate-500">
            {t("Los colores del arte de los personajes (camisa, robot) describen el arte: no son colores de la interfaz. Nunca recolorees el arte.", "The colours in the characters' art (the shirt, the robot) describe the art: they are not interface colours. Never recolour the art.")}
          </p>
        </section>

        <section id="fuentes" aria-labelledby="kit-fonts" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-fonts">{t("Fuentes", "Fonts")}</span>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {KIT_FONTS.map((f) => (
              <div key={f.name} className="card px-4 py-4">
                <p className="text-[13px] text-slate-500">
                  <span className="font-semibold text-slate-900">{f.name}</span> · {f.weights} · {L(f.role)}
                </p>
                {f.display ? (
                  <p className="font-display mt-2 text-[26px] font-bold leading-tight text-blue-900 [text-wrap:balance]">{L(f.sample)}</p>
                ) : (
                  <p className="mt-2 text-[16px] leading-relaxed text-slate-800">{L(f.sample)}</p>
                )}
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 px-1">
            {FONT_RULES.map((r, i) => (
              <Bullet key={i}>{L(r)}</Bullet>
            ))}
          </ul>
        </section>

        <section id="alti" aria-labelledby="kit-alti" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-alti">{t("Alti, el asistente con IA", "Alti, the AI assistant")}</span>
          </SectionTitle>
          <div className="card overflow-hidden">
            <div className="grid gap-4 bg-blue-900 px-4 py-5 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div className="flex items-end justify-center gap-4">
                <AltiWaveLoop height={190} />
                <CharacterFigure character="assistant" view="threeQuarter" height={190} className="hidden sm:block" />
              </div>
              <div className="self-center">
                <p className="inline-flex h-7 items-center rounded-full bg-white/10 px-3 text-[13px] font-semibold text-white">{aiByline(locale)}</p>
                <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-blue-100">
                  {t(
                    "El personaje principal y la única voz. Siempre con la etiqueta de IA en pantalla. A la izquierda, el saludo animado (4 segundos; quieto para quien pide menos movimiento).",
                    "The main character and the only voice. Always with the AI label on screen. On the left, the waving loop (4 seconds; still for anyone who asks for less motion).",
                  )}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <CharacterAvatar character="assistant" size={56} tone="ivory" view="headFront" />
                  <CharacterAvatar character="assistant" size={56} tone="ivory" view="headThreeQuarter" />
                  <span className="text-[12.5px] text-blue-200">{t("Cabeza de frente y tres cuartos", "Head, front and three-quarter")}</span>
                </div>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
              {poses.map((pose) => (
                <li key={pose} className="flex flex-col items-center bg-white px-2 pb-3 pt-4">
                  <CharacterFigure character="assistant" pose={pose} height={150} />
                  <p className="mt-2 text-center text-[12.5px] font-medium leading-snug text-slate-700">{L(POSE_LABEL[pose] ?? { en: pose, es: pose })}</p>
                  <p className="text-[11px] text-slate-500">{aiByline(locale)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="card px-4 py-4">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Reglas de Alti", "Alti's rules")}</h3>
              <ul className="space-y-2">
                {ALTI_RULES.map((r, i) => (
                  <Bullet key={i}>{L(r)}</Bullet>
                ))}
              </ul>
            </div>
            <div className="card px-4 py-4" data-testid="kit-cameo">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("El cameo", "The cameo")}</h3>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BRAND.cameoImages.threeQuarter.src} srcSet={`${BRAND.cameoImages.threeQuarter.src} 1x, ${BRAND.cameoImages.threeQuarter.src2x} 2x`} alt={L(BRAND.cameoAlt)} width={56} height={Math.round((56 * BRAND.cameoImages.threeQuarter.height) / BRAND.cameoImages.threeQuarter.width)} className="h-auto w-14 shrink-0" />
                <p className="text-[13px] leading-snug text-slate-600">{t("Pequeño, siempre. Así de pequeño.", "Small, always. About this small.")}</p>
              </div>
              <ul className="mt-3 space-y-2">
                {ALTIBOT_RULES.map((r, i) => (
                  <Bullet key={i} tone="dont">
                    {L(r)}
                  </Bullet>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="voz" aria-labelledby="kit-voice" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-voice">{t("Voz y tono", "Voice and tone")}</span>
          </SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {VOICE_RULES.map((v) => (
              <li key={v.title.en} className="card px-4 py-4">
                <h3 className="text-[15px] font-semibold text-slate-900">{L(v.title)}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-slate-700">{L(v.body)}</p>
              </li>
            ))}
            <li className="rounded-3xl bg-blue-900 px-4 py-4 sm:col-span-2" data-on-navy>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-blue-200">{t("Frases aprobadas", "Approved lines")}</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                {APPROVED_LINES.map((line) => (
                  <li key={line.en} className="text-[14.5px] leading-snug text-white">
                    {line.en}
                    <span lang="es" className="block text-[13px] text-blue-200">
                      {line.es}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </section>

        <section id="reglas" aria-labelledby="kit-claims" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-claims">{t("Lo que no decimos (y por qué)", "What we never say (and why)")}</span>
          </SectionTitle>
          <ul className="card divide-y divide-slate-100 px-4">
            {CLAIM_RULES.map((r) => (
              <li key={r.rule.en} className="py-3">
                <p className="text-[15px] font-semibold text-slate-900">{L(r.rule)}</p>
                <p className="text-[14px] leading-snug text-slate-700">{L(r.why)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("La app revisa cada pieza con estas reglas, en inglés y español. No es asesoría legal: el abogado revisa las afirmaciones.", "The app checks every piece against these rules, in English and Spanish. Not legal advice: counsel reviews claims.")}</p>
        </section>

        <section id="video" aria-labelledby="kit-video" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-video">{t("Video: subtítulos, gancho y tarjeta final", "Video: captions, hook and end card")}</span>
          </SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="card overflow-hidden">
              <div className="flex h-44 flex-col items-center justify-center gap-2 bg-blue-800 px-4 text-center" aria-hidden="true">
                <p className="font-display text-[26px] font-bold leading-tight text-white" style={{ WebkitTextStroke: `3px ${KIT_SPECS.captions.stroke.split(" ")[1]}`, paintOrder: "stroke fill" }}>
                  {t("Tú decides qué está mal.", "You decide what's wrong.")}
                </p>
                <p className="font-display text-[26px] font-bold leading-tight" style={{ color: KIT_SPECS.captions.highlight, WebkitTextStroke: `3px ${KIT_SPECS.captions.stroke.split(" ")[1]}`, paintOrder: "stroke fill" }} data-on-navy>
                  {t("Nosotros, las cartas.", "We mail the letters.")}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-4 py-3 text-[13px]">
                <dt className="text-slate-500">{t("Subtítulos", "Captions")}</dt>
                <dd className="text-slate-900">
                  {KIT_SPECS.captions.font}, {KIT_SPECS.captions.sizePx} px
                </dd>
                <dt className="text-slate-500">{t("Color / resaltado", "Colour / highlight")}</dt>
                <dd className="text-slate-900 tabular-nums">
                  {KIT_SPECS.captions.color} / {KIT_SPECS.captions.highlight}
                </dd>
                <dt className="text-slate-500">{t("Borde", "Stroke")}</dt>
                <dd className="text-slate-900">{KIT_SPECS.captions.stroke}</dd>
                <dt className="text-slate-500">{t("Centro vertical", "Vertical centre")}</dt>
                <dd className="text-slate-900 tabular-nums">9:16 → {KIT_SPECS.captions.centerY["9:16"]} px · 16:9 → {KIT_SPECS.captions.centerY["16:9"]} px</dd>
                <dt className="text-slate-500">{t("Gancho", "Hook")}</dt>
                <dd className="text-slate-900 tabular-nums">
                  {KIT_SPECS.hook.sizePx} px · 9:16 → {KIT_SPECS.hook.centerY["9:16"]} px · 16:9 → {KIT_SPECS.hook.centerY["16:9"]} px
                </dd>
              </dl>
            </div>
            <div className="card overflow-hidden">
              <div className="flex h-44 flex-col items-center justify-center gap-3 bg-blue-900 px-4 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BRAND.logo.onDark.src} alt={BRAND.name} width={Math.round((44 * BRAND.logo.onDark.width) / BRAND.logo.onDark.height)} height={44} style={{ height: 44, width: "auto" }} />
                <p className="font-display text-[17px] font-semibold text-white" dangerouslySetInnerHTML={{ __html: KIT_SPECS.endCard.tagline.replace("<b>", '<b class="text-amber-400" data-on-navy>') }} />
                <p className="max-w-sm text-[11.5px] leading-snug text-blue-200">{KIT_SPECS.endCard.legal}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-4 py-3 text-[13px]">
                <dt className="text-slate-500">{t("Tarjeta final", "End card")}</dt>
                <dd className="text-slate-900">{t(`${KIT_SPECS.endCard.seconds} segundos`, `${KIT_SPECS.endCard.seconds} seconds`)}</dd>
                <dt className="text-slate-500">{t("Logo", "Logo")}</dt>
                <dd className="text-slate-900">{t("El archivo blanco, tal cual, sobre azul", "The white file, as is, on navy")}</dd>
                <dt className="text-slate-500">{t("Línea legal", "Legal line")}</dt>
                <dd className="text-slate-900">{t("Siempre, en el idioma del video", "Always, in the video's language")}</dd>
                <dt className="text-slate-500">{t("Imagen", "Look")}</dt>
                <dd className="text-slate-900">{t("Comercial real, 35 mm, luz dorada, cámara fija", "Live-action commercial, 35 mm, golden light, locked-off camera")}</dd>
              </dl>
            </div>
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Medidas de content/brand/lock.json, para 1080 × 1920 (9:16) y 1920 × 1080 (16:9).", "Specs from content/brand/lock.json, for 1080 × 1920 (9:16) and 1920 × 1080 (16:9).")}</p>
        </section>

        <section id="descargas" aria-labelledby="kit-downloads" className="scroll-mt-20">
          <SectionTitle>
            <span id="kit-downloads">{t("Descargas", "Downloads")}</span>
          </SectionTitle>
          <ul className="card divide-y divide-slate-100">
            {KIT_DOWNLOADS.map((d) => (
              <li key={d.file}>
                <a href={d.file} download className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-[14px] text-slate-800 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-medium">{L(d.name)}</span>
                    <span className="block truncate text-[12px] text-slate-500">{d.file}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold uppercase text-blue-700">
                    <Icon name="download" size={16} />
                    {d.kind}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Los archivos son los del kit, sin cambios. Úsalos tal cual.", "These are the kit's own files, unchanged. Use them as they are.")}</p>
        </section>
      </div>
    </div>
  );
}
