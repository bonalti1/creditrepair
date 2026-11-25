"use client";

import { useState } from "react";
import { CHANNEL_LABEL, TYPE_LABEL } from "@/lib/content/labels";
import { useContent } from "@/lib/content/store";
import { languagesOf, type ContentPiece } from "@/lib/content/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";
import { ContentGate, ContentHeader, DemoNote, Tag } from "@/components/staff/content/ui";
import { formatBytes } from "@/lib/staff/format";
import { partnerMaterialOf } from "@/lib/content/share";

// Partner material: the approved pieces for realtors and lenders, to read,
// copy and download. What sales may see of the content hub (content.share);
// the database's policy holds the same for their connection. Only approved
// words are here, exactly as approved.

export default function PartnerKitPage() {
  const t = useTx();
  return (
    <ContentGate needs="content.share" title={t("Material para socios", "Partner kit")}>
      <PartnerKit />
    </ContentGate>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useTx();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className={`${SECONDARY_BUTTON_COMPACT} gap-1.5 px-4`}
    >
      <Icon name={copied ? "check" : "clipboard"} size={16} />
      <span aria-live="polite">{copied ? t("Copiado", "Copied") : t("Copiar el texto", "Copy the text")}</span>
    </button>
  );
}

function Material({ piece, fileUrls }: { piece: ContentPiece; fileUrls: Record<string, string> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  return (
    <li className="card px-5 py-4" data-testid="partner-material">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{TYPE_LABEL[locale][piece.type]}</Tag>
        {piece.channels.map((c) => (
          <Tag key={c}>{CHANNEL_LABEL[locale][c]}</Tag>
        ))}
        <Tag tone="bg-blue-700 text-white">{t("Aprobado", "Approved")}</Tag>
      </div>
      <h2 className="mt-2 text-[17px] font-semibold text-slate-900">{piece.title}</h2>
      <div className={`mt-3 grid gap-3 ${languagesOf(piece.language).length > 1 ? "md:grid-cols-2" : ""}`}>
        {languagesOf(piece.language).map((lang) => {
          const text = [piece.copy.hook[lang], piece.copy.caption[lang], piece.copy.cta[lang]].filter(Boolean).join("\n\n");
          return (
            <div key={lang} className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{lang === "en" ? t("Inglés", "English") : t("Español", "Spanish")}</p>
              <p lang={lang} className="mt-1 whitespace-pre-line text-[14.5px] leading-relaxed text-slate-800">
                {text}
              </p>
              <div className="mt-3">
                <CopyButton text={text} />
              </div>
            </div>
          );
        })}
      </div>
      {piece.assets.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {piece.assets.map((a) => {
            const href = a.kind === "url" ? a.ref : fileUrls[a.id];
            return (
              <li key={a.id} className="text-[14px]">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" download={a.kind === "upload" ? a.name : undefined} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-blue-700 hover:underline">
                    <Icon name="download" size={16} />
                    {a.name}
                    {a.bytes ? <span className="text-[12.5px] font-normal text-slate-500">· {formatBytes(a.bytes)}</span> : null}
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center gap-1.5 text-slate-600">
                    <Icon name="doc" size={16} />
                    {a.name}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function PartnerKit() {
  const t = useTx();
  const content = useContent();
  const pieces = partnerMaterialOf(content.pieces);
  if (!content.ready) return <div className="h-40" aria-busy="true" />;
  return (
    <main className="animate-rise">
      <ContentHeader
        title={t("Material para socios", "Partner kit")}
        lead={t("Lo aprobado para agentes inmobiliarios y prestamistas. Copia el texto tal cual: si hay que cambiarlo, pídelo al equipo de contenido.", "What's approved for realtors and lenders. Copy the words as they are: if they need changing, ask the content team.")}
      />
      <DemoNote live={content.live} />
      {pieces.length === 0 ? (
        <p className="card mt-5 px-5 py-4 text-[14px] text-slate-500">{t("Todavía no hay material aprobado para socios.", "No approved partner material yet.")}</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {pieces.map((piece) => (
            <Material key={piece.id} piece={piece} fileUrls={content.fileUrls} />
          ))}
        </ul>
      )}
    </main>
  );
}
