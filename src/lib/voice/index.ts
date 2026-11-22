// "Escuchar": the read-aloud voice, behind one small interface so a brand
// voice can be added later without touching a screen.
//
// Today there is one voice: the phone's own speech engine (Web Speech API).
// It costs nothing, works offline and reads in the app's language. The brand
// kit has reference recordings for Alti and AltiBot; a recorded or synthetic
// brand voice would be a second adapter registered here (see docs/VOICE.md).
// No provider is wired in, and nothing here sends text anywhere.
//
// Rules for any adapter:
//  - It reads exactly the text it is given. It never rewords, summarises or
//    adds to it (the copy on screen passed the claim rules; a reworded line
//    would not have).
//  - The speaker says whose words these are. "assistant" is AltiBot's (AI);
//    "team" is the app speaking for the team as a whole; "neutral" is plain
//    app text (a status line, a lesson). A brand voice for Alti must only ever
//    read "team" or "neutral" text, never a message a real teammate wrote, and
//    must never be presented as a person speaking live.
//  - Where AltiBot's voice is used, the screen still says he is AI.

export type VoiceLocale = "es" | "en";

/** Whose words are read: decides which brand voice may read them. */
export type VoiceSpeaker = "assistant" | "team" | "neutral";

export interface SpeakOptions {
  locale: VoiceLocale;
  speaker?: VoiceSpeaker;
  /** 1 is normal speed. The default is a little slower than normal. */
  rate?: number;
  /** Called once when the reading ends, is stopped, or fails. */
  onEnd?: () => void;
}

export interface VoiceAdapter {
  /** Stable id, e.g. "browser". */
  readonly id: string;
  /** Whether it can speak on this device right now. */
  isAvailable(): boolean;
  /** Whether it has a voice for this speaker and language. */
  canSpeak(locale: VoiceLocale, speaker: VoiceSpeaker): boolean;
  /** Start reading. Stops anything already being read. */
  speak(text: string, options: SpeakOptions): void;
  stop(): void;
}

/** Text as a voice should read it: no emoji or symbols, single spaces. */
export function speechText(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}$%]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The phone's own speech engine. */
export const browserVoice: VoiceAdapter = {
  id: "browser",
  isAvailable() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  },
  canSpeak() {
    return this.isAvailable();
  },
  speak(text, { locale, rate = 0.95, onEnd }) {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText(text));
    utterance.lang = locale === "es" ? "es-US" : "en-US";
    utterance.rate = rate;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      onEnd?.();
    };
    utterance.onend = end;
    utterance.onerror = end;
    synth.speak(utterance);
  },
  stop() {
    if (this.isAvailable()) window.speechSynthesis.cancel();
  },
};

const adapters: VoiceAdapter[] = [];

/**
 * Add a voice, ahead of the ones already there. A brand voice registers itself
 * once at start-up; the browser voice stays as the fallback.
 */
export function registerVoice(adapter: VoiceAdapter): void {
  const existing = adapters.findIndex((a) => a.id === adapter.id);
  if (existing >= 0) adapters.splice(existing, 1);
  adapters.unshift(adapter);
}

/** The voice to use for this speaker and language: the first registered one that can, else the browser's. */
export function voiceFor(locale: VoiceLocale, speaker: VoiceSpeaker = "neutral"): VoiceAdapter | null {
  for (const adapter of [...adapters, browserVoice]) {
    if (adapter.isAvailable() && adapter.canSpeak(locale, speaker)) return adapter;
  }
  return null;
}

/** Stop every voice (one thing is read at a time). */
export function stopAllVoices(): void {
  for (const adapter of [...adapters, browserVoice]) {
    try {
      if (adapter.isAvailable()) adapter.stop();
    } catch {
      // ignore
    }
  }
}

/** Test helper: forget registered voices. */
export function resetVoices(): void {
  adapters.length = 0;
}
