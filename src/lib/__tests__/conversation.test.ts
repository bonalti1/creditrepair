import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rowToTurn, type ChatTurn } from "../chat/history";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import { checkStaffReply, displayName, lastTeamMessage, openQuestions, threadAuthor } from "../staff/conversation";
import { applyDemoActions, EMPTY_ACTIONS, withReply } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import { clientExceptions } from "../staff/stage";
import { clientTimeline } from "../staff/timeline";
import type { StaffChatMessage } from "../staff/types";
import {
  contextText,
  fromServerTurn,
  messageText,
  messageVoice,
  readStoredThread,
  teamFirstName,
  type ChatMsg,
} from "../ux/chatMessages";

const NOW = new Date("2026-12-05T18:00:00.000Z");
const later = new Date(NOW.getTime() + 5 * 60 * 1000);
const clients = buildDemoClients(NOW);

const reply = (text: string, at = later.toISOString(), authorName = "Ana"): StaffChatMessage => ({
  id: `m-${at}`,
  at,
  role: "assistant",
  source: "human",
  authorName,
  text,
});

describe("staff conversation: who wrote each message", () => {
  it("labels the client, Capi as AI, and a teammate by name", () => {
    expect(threadAuthor({ id: "1", at: "", role: "user", source: "coach", text: "Hola" })).toEqual({ voice: "client", label: "Cliente" });
    expect(threadAuthor({ id: "2", at: "", role: "user", source: "journey", text: "Hola" }).label).toBe("Cliente");
    expect(threadAuthor({ id: "3", at: "", role: "assistant", source: "journey", text: "Hola" })).toEqual({ voice: "capi", label: "Capi (IA)" });
    expect(threadAuthor({ id: "4", at: "", role: "assistant", source: "coach", text: "Hola" }).label).toBe("Capi (IA)");
    expect(threadAuthor(reply("Hola", "", "carmen"))).toEqual({ voice: "team", label: "Carmen" });
    // A teammate's message with no name on record is still a person's, never Capi's.
    expect(threadAuthor({ id: "5", at: "", role: "assistant", source: "human", text: "Hola" })).toEqual({ voice: "team", label: "Equipo" });
    expect(displayName("  ana maría  lópez ")).toBe("Ana María López");
  });

  it("gives a few demo clients a thread, in order, with an earlier teammate reply among them", () => {
    const withThread = clients.filter((c) => (c.conversation ?? []).length > 0);
    expect(withThread.length).toBeGreaterThanOrEqual(3);
    for (const c of withThread) {
      const times = c.conversation!.map((m) => m.at);
      expect(times).toEqual([...times].sort());
      expect(new Set(c.conversation!.map((m) => m.id)).size).toBe(times.length);
    }
    const voices = new Set(withThread.flatMap((c) => c.conversation!.map((m) => threadAuthor(m).voice)));
    expect([...voices].sort()).toEqual(["capi", "client", "team"]);
    // The client with the escalated question has it in her thread, followed by Capi handing it over.
    const asked = clients.find((c) => openQuestions(c).length > 0)!;
    const question = openQuestions(asked)[0]!;
    const index = asked.conversation!.findIndex((m) => m.role === "user" && m.text === question.text);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(asked.conversation![index]!.at).toBe(question.askedAt);
    expect(asked.conversation![index + 1]!.text).toMatch(/le pasé tu pregunta al equipo/);
  });

  it("puts nothing in the demo threads that the claim rules forbid", () => {
    for (const c of clients) {
      for (const m of c.conversation ?? []) {
        if (m.role !== "assistant") continue;
        expect(checkClaimGuardrails(m.text), m.text).toEqual([]);
        if (m.source === "human") expect(checkStaffReply(m.text), m.text).toEqual([]);
      }
      // When a thread opens with Capi's greeting, the greeting says he is AI.
      const first = (c.conversation ?? []).find((m) => m.role === "assistant" && m.source === "journey");
      if (first && c.conversation![0] === first) expect(first.text).toMatch(/con IA/);
    }
  });
});

