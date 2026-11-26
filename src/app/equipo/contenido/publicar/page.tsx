"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CHANNEL_LABEL } from "@/lib/content/labels";
import { zonedLabel } from "@/lib/content/calendar";
import { PROVIDER_OF, type ConnectionView, type ProviderId } from "@/lib/content/publish/types";
import { useContent } from "@/lib/content/store";
import { PUBLISH_CHANNELS } from "@/lib/content/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import Icon from "@/components/Icon";
import { QUIET_BUTTON, SECONDARY_BUTTON_COMPACT, SectionTitle, Switch } from "@/components/staff/ui";
import { ContentGate, ContentHeader, DemoNote, Notice } from "@/components/staff/content/ui";

// Publishing settings (administrators: content.publish). The global switch
// and each channel start OFF. Accounts are connected with OAuth
// (/api/staff/content/connect/<provider>); the tokens are encrypted on the
// server and never shown here: only the account, the status, the expiry and
// the permissions granted. What each network requires before real posting
// works is written beside it (docs/CONTENT.md, "Connecting the accounts").

const PROVIDER_NAME: Record<ProviderId, string> = { meta: "Meta (Facebook + Instagram)", tiktok: "TikTok", youtube: "YouTube" };

const REQUIRES: Record<ProviderId, [string, string]> = {
  meta: [
    "Una app de Meta con verificación de negocio y revisión de la app para pages_manage_posts e instagram_content_publish. La cuenta de Instagram debe ser de empresa y estar ligada a la página.",
    "A Meta app with business verification and app review for pages_manage_posts and instagram_content_publish. The Instagram account must be a Business account linked to the Page.",
  ],
  tiktok: [
    "Aprobación de la Content Posting API y la auditoría de TikTok. Sin auditoría, TikTok solo permite publicaciones privadas; la app publica en privado y lo dice.",
    "Content Posting API approval and TikTok's audit. Unaudited apps can post privately only; the app posts privately and says so.",
  ],
  youtube: [
    "Pantalla de consentimiento de Google verificada (el permiso de subir videos es sensible) y cuota de subida: cada video gasta 1,600 de las 10,000 unidades diarias.",
    "A verified Google OAuth consent screen (the upload scope is sensitive) and upload quota: each upload uses 1,600 of the default 10,000 units a day.",
  ],
};

const STATUS_TEXT: Record<ConnectionView["status"], [string, string]> = {
  not_configured: ["Sin configurar en el servidor", "Not set up on the server"],
  not_connected: ["Sin conectar", "Not connected"],
  connected: ["Conectada", "Connected"],
  expired: ["Venció: conéctala otra vez", "Expired: connect it again"],
  error: ["Con error: conéctala otra vez", "Error: connect it again"],
};

const BACK_ERROR: Record<string, [string, string]> = {
  not_configured: ["Esa red no está configurada en el servidor.", "That network is not set up on the server."],
  declined: ["Se canceló la conexión.", "The connection was cancelled."],
  state: ["El enlace de conexión venció o no era de esta sesión. Inténtalo otra vez.", "The connection link expired or was not from this session. Try again."],
  exchange: ["La red no aceptó la conexión. Revisa los permisos e inténtalo otra vez.", "The network did not accept the connection. Check the permissions and try again."],
  no_token: ["La red no devolvió un permiso.", "The network returned no token."],
};


export default function PublishingPage() {
  const t = useTx();
  return (
    <ContentGate needs="content.publish" title={t("Publicar", "Publishing")}>
      <Suspense fallback={<div className="h-40" aria-busy="true" />}>
        <Publishing />
      </Suspense>
    </ContentGate>
  );
}

