"use client";

import { useEffect, useRef, useState } from "react";
import { VIDEO_COPY } from "@/lib/live/copy";
import { recordDemoVideoEvent } from "@/lib/live/data";
import { PACKAGE_TEXT, type PackageKey } from "@/lib/live/packages";
import type { VideoPage } from "@/lib/live/server";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";

// The private video page's screen (docs/LIVE-FUNNEL.md). Only the video, the
// two packages to start with (Complete first) and «Chat with us». What the
// person does is counted (opened, watched, «Get started», chat) by
// /api/live/v, from this browser only, so a link preview does not count as
// opened. In the person's language, with a switch.

function track(token: string, event: "opened" | "watched" | "started" | "chat", sample = false): void {
  // The demo's sample page: kept in this browser only, so the demo's review queue and Webinars counters move.
  if (sample) return recordDemoVideoEvent(token, event);
  const body = JSON.stringify({ token, event });
  try {
    if (navigator.sendBeacon?.("/api/live/v", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall through
  }
  void fetch("/api/live/v", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

export default function VideoView({ page, token, whatsapp }: { page: VideoPage; token: string; whatsapp: string | null }) {
  const [locale, setLocale] = useState<"en" | "es">(page.locale);
  const c = VIDEO_COPY[locale];
  const watched = useRef(false);
  const [failed, setFailed] = useState(false);
  const ok = page.state === "ok";

  useEffect(() => {
    if (ok) track(token, "opened", "sample" in page && page.sample === true);
  }, [ok, page, token]);

  const chatHref = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(c.chatText)}` : null;
  const sample = ok && page.sample === true;

  return (
    <main className="min-h-screen bg-slate-50" data-testid="video-page">
      <header className="bg-blue-900 px-4 py-3 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Logo size={26} tone="dark" priority />
          <button
            type="button"
            onClick={() => setLocale(locale === "es" ? "en" : "es")}
            className="pressable flex h-11 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-semibold hover:bg-white/15"
            lang={locale === "es" ? "en" : "es"}
          >
            <Icon name="globe" size={16} />
            {locale === "es" ? "English" : "Español"}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {page.state === "ok" ? (
          <>
            <h1 className="font-display text-[28px] font-bold leading-tight text-blue-800 sm:text-[34px]">{c.hello(page.firstName)}</h1>
            <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{c.sub}</p>
            {page.sample && (
              <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2 text-[14px] font-medium text-blue-900 ring-1 ring-inset ring-amber-200" data-testid="video-sample">
                {c.sample}
              </p>
            )}
            <div className="mt-4 overflow-hidden rounded-2xl bg-blue-900 shadow-lg">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={page.src}
                controls
                playsInline
                preload="metadata"
                controlsList="nodownload"
                className="aspect-video w-full"
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (!watched.current && ok && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime / v.duration >= 0.8) {
                    watched.current = true;
                    track(token, "watched", sample);
                  }
                }}
                onEnded={() => {
                  if (!watched.current && ok) {
                    watched.current = true;
                    track(token, "watched", sample);
                  }
                }}
                onError={() => setFailed(true)}
                data-testid="video-player"
              />
            </div>
            {failed && <p className="mt-2 text-[14px] text-red-700">{c.noVideo}</p>}
            <p className="mt-2 text-[13px] text-slate-500">{c.expires(new Date(page.expiresAt).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" }))}</p>

            <section className="mt-6" aria-labelledby="choose">
              <h2 id="choose" className="font-display text-[20px] font-semibold text-blue-800">
                {c.choose}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(["complete", "diy"] as PackageKey[]).map((key) => {
                  const p = PACKAGE_TEXT[locale][key];
                  return (
                    <div key={key} className={`flex flex-col rounded-2xl p-4 ${key === "complete" ? "bg-blue-900 text-white" : "card"}`} data-package={key}>
                      <p className="font-display text-[18px] font-semibold">{p.name}</p>
                      <p className={`mt-1 text-[14.5px] leading-snug ${key === "complete" ? "text-blue-100" : "text-slate-600"}`}>{p.what}</p>
                      <p className={`mt-1 text-[14.5px] font-semibold leading-snug ${key === "complete" ? "text-white" : "text-slate-900"}`}>{p.who}</p>
                      <p className={`mt-1 text-[13px] leading-snug ${key === "complete" ? "text-blue-100" : "text-slate-500"}`}>{p.charged}</p>
                      <a
                        href={page.startHref[key].replace(/([?&]lang=)(en|es)/, `$1${locale}`)}
                        onClick={() => ok && track(token, "started", sample)}
                        className={`pressable mt-3 inline-flex min-h-12 items-center justify-center rounded-full px-5 text-[16px] font-semibold ${key === "complete" ? "bg-amber-400 text-blue-900 hover:bg-amber-300" : "bg-blue-900 text-white hover:bg-blue-800"}`}
                        data-testid={`start-${key}`}
                      >
                        {c.start} · {p.name.replace(/^Credalti /, "")}
                      </a>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[14px] leading-snug text-slate-600">{c.upgrade}</p>
              <p className="mt-1 text-[14px] leading-snug text-slate-600">{c.charges}</p>
            </section>
          </>
        ) : (
          <section className="card px-5 py-6 text-center" role="status" data-testid={`video-${page.state}`}>
            <h1 className="font-display text-[24px] font-bold text-blue-800">{page.state === "expired" ? c.expiredTitle : c.goneTitle}</h1>
            <p className="mt-2 text-[15.5px] leading-relaxed text-slate-600">{page.state === "expired" ? c.expiredBody : c.goneBody}</p>
          </section>
        )}
        {chatHref && (
          <a
            href={chatHref}
            onClick={() => ok && track(token, "chat", sample)}
            className="pressable mx-auto mt-5 flex min-h-12 max-w-sm items-center justify-center gap-2 rounded-full bg-white px-5 text-[16px] font-semibold text-blue-900 ring-1 ring-blue-900/20 hover:bg-slate-50"
            data-testid="video-chat"
          >
            <Icon name="chat" size={20} />
            {c.chat}
          </a>
        )}
        <p className="mt-8 text-center text-[12.5px] leading-relaxed text-slate-500">{c.footer}</p>
      </div>
    </main>
  );
}
