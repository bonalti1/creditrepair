import { replyLanguage } from "../coach/language";
import { answerWithoutModel } from "../site/askAlti";
import { LIVE_CHAT_COPY } from "./liveChat";

/**
 * What Alti says in the signup chat with a person, while no teammate is in it:
 * the website's own library answer (the FAQ, already checked against the
 * claim rules), or, with no match, that a person will answer here. No model
 * writes in this thread. Null while a teammate is in the chat: Alti is paused.
 */
export function altiLiveReply(text: string, locale: "en" | "es", status: "requested" | "joined" | "handed_back"): string | null {
  if (status === "joined") return null;
  const lang = replyLanguage(text, locale);
  const answer = answerWithoutModel(text, lang);
  return answer.source === "library" || answer.source === "greeting" ? answer.reply : LIVE_CHAT_COPY[lang].altiNoMatch;
}
