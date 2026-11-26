"use client";

import { useRef, useState } from "react";
import { isImageAsset } from "@/lib/content/check";
import { ASSET_TYPES } from "@/lib/content/assets";
import type { ActResult } from "@/lib/content/store";
import type { ContentAsset, ContentPiece } from "@/lib/content/types";
import { formatBytes } from "@/lib/staff/format";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle } from "@/components/staff/ui";
import { FIELD, Notice } from "./ui";

// A piece's files (uploads in the private bucket, or links to Canva, Drive,
// CapCut) with their alt text. Pictures and PDFs up to 20 MB, videos up to
// 500 MB; the type is read from the file itself. Any change here is a change
// to what would be published, so an approved piece goes back to review.

function AssetRow({ asset, url, editable, onAlt, onRemove }: { asset: ContentAsset; url: string | null; editable: boolean; onAlt: (text: string) => void; onRemove: () => void }) {
  const t = useTx();
  const [alt, setAlt] = useState(asset.altText);
  const image = isImageAsset(asset);
  return (
    <li className="flex gap-3 py-3" data-testid="asset">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Icon name={asset.kind === "url" ? "link" : asset.mediaType?.startsWith("video/") ? "sparkle" : "doc"} size={22} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-slate-900">
          {url || asset.kind === "url" ? (
            <a href={asset.kind === "url" ? asset.ref : url!} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline-offset-2 hover:underline">
              {asset.name}
            </a>
          ) : (
            asset.name
          )}
        </p>
        <p className="text-[12.5px] text-slate-500">
          {asset.kind === "url" ? t("Enlace", "Link") : `${asset.mediaType ?? ""}${asset.bytes ? ` · ${formatBytes(asset.bytes)}` : ""}`} · {asset.addedBy}
        </p>
        {image || asset.kind === "url" ? (
          <label className="mt-1.5 block text-[12.5px] font-medium text-slate-600">
            {t("Texto alternativo (qué muestra la imagen)", "Alt text (what the picture shows)")}
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              onBlur={() => alt !== asset.altText && onAlt(alt)}
              readOnly={!editable}
              maxLength={500}
              className={`${FIELD} mt-1 h-11 md:h-10 text-[14px] ${image && alt.trim().length < 5 ? "ring-red-300" : ""}`}
            />
          </label>
        ) : null}
      </div>
      {editable ? (
        <button type="button" onClick={onRemove} className={`${QUIET_BUTTON} self-start`} aria-label={t(`Quitar ${asset.name}`, `Remove ${asset.name}`)}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </li>
  );
}

export function PieceFiles({
  piece,
  fileUrls,
  editable,
  upload,
  addLink,
  act,
}: {
  piece: ContentPiece;
  fileUrls: Record<string, string>;
  editable: boolean;
  upload: (file: File, altText: string) => Promise<ActResult>;
  addLink: (url: string, name: string, altText: string) => Promise<ActResult>;
  act: (a: { action: "update_asset"; id: string; assetId: string; altText: string } | { action: "remove_asset"; id: string; assetId: string }) => Promise<ActResult>;
}) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [linkName, setLinkName] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const done = (r: ActResult, ok: string) => setMessage(r.ok ? { text: ok, tone: "info" } : { text: r.message[locale], tone: "error" });

  return (
    <section aria-labelledby="files-title" data-testid="piece-files">
      <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{piece.assets.length}</span>}>
        <span id="files-title">{t("Archivos y enlaces", "Files and links")}</span>
      </SectionTitle>
      <div className="card px-4 py-2">
        {piece.assets.length === 0 ? <p className="py-3 text-[14px] text-slate-500">{t("Todavía no hay archivos.", "No files yet.")}</p> : null}
        <ul className="divide-y divide-slate-100">
          {piece.assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              url={fileUrls[asset.id] ?? null}
              editable={editable}
              onAlt={(altText) => void act({ action: "update_asset", id: piece.id, assetId: asset.id, altText }).then((r) => done(r, t("Descripción guardada.", "Description saved.")))}
              onRemove={() => void act({ action: "remove_asset", id: piece.id, assetId: asset.id }).then((r) => done(r, t("Archivo quitado.", "File removed.")))}
            />
          ))}
        </ul>
        {editable ? (
          <div className="space-y-3 border-t hairline py-3">
            <div>
              <input
                ref={input}
                type="file"
                accept={ASSET_TYPES.join(",")}
                className="sr-only"
                id="content-file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setBusy(true);
                  setMessage(null);
                  done(await upload(file, ""), t("Archivo guardado.", "File saved."));
                  setBusy(false);
                }}
              />
              <label htmlFor="content-file" className={`${SECONDARY_BUTTON_COMPACT} cursor-pointer gap-1.5 px-4 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                <Icon name="plus" size={16} />
                {busy ? t("Subiendo…", "Uploading…") : t("Subir un archivo", "Upload a file")}
              </label>
              <p className="mt-1.5 text-[12px] text-slate-500">{t("JPEG, PNG, WebP, GIF o PDF hasta 20 MB; MP4, MOV o WebM hasta 500 MB.", "JPEG, PNG, WebP, GIF or PDF up to 20 MB; MP4, MOV or WebM up to 500 MB.")}</p>
            </div>
            <form
              className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await addLink(link, linkName, "");
                done(r, t("Enlace agregado.", "Link added."));
                if (r.ok) {
                  setLink("");
                  setLinkName("");
                }
              }}
            >
              <label>
                <span className="sr-only">{t("Enlace https", "https link")}</span>
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://canva.com/…" inputMode="url" className={`${FIELD} h-11`} />
              </label>
              <label>
                <span className="sr-only">{t("Nombre", "Name")}</span>
                <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder={t("Nombre", "Name")} maxLength={160} className={`${FIELD} h-11`} />
              </label>
              <button type="submit" disabled={!link.trim()} className={SECONDARY_BUTTON_COMPACT}>
                {t("Agregar enlace", "Add link")}
              </button>
            </form>
          </div>
        ) : null}
        {message ? (
          <div className="pb-3">
            <Notice message={message.text} tone={message.tone} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