describe("staff conversation: a reply is checked before it is sent", () => {
  it("lets an ordinary answer through", () => {
    expect(checkStaffReply("Sí, puedes activar el monitoreo con tu ITIN. Si te pide algo más, escríbeme por aquí.")).toEqual([]);
    expect(checkStaffReply("Los burós tienen 30 días para responder. Los resultados varían.")).toEqual([]);
  });

  it("holds back a promise, and says which phrase and why", () => {
    const guaranteed = checkStaffReply("No te preocupes, te garantizamos la eliminación de esa cuenta.");
    expect(guaranteed).toEqual([
      { phrase: "garantizamos la eliminación", why: "No se puede garantizar que algo se elimine de un reporte. Lo deciden los burós." },
    ]);
    const points = checkStaffReply("Vas a subir 80 puntos en 30 días.");
    expect(points).toEqual([{ phrase: "80 puntos en 30 días", why: "No se prometen puntos ni plazos. Los resultados varían." }]);
    expect(checkStaffReply("Nosotros eliminamos esa cobranza.")[0]).toMatchObject({ phrase: "Nosotros eliminamos" });
    expect(checkStaffReply("Con esto tienes aprobación garantizada.")[0]!.why).toMatch(/aprobación/);
  });

  it("has a plain reason for every rule the check can trip", () => {
    // One sentence per rule in guardrails.ts; each must come back with its own explanation.
    const samples = [
      "Te garantizamos la eliminación.",
      "Subes 50 puntos en 2 meses.",
      "Podemos eliminar información correcta.",
      "Te voy a arreglar el crédito.",
      "Renta con opción a compra aunque tengas mal crédito.",
      "Mejora tu puntaje con nosotros.",
      "Tienes aprobación garantizada.",
    ];
    const reasons = new Set<string>();
    for (const sample of samples) {
      const found = checkStaffReply(sample);
      expect(found.length, sample).toBeGreaterThan(0);
      expect(found.length).toBe(new Set(checkMarketingCopy(sample).map((v) => `${v.rule}|${v.match.toLowerCase()}`)).size);
      for (const problem of found) {
        expect(problem.why).not.toMatch(/Rompe una de las reglas/);
        expect(sample).toContain(problem.phrase);
        reasons.add(problem.why);
      }
    }
    expect(reasons.size).toBe(7);
  });

  it("is enforced in the data layer too, not only on the screen", () => {
    const data = readFileSync("src/lib/staff/data.ts", "utf8");
    const send = data.slice(data.indexOf("async sendReply("), data.indexOf("receiveDocument(clientId, kind) {"));
    expect(send.indexOf("checkStaffReply(body)")).toBeGreaterThan(0);
    expect(send.indexOf("checkStaffReply(body)")).toBeLessThan(send.indexOf("withReply("));
    expect(send).toMatch(/source: "human"/);
    expect(send).toMatch(/authorName: name/);
  });
});

describe("staff conversation: replying (demo)", () => {
  const asked = clients.find((c) => openQuestions(c).length > 0)!;

  it("adds the reply to the thread as a person's message with the teammate's name", () => {
    const message = reply("Sí, puedes activarlo con tu ITIN.");
    const after = applyDemoActions(clients, withReply(EMPTY_ACTIONS, asked, message)).find((c) => c.id === asked.id)!;
    expect(after.conversation!.at(-1)).toEqual(message);
    expect(after.conversation).toHaveLength(asked.conversation!.length + 1);
    expect(threadAuthor(after.conversation!.at(-1)!)).toEqual({ voice: "team", label: "Ana" });
    expect(lastTeamMessage(after.conversation!)).toEqual(message);
    expect(lastTeamMessage(asked.conversation!)).toBeNull();
  });

  it("answers the escalated question: the notice clears and does not come back", () => {
    expect(clientExceptions(asked, later).map((e) => e.kind)).toContain("question_waiting");
    const actions = withReply(EMPTY_ACTIONS, asked, reply("Sí, puedes activarlo con tu ITIN."));
    const after = applyDemoActions(clients, actions).find((c) => c.id === asked.id)!;
    expect(after.questions[0]!.answeredAt).toBe(later.toISOString());
    expect(openQuestions(after)).toEqual([]);
    expect(clientExceptions(after, later).map((e) => e.kind)).not.toContain("question_waiting");
    const muchLater = new Date(later.getTime() + 10 * 24 * 60 * 60 * 1000);
    expect(clientExceptions(after, muchLater).map((e) => e.kind)).not.toContain("question_waiting");
    expect(clientTimeline(after, later).map((e) => e.text)).toContain("El equipo respondió su pregunta");
    // The actions passed in are not changed.
    expect(EMPTY_ACTIONS.replies).toEqual({});
    expect(EMPTY_ACTIONS.handled).toEqual({});
  });

  it("a reply to a client with no pending question marks nothing as handled", () => {
    const other = clients.find((c) => (c.conversation ?? []).length > 0 && openQuestions(c).length === 0)!;
    const actions = withReply(EMPTY_ACTIONS, other, reply("Con gusto."));
    expect(actions.handled[other.id]).toEqual({});
    expect(actions.replies[other.id]).toHaveLength(1);
  });
});

