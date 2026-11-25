"use client";

import type { AdsPayload } from "@/lib/ads/types";
import { ADS_TEXT } from "@/lib/ads/text";
import { shortDateTime } from "@/lib/staff/format";
import { useStaffLocale, useText, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { Chip } from "@/components/staff/ui";

// The ad platforms: Meta (read only, connected when its two variables are on
// the server), and Google Ads and TikTok Ads, which are not connected yet.
// No platform shows a number it did not read.

function Card({ name, status, tone, children, testId }: { name: string; status: string; tone: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="card flex flex-col px-5 py-4" aria-label={name} data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold uppercase tracking-[0.06em] text-blue-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue-50 text-blue-700">
            <Icon name="megaphone" size={17} />
          </span>
          {name}
        </h2>
        <Chip tone={tone}>{status}</Chip>
      </div>
      <div className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default function Platforms({ payload }: { payload: AdsPayload | null }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const text = useText(ADS_TEXT);
  const meta = payload?.meta ?? null;
  const account = payload?.snapshot.account ?? null;
  const connected = Boolean(meta?.configured && account && !payload?.sample);
  const run = payload?.snapshot.lastRun ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3" data-testid="ads-platforms">
      <Card
        name="Meta (Facebook, Instagram)"
        status={connected ? t("Conectada · solo lectura", "Connected · read only") : t("No conectada", "Not connected")}
        tone={connected ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}
        testId="platform-meta"
      >
        {connected && account ? (
          <>
            <p>
              <span className="font-semibold">{account.name}</span> · {account.currency} · {account.timeZone}
            </p>
            <p>{text.accountStatus[account.status]}</p>
            {run && (
              <p className={run.ok ? "text-slate-600" : "text-red-700"}>
                {run.ok ? t(`Última lectura: ${shortDateTime(run.at, locale)}.`, `Last read: ${shortDateTime(run.at, locale)}.`) : t(`La última lectura falló: ${run.error ?? ""}`, `The last read failed: ${run.error ?? ""}`)}
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              {payload?.sample
                ? t("En la demo los números son de muestra. Para leer la cuenta real, el servidor necesita:", "In the demo the numbers are sample. To read the real account, the server needs:")
                : t("Para leer la cuenta de anuncios, el servidor necesita:", "To read the ad account, the server needs:")}
            </p>
            <ul className="list-inside list-disc font-mono text-[12.5px] text-slate-700">
              {(meta?.missing.length ? meta.missing : ["META_ADS_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="text-slate-600">
              {t("Un token de usuario del sistema con el permiso ads_read (solo lectura). Los pasos están en docs/ADS.md.", "A system user token with the ads_read permission (read only). The steps are in docs/ADS.md.")}
            </p>
          </>
        )}
        <p className="text-[12.5px] text-slate-500">{t("Nada aquí cambia Meta: no crea, edita, pausa ni paga anuncios.", "Nothing here changes Meta: it never creates, edits, pauses or pays for ads.")}</p>
      </Card>
      <Card name="Google Ads" status={t("Todavía no conectada", "Not connected yet")} tone="bg-slate-100 text-slate-600" testId="platform-google">
        <p>{t("Todavía no se lee Google Ads, así que aquí no hay ningún número suyo.", "Google Ads is not read yet, so no number of its own shows here.")}</p>
        <p className="text-slate-600">
          {t(
            "Para conectarla hará falta un token de desarrollador de Google Ads, un acceso OAuth de solo lectura y el ID de la cuenta. Mientras tanto, su gasto entra a los libros desde el banco, bajo «Publicidad: Google».",
            "Connecting it will need a Google Ads developer token, read-only OAuth access and the account's ID. Until then, its spend reaches the books from the bank file, under “Advertising: Google”.",
          )}
        </p>
      </Card>
      <Card name="TikTok Ads" status={t("Todavía no conectada", "Not connected yet")} tone="bg-slate-100 text-slate-600" testId="platform-tiktok">
        <p>{t("Todavía no se lee TikTok Ads, así que aquí no hay ningún número suyo.", "TikTok Ads is not read yet, so no number of its own shows here.")}</p>
        <p className="text-slate-600">
          {t(
            "Para conectarla hará falta una app de TikTok for Business con permiso de lectura de reportes y el ID del anunciante. Mientras tanto, su gasto entra a los libros desde el banco, bajo «Publicidad: TikTok».",
            "Connecting it will need a TikTok for Business app with report read access and the advertiser ID. Until then, its spend reaches the books from the bank file, under “Advertising: TikTok”.",
          )}
        </p>
      </Card>
    </div>
  );
}
