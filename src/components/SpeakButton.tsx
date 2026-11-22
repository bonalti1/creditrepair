"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { stopAllVoices, voiceFor, type VoiceSpeaker } from "@/lib/voice";
import Icon from "@/components/Icon";

// "Escuchar": read-aloud for any explanation. Many clients prefer listening to
// reading. The voice comes from src/lib/voice (today the phone's own speech
// engine: no cost, works offline, in the app's language; a brand voice can be
// added there later without touching this button).

export default function SpeakButton({
  text,
  className = "",
  compact = false,
  speaker = "neutral",
  label,
  tone = "light",
}: {
  text: string;
  className?: string;
  /** Icon-only variant for use beside chat bubbles. */
  compact?: boolean;
  /** Whose words these are (src/lib/voice): AltiBot's, the team's, or plain app text. */
  speaker?: VoiceSpeaker;
  /** What is read, for screen readers on the icon-only button ("Escuchar: tu estado"). */
  label?: string;
  /** "dark" on navy backgrounds. */
  tone?: "light" | "dark";
}) {
  const { locale } = useLocale();
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(voiceFor(locale, speaker) !== null);
    return () => stopAllVoices();
  }, [locale, speaker]);

  if (!supported) return null;

  const word = locale === "es" ? (speaking ? "Detener" : "Escuchar") : speaking ? "Stop" : "Listen";

  const toggle = () => {
    if (speaking) {
      stopAllVoices();
      setSpeaking(false);
      return;
    }
    const voice = voiceFor(locale, speaker);
    if (!voice) return;
    stopAllVoices();
    setSpeaking(true);
    voice.speak(text, { locale, speaker, onEnd: () => setSpeaking(false) });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label && !speaking ? `${word}: ${label}` : word}
      aria-pressed={speaking}
      className={`pressable inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold ${
        speaking ? "bg-amber-400 text-blue-900" : tone === "dark" ? "bg-white/15 text-white hover:bg-white/20" : "bg-slate-100 text-slate-700"
      } ${compact ? "h-11 w-11" : "h-11 px-4"} ${className}`}
    >
      <Icon name={speaking ? "stop" : "speaker"} size={compact ? 20 : 18} />
      {!compact && <span>{word}</span>}
    </button>
  );
}
