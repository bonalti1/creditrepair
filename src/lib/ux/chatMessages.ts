// One message of the client's thread, and who wrote it.
//
// Three voices can appear in the thread: the client, the AI assistant
// and, when a teammate answers, a person. The rules for telling them apart
// live here, away from the screen, so they can be tested:
//
// - A message is a person's only when it says so itself (`author`). The server
//   sets that from chat_messages.source = 'human'; nothing the client types
//   can produce it.
// - A person's message is never presented as the assistant's: it carries the
//   teammate's first name and "del equipo", and no AI label.
// - A message saved before `author` existed has none and renders as before.

export interface ChatAuthor {
  /** A person on the team. The only kind there is: the assistant and the client need no author. */
  kind: "team";
  /** The teammate's name as stored. May be empty when the server has no name for them. */
  name: string;
}

export interface ChatMsg {
  role: "assistant" | "user";
  text: string;
  /**
   * Scripted lines only: the language `text` is written in, and the same line
   * in the other language, so the thread follows the language switch. Typed
   * questions and coach replies carry neither and stay as written. Both live
   * in this browser only; the server copy stores `text`.
   */
  lang?: "es" | "en";
  alt?: string;
  /** Present only on a message a teammate wrote. Absent on the assistant's and the client's. */
  author?: ChatAuthor;
}

/** What to show for a message in the active language. */
export function messageText(m: ChatMsg, locale: "es" | "en"): string {
  return m.alt && m.lang && m.lang !== locale ? m.alt : m.text;
}

/** "ana maría lópez" → "Ana". Empty when there is no name. */
export function teamFirstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? first.charAt(0).toLocaleUpperCase("es") + first.slice(1) : "";
}

export interface MessageVoice {
  /** Whose words these are. */
  kind: "client" | "assistant" | "team";
  /** True only for the assistant: the one voice that is artificial intelligence. */
  ai: boolean;
  /** Team only: the line shown above the bubble, "Ana · del equipo". Null otherwise. */
  byline: string | null;
  /** What the read-aloud button says: a teammate's message starts with who wrote it. */
  spoken: string;
}

const TEAM = {
  es: { label: "del equipo", unnamed: "Una persona del equipo" },
  en: { label: "from the team", unnamed: "A person from the team" },
} as const;

/** Who is speaking in a message, and how the thread should say so. */
export function messageVoice(m: ChatMsg, locale: "es" | "en"): MessageVoice {
  const text = messageText(m, locale);
  if (m.role === "user") return { kind: "client", ai: false, byline: null, spoken: text };
  if (m.author?.kind !== "team") return { kind: "assistant", ai: true, byline: null, spoken: text };
  const first = teamFirstName(m.author.name);
  const byline = first ? `${first} · ${TEAM[locale].label}` : TEAM[locale].unnamed;
  const speaker = first ? `${first}, ${TEAM[locale].label}` : TEAM[locale].unnamed;
  return { kind: "team", ai: false, byline, spoken: `${speaker}: ${text}` };
}

/** A turn as /api/chat returns it (chat/history.ts: ChatTurn). */
export interface ServerTurn {
  role: "assistant" | "user";
  text: string;
  source?: string;
  authorName?: string;
}

/** A server turn as a thread message. Only a "human" turn becomes a teammate's message. */
export function fromServerTurn(turn: ServerTurn): ChatMsg {
  const msg: ChatMsg = { role: turn.role, text: turn.text };
  if (turn.role === "assistant" && turn.source === "human") {
    msg.author = { kind: "team", name: typeof turn.authorName === "string" ? turn.authorName : "" };
  }
  return msg;
}

/**
 * The thread saved in this browser, read defensively: anything that is not a
 * message is dropped, and each optional part is kept only when it is well
 * formed. Messages saved before translations or authors existed have neither
 * and are kept as they are.
 */
export function readStoredThread(parsed: unknown): ChatMsg[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (m): m is ChatMsg =>
        typeof m === "object" && m !== null &&
        ((m as ChatMsg).role === "assistant" || (m as ChatMsg).role === "user") &&
        typeof (m as ChatMsg).text === "string",
    )
    .map((m) => {
      const msg: ChatMsg = { role: m.role, text: m.text };
      if ((m.lang === "es" || m.lang === "en") && typeof m.alt === "string" && m.alt) {
        msg.lang = m.lang;
        msg.alt = m.alt;
      }
      const author = m.author as unknown;
      if (
        m.role === "assistant" &&
        typeof author === "object" && author !== null &&
        (author as ChatAuthor).kind === "team" &&
        typeof (author as ChatAuthor).name === "string"
      ) {
        msg.author = { kind: "team", name: (author as ChatAuthor).name };
      }
      return msg;
    });
}

/**
 * The text a message contributes to the coach's context. A teammate's line is
 * marked as such, so the model does not take a person's words for its own.
 */
export function contextText(m: ChatMsg): string {
  if (m.role === "assistant" && m.author?.kind === "team") {
    const first = teamFirstName(m.author.name);
    return `[Mensaje de ${first || "una persona"} del equipo, no de la IA] ${m.text}`;
  }
  return m.text;
}
