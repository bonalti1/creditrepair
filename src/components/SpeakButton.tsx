"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

// Read-aloud for any explanation. Many users prefer listening to reading —
// this uses the phone's built-in voice (no cost, works offline) in the
// current app language.

export default function SpeakButton({
  text,
  className = "",
  compact = false,
}: {
  text: string;
  className?: string;
  /** Icon-only variant for use inside chat bubbles. */
  compact?: boolean;
}) {
  const { locale } = useLocale();
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[🤖👋👇📬🎉🚀✓⚠️✅📄]/gu, ""));
    utterance.lang = locale === "es" ? "es-US" : "en-US";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={locale === "es" ? (speaking ? "Detener" : "Escuchar") : speaking ? "Stop" : "Listen"}
      className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 ${
        compact ? "h-7 w-7 justify-center" : "px-2.5 py-1"
      } ${className}`}
    >
      {speaking ? "⏹" : "🔊"}
      {!compact && (
        <span>{locale === "es" ? (speaking ? "Detener" : "Escuchar") : speaking ? "Stop" : "Listen"}</span>
      )}
    </button>
  );
}