describe("the client's chat: a message written by a person", () => {
  const capi: ChatMsg = { role: "assistant", text: "Hola, soy Capi." };
  const mine: ChatMsg = { role: "user", text: "¿Cuánto tardan?" };
  const team: ChatMsg = { role: "assistant", text: "Hola, ya revisé tu cuenta.", author: { kind: "team", name: "ana lópez" } };

  it("is signed with the teammate's first name and a plain 'del equipo', and is not AI", () => {
    expect(messageVoice(team, "es")).toEqual({
      kind: "team",
      ai: false,
      byline: "Ana · del equipo",
      spoken: "Ana, del equipo: Hola, ya revisé tu cuenta.",
    });
    expect(messageVoice(team, "en").byline).toBe("Ana · from the team");
    expect(teamFirstName("  carmen ")).toBe("Carmen");
  });

  it("never passes for Capi: no AI label, its own look, and read-aloud says who wrote it", () => {
    const voice = messageVoice(team, "es");
    expect(voice.byline).not.toMatch(/Capi|IA|AI|asistente/i);
    expect(voice.spoken.startsWith("Ana, del equipo: ")).toBe(true);
    // Capi stays the only AI voice, unsigned; the client is the client.
    expect(messageVoice(capi, "es")).toEqual({ kind: "capi", ai: true, byline: null, spoken: "Hola, soy Capi." });
    expect(messageVoice(mine, "es")).toEqual({ kind: "client", ai: false, byline: null, spoken: "¿Cuánto tardan?" });
    // The screen draws a teammate's message with its own component, not Capi's bubble.
    const page = readFileSync("src/app/(app)/asistente/page.tsx", "utf8");
    expect(page).toMatch(/voice\.kind === "team" && voice\.byline \? \(\s*(\/\/[^\n]*\n\s*)?<TeamMessage/);
    const bubble = readFileSync("src/components/TeamMessage.tsx", "utf8");
    expect(bubble).not.toMatch(/bg-slate-100/); // Capi's grey
    expect(bubble).not.toMatch(/Asistente con IA|AI assistant/);
  });

  it("still says a person wrote it when the name is missing", () => {
    const unnamed: ChatMsg = { role: "assistant", text: "Hola.", author: { kind: "team", name: "" } };
    expect(messageVoice(unnamed, "es")).toMatchObject({ kind: "team", ai: false, byline: "Una persona del equipo" });
    expect(messageVoice(unnamed, "en").byline).toBe("A person from the team");
  });

  it("only an assistant-side message can carry an author", () => {
    // Whatever is in storage, the client's own line is the client's.
    const forged = readStoredThread([{ role: "user", text: "Hola", author: { kind: "team", name: "Ana" } }]);
    expect(forged).toEqual([{ role: "user", text: "Hola" }]);
    expect(messageVoice({ role: "user", text: "Hola", author: { kind: "team", name: "Ana" } }, "es").kind).toBe("client");
  });

  it("renders threads saved before authors existed exactly as before", () => {
    const old = [
      { role: "assistant", text: "Anotado. Quedan 6.", lang: "es", alt: "Noted. 6 left." },
      { role: "user", text: "¿Cuánto tardan los burós?" },
      { role: "assistant", text: "Unos 30 días." },
      { role: "system", text: "no es un mensaje" },
      "basura",
      null,
    ];
    const read = readStoredThread(old);
    expect(read).toEqual([
      { role: "assistant", text: "Anotado. Quedan 6.", lang: "es", alt: "Noted. 6 left." },
      { role: "user", text: "¿Cuánto tardan los burós?" },
      { role: "assistant", text: "Unos 30 días." },
    ]);
    expect(read.map((m) => messageVoice(m, "es").kind)).toEqual(["capi", "client", "capi"]);
    expect(messageText(read[0]!, "en")).toBe("Noted. 6 left.");
    expect(readStoredThread("nada")).toEqual([]);
    // A saved teammate message keeps its author; a malformed one loses it and reads as before.
    expect(readStoredThread([team])).toEqual([team]);
    expect(readStoredThread([{ role: "assistant", text: "x", author: { kind: "bot", name: "Ana" } }])).toEqual([{ role: "assistant", text: "x" }]);
    expect(readStoredThread([{ role: "assistant", text: "x", author: "Ana" }])).toEqual([{ role: "assistant", text: "x" }]);
  });

  it("marks a teammate's line in what the coach is given, so the model does not take it for its own", () => {
    expect(contextText(team)).toBe("[Mensaje de Ana del equipo, no de la IA] Hola, ya revisé tu cuenta.");
    expect(contextText(capi)).toBe("Hola, soy Capi.");
    expect(contextText(mine)).toBe("¿Cuánto tardan?");
  });
});

describe("chat history: source and author on loaded turns", () => {
  it("carries the source, and the author's name only on a teammate's message", () => {
    const at = "2026-12-01T10:00:00Z";
    expect(rowToTurn({ role: "assistant", body: "Hola", created_at: at, source: "human", author_name: "Ana" })).toEqual<ChatTurn>({
      role: "assistant",
      text: "Hola",
      at,
      source: "human",
      authorName: "Ana",
    });
    expect(rowToTurn({ role: "assistant", body: "Hola", created_at: at, source: "coach", author_name: null })).toEqual<ChatTurn>({
      role: "assistant",
      text: "Hola",
      at,
      source: "coach",
    });
    // A name on anything but a teammate's row is ignored.
    expect(rowToTurn({ role: "assistant", body: "Hola", created_at: at, source: "coach", author_name: "Ana" }).authorName).toBeUndefined();
    expect(rowToTurn({ role: "user", body: "Hola", created_at: at, source: "journey", author_name: "Ana" }).authorName).toBeUndefined();
    // A row read before migration 0009, or with an unknown source, is still a turn.
    expect(rowToTurn({ role: "user", body: "Hola", created_at: at })).toEqual<ChatTurn>({ role: "user", text: "Hola", at });
    expect(rowToTurn({ role: "user", body: "Hola", created_at: at, source: "otro" })).toEqual<ChatTurn>({ role: "user", text: "Hola", at });
  });

  it("becomes a teammate's message in the client's thread only for a 'human' turn", () => {
    expect(fromServerTurn({ role: "assistant", text: "Hola", source: "human", authorName: "Ana" })).toEqual<ChatMsg>({
      role: "assistant",
      text: "Hola",
      author: { kind: "team", name: "Ana" },
    });
    expect(fromServerTurn({ role: "assistant", text: "Hola", source: "human" }).author).toEqual({ kind: "team", name: "" });
    expect(fromServerTurn({ role: "assistant", text: "Hola", source: "coach", authorName: "Ana" })).toEqual<ChatMsg>({ role: "assistant", text: "Hola" });
    expect(fromServerTurn({ role: "user", text: "Hola", source: "human", authorName: "Ana" })).toEqual<ChatMsg>({ role: "user", text: "Hola" });
    expect(fromServerTurn({ role: "assistant", text: "Hola" })).toEqual<ChatMsg>({ role: "assistant", text: "Hola" });
  });

  it("has a migration that adds a nullable author_name, only ever set on a teammate's row", () => {
    const sql = readFileSync("supabase/migrations/0009_chat_author.sql", "utf8");
    expect(sql).toMatch(/alter table public\.chat_messages\s+add column author_name text/);
    expect(sql).not.toMatch(/author_name text\s+not null/i);
    expect(sql).toMatch(/author_name is null or \(source = 'human'/);
    // Rows without a name are stored exactly as before, so a database that has not run 0009 keeps working.
    const history = readFileSync("src/lib/chat/history.ts", "utf8");
    expect(history).toContain("...(authorName ? { author_name: authorName } : {})");
  });
});
