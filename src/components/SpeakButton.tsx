"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import Icon from "@/components/Icon";

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
  /** Icon-only variant for use beside chat bubbles. */
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

  const label = locale === "es" ? (speaking ? "Detener" : "Escuchar") : speaking ? "Stop" : "Listen";

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    // Strip emoji and symbols so the voice reads only the words.
    const utterance = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\p{P}\p{Z}]/gu, ""));
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
      aria-label={label}
      className={`pressable inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-xs font-medium ${
        speaking ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600"
      } ${compact ? "h-8 w-8" : "h-8 px-3"} ${className}`}
    >
      <Icon name={speaking ? "stop" : "speaker"} size={16} />
      {!compact && <span>{label}</span>}
    </button>
  );
}