function Publishing() {
  const t = useTx();
  const { locale } = useStaffLocale();
  const params = useSearchParams();
  const content = useContent();
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const back = params.get("connected") ? { text: t("Cuenta conectada.", "Account connected."), tone: "info" as const } : params.get("error") ? { text: t(...(BACK_ERROR[params.get("error")!] ?? BACK_ERROR.exchange!)), tone: "error" as const } : null;
  const shown = message ?? back;
  const save = async (patch: Parameters<typeof content.saveSettings>[0]) => {
    const r = await content.saveSettings(patch);
    setMessage(r.ok ? { text: t("Guardado.", "Saved."), tone: "info" } : { text: r.message[locale], tone: "error" });
  };
  const connections = content.connections ?? [];

  if (!content.ready) return <div className="h-40" aria-busy="true" />;
  return (
    <main className="animate-rise">
      <ContentHeader
        title={t("Publicar", "Publishing")}
        lead={t(
          "La app puede publicar las piezas aprobadas a la hora programada. Todo empieza apagado; solo sale lo aprobado tal como se aprobó, y cada envío queda registrado.",
          "The app can post approved pieces at their scheduled time. Everything starts off; only what was approved goes out, exactly as approved, and every send is logged.",
        )}
      />
      <DemoNote live={content.live} />
      {shown ? (
        <div className="mt-3">
          <Notice message={shown.text} tone={shown.tone} />
        </div>
      ) : null}

      <section className="mt-6" aria-labelledby="switches">
        <SectionTitle>
          <span id="switches">{t("Interruptores", "Switches")}</span>
        </SectionTitle>
        <div className="card divide-y divide-slate-100">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-[15px] font-semibold text-slate-900">{t("Publicación de la app", "App publishing")}</p>
              <p className="text-[13px] leading-snug text-slate-500">
                {content.settings.enabled
                  ? t("Encendida: las piezas programadas salen a su hora, si pasan todas las revisiones.", "On: scheduled pieces go out at their time, if they pass every gate.")
                  : t("Apagada: nada se publica. Las piezas programadas esperan (hasta un día; después fallan y avisan).", "Off: nothing is posted. Scheduled pieces wait (up to a day; then they fail and alert).")}
              </p>
            </div>
            <Switch on={content.settings.enabled} label={t("Publicación de la app", "App publishing")} onChange={(enabled) => void save({ enabled })} testId="publishing-switch" />
          </div>
          {PUBLISH_CHANNELS.map((channel) => {
            const conn = connections.find((c) => c.provider === PROVIDER_OF[channel]);
            return (
              <div key={channel} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <p className="text-[14.5px] font-medium text-slate-900">{CHANNEL_LABEL[locale][channel]}</p>
                  <p className="text-[12.5px] text-slate-500">{conn ? t(...STATUS_TEXT[conn.status]) : t(...STATUS_TEXT.not_configured)}</p>
                </div>
                <Switch on={content.settings.channels[channel]} label={t(`Publicar en ${CHANNEL_LABEL.es[channel]}`, `Post to ${CHANNEL_LABEL.en[channel]}`)} onChange={(on) => void save({ channels: { [channel]: on } })} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="accounts">
        <SectionTitle>
          <span id="accounts">{t("Cuentas", "Accounts")}</span>
        </SectionTitle>
        <ul className="space-y-3">
          {connections.map((c) => (
            <li key={c.provider} className="card px-5 py-4" data-testid={`connection-${c.provider}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold text-slate-900">{PROVIDER_NAME[c.provider]}</p>
                  <p className={`text-[13.5px] font-medium ${c.status === "connected" ? "text-blue-700" : c.status === "expired" || c.status === "error" ? "text-red-700" : "text-slate-500"}`}>{t(...STATUS_TEXT[c.status])}</p>
                </div>
                {c.configured && content.live ? (
                  <div className="flex gap-2">
                    <a href={`/api/staff/content/connect/${c.provider}`} className={`${SECONDARY_BUTTON_COMPACT} px-4`}>
                      {c.connected ? t("Conectar otra vez", "Reconnect") : t("Conectar", "Connect")}
                    </a>
                    {c.connected ? (
                      <button type="button" onClick={() => void content.disconnect(c.provider)} className={QUIET_BUTTON}>
                        {t("Desconectar", "Disconnect")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {c.connected ? (
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
                  <dt className="text-slate-500">{t("Cuenta", "Account")}</dt>
                  <dd className="text-slate-900">{[c.account?.pageName, c.account?.igUsername && `@${c.account.igUsername}`, c.account?.displayName, c.account?.channelTitle].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt className="text-slate-500">{t("Vence", "Expires")}</dt>
                  <dd className="text-slate-900">{c.expiresAt ? zonedLabel(c.expiresAt, locale) : t("No vence (se renueva sola)", "Does not expire (renews itself)")}</dd>
                  <dt className="text-slate-500">{t("Conectó", "Connected by")}</dt>
                  <dd className="text-slate-900">{c.connectedBy ?? "—"}{c.connectedAt ? ` · ${zonedLabel(c.connectedAt, locale)}` : ""}</dd>
                  <dt className="text-slate-500">{t("Permisos", "Permissions")}</dt>
                  <dd className="break-words text-slate-900">{c.scopes.join(", ") || "—"}</dd>
                  {c.missingScopes.length > 0 ? (
                    <>
                      <dt className="text-red-700">{t("Faltan", "Missing")}</dt>
                      <dd className="break-words text-red-700">{c.missingScopes.join(", ")}</dd>
                    </>
                  ) : null}
                  {c.lastError ? (
                    <>
                      <dt className="text-slate-500">{t("Último error", "Last error")}</dt>
                      <dd className="text-slate-900">{c.lastError}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
              <p className="mt-3 flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-600">
                <Icon name="info" size={16} className="mt-0.5 shrink-0 text-slate-400" />
                <span>{t(...REQUIRES[c.provider])}</span>
              </p>
              {!c.configured ? (
                <p className="mt-2 text-[12.5px] text-slate-500">
                  {t("Para activarla, el dueño agrega en el servidor: ", "To turn it on, the owner adds on the server: ")}
                  <code className="text-[12px]">{c.provider === "meta" ? "META_APP_ID, META_APP_SECRET" : c.provider === "tiktok" ? "TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET" : "YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET"}, CONTENT_TOKEN_KEY</code>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-slate-500">
          {t(
            "Los permisos se guardan cifrados (AES-256-GCM) y nunca se muestran. Las métricas se leen solo para ver resultados; la app nunca gasta en anuncios.",
            "Tokens are stored encrypted (AES-256-GCM) and never shown. Metrics are read only to show results; the app never spends on ads.",
          )}
        </p>
      </section>
    </main>
  );
}
