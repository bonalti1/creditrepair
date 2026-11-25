"use client";

import Link from "next/link";
import { useState } from "react";
import { blockingIssues, checkPiece } from "@/lib/content/check";
import { AUDIENCE_LABEL, CHANNEL_LABEL, THEME_LABEL, TYPE_LABEL } from "@/lib/content/labels";
import { newPiece } from "@/lib/content/rules";
import { CONTENT_TEMPLATES, type ContentTemplate } from "@/lib/content/templates";
import { COPY_FIELDS } from "@/lib/content/types";
import { can } from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { useViewer } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON_COMPACT, QUIET_BUTTON } from "@/components/staff/ui";
import { ContentGate, ContentHeader, Tag } from "@/components/staff/content/ui";

// The templates library: reusable structures with example copy in English and
// Spanish that already pass every check (the test runs each through the same
// check as a piece). "Use this template" starts a new piece from it.

const FIELD_NAME: Record<(typeof COPY_FIELDS)[number], [string, string]> = {
  hook: ["Gancho", "Hook"],
  onScreen: ["En pantalla", "On screen"],
  script: ["Guion", "Script"],
  caption: ["Texto", "Caption"],
  cta: ["Llamada a la acción", "Call to action"],
};

export default function TemplatesPage() {
  const t = useTx();
  return (
    <ContentGate needs="content.view" title={t("Plantillas", "Templates")}>
      <Templates />
    </ContentGate>
  );
}

function TemplateCard({ template }: { template: ContentTemplate }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const { viewer } = useViewer();
  const [open, setOpen] = useState(false);
  const probe = newPiece({ action: "create", title: template.title.en, type: template.type, channels: template.channels, language: "both", audience: template.audience, theme: template.theme, copy: template.copy, characters: template.characters }, "check", new Date());
  const passes = probe ? blockingIssues(checkPiece(probe)).length === 0 && checkPiece(probe).length === 0 : false;
  return (
    <li className="card flex flex-col px-5 py-4" data-testid={`template-${template.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{TYPE_LABEL[locale][template.type]}</Tag>
        <Tag>{THEME_LABEL[locale][template.theme]}</Tag>
        <Tag tone="bg-blue-50 text-blue-700">EN+ES</Tag>
        {passes ? (
          <Tag tone="bg-blue-700 text-white">
            <Icon name="check" size={12} className="mr-1" />
            {t("Revisada", "Pre-checked")}
          </Tag>
        ) : null}
      </div>
      <h2 className="mt-2 text-[17px] font-semibold leading-snug text-slate-900">{template.title[locale]}</h2>
      <p className="mt-1 text-[14px] leading-snug text-slate-600">{template.use[locale]}</p>
      <p className="mt-1 text-[12.5px] text-slate-500">
        {AUDIENCE_LABEL[locale][template.audience]} · {template.channels.map((c) => CHANNEL_LABEL[locale][c]).join(", ")}
      </p>
      <h3 className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Estructura", "Structure")}</h3>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[13.5px] leading-snug text-slate-700">
        {template.structure.map((beat, i) => (
          <li key={i}>{beat[locale]}</li>
        ))}
      </ol>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${QUIET_BUTTON} mt-2 -ml-3 self-start`}>
        <Icon name="chevron" size={16} className={open ? "rotate-90" : ""} />
        {open ? t("Ocultar el ejemplo", "Hide the example") : t("Ver el ejemplo en inglés y español", "See the example in English and Spanish")}
      </button>
      {open ? (
        <dl className="mt-1 space-y-2">
          {COPY_FIELDS.filter((f) => template.copy[f].en || template.copy[f].es).map((f) => (
            <div key={f}>
              <dt className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t(...FIELD_NAME[f])}</dt>
              <dd className="mt-0.5 grid gap-1.5 sm:grid-cols-2">
                <p lang="en" className="rounded-xl bg-slate-50 px-3 py-2 text-[13.5px] leading-snug text-slate-800">
                  <span className="mr-1 text-[11px] font-semibold text-slate-500">EN</span>
                  {template.copy[f].en}
                </p>
                <p lang="es" className="rounded-xl bg-slate-50 px-3 py-2 text-[13.5px] leading-snug text-slate-800">
                  <span className="mr-1 text-[11px] font-semibold text-slate-500">ES</span>
                  {template.copy[f].es}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {can(viewer?.role, "content.edit") ? (
        <div className="mt-auto pt-4">
          <Link href={`/equipo/contenido/nueva?plantilla=${template.id}`} className={`${PRIMARY_BUTTON_COMPACT} px-5`}>
            {t("Usar esta plantilla", "Use this template")}
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function Templates() {
  const t = useTx();
  return (
    <main className="animate-rise">
      <ContentHeader
        title={t("Plantillas", "Templates")}
        lead={t("Estructuras reutilizables con texto de ejemplo en inglés y español que ya pasa todas las reglas. Cambia las palabras: la revisión corre otra vez.", "Reusable structures with example copy in English and Spanish that already passes every rule. Change the words: the check runs again.")}
      />
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {CONTENT_TEMPLATES.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </ul>
    </main>
  );
}
