import type { SupabaseClient } from "@supabase/supabase-js";
import { answerFromRow, answerInputSchema, answerProblems, mayChange, statusOnSave, type AnswerAction, type SavedAnswer } from "./answers";
import type { StaffMember } from "./access";
import type { ActionResult } from "./actions";

// The saved answers on the database (migration 0020). Reads go through the
// member's OWN connection (the read policies decide: approved answers for
// admins and specialists, a proposal for admins and its author). Writes use
// the service role after the role check, and every one is recorded in
// saved_answer_events with the words as they were.

type Row = Record<string, unknown>;

/** The library as this member may read it, newest change first. */
export async function listSavedAnswers(reader: SupabaseClient): Promise<SavedAnswer[]> {
  const { data, error } = await reader.from("saved_answers").select("*").order("updated_at", { ascending: false });
  if (error) {
    // A database without migration 0020 yet: an empty library, not an error.
    if (error.code === "42P01" || /does not exist/i.test(error.message)) return [];
    throw new Error(`saved_answers: ${error.message}`);
  }
  return ((data as Row[] | null) ?? []).flatMap((row) => answerFromRow(row) ?? []);
}

/** Approved answers only, for AltiBot and for drafts (service role: the caller already checked who is asking). */
export async function loadApprovedAnswers(db: SupabaseClient): Promise<SavedAnswer[]> {
  const { data, error } = await db.from("saved_answers").select("*").eq("status", "approved");
  if (error) return [];
  return ((data as Row[] | null) ?? []).flatMap((row) => answerFromRow(row) ?? []);
}

async function record(db: SupabaseClient, kind: "saved" | "edited" | "approved" | "deleted", member: StaffMember, row: Row): Promise<void> {
  const { error } = await db.from("saved_answer_events").insert({
    answer_id: row.id,
    kind,
    actor: member.userId,
    actor_name: member.handle,
    question: row.question,
    answer: row.answer,
    status: row.status,
    language: row.language === "en" ? "en" : "es",
  });
  if (error) throw new Error(`saved_answer_events: ${error.message}`);
}

const fail = (status: number, message: string): ActionResult<never> => ({ ok: false, status, message });

export async function changeSavedAnswer(db: SupabaseClient, member: StaffMember, action: AnswerAction, now: Date = new Date()): Promise<ActionResult<{ answer?: SavedAnswer }>> {
  if (action.action === "save" || action.action === "edit") {
    const parsed = answerInputSchema.safeParse({ question: action.question, answer: action.answer });
    if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Revisa la pregunta y la respuesta.");
    const problems = answerProblems(parsed.data, action.action === "save" ? action.clientFirstName : null);
    if (problems.length > 0) return { ok: false, status: 422, message: "No se guardó: rompe una regla.", code: "answer_rules", problems };

    if (action.action === "save") {
      const status = statusOnSave(member.role);
      if (!status) return fail(403, "Tu rol no responde a clientes.");
      const approved = status === "approved";
      const { data, error } = await db
        .from("saved_answers")
        .insert({
          question: parsed.data.question,
          answer: parsed.data.answer,
          language: action.language ?? "es",
          status,
          created_by: member.userId,
          created_by_name: member.handle,
          approved_by: approved ? member.userId : null,
          approved_by_name: approved ? member.handle : null,
          approved_at: approved ? now.toISOString() : null,
        })
        .select("*")
        .single();
      if (error || !data) throw new Error(`saved_answers: ${error?.message ?? "no row"}`);
      await record(db, "saved", member, data as Row);
      return { ok: true, answer: answerFromRow(data as Row) ?? undefined };
    }
  }

  const { data: existing } = await db.from("saved_answers").select("*").eq("id", action.id).maybeSingle();
  const current = existing ? answerFromRow(existing as Row) : null;
  if (!current) return fail(404, "Esa respuesta ya no existe.");
  if (!mayChange(member.role, member.handle, current, action.action)) {
    return fail(403, action.action === "approve" ? "Solo un administrador aprueba respuestas." : "Solo un administrador cambia una respuesta aprobada o la de otra persona.");
  }

  if (action.action === "delete") {
    await record(db, "deleted", member, existing as Row);
    const { error } = await db.from("saved_answers").delete().eq("id", action.id);
    if (error) throw new Error(`saved_answers: ${error.message}`);
    return { ok: true };
  }

  if (action.action === "approve") {
    const { data, error } = await db
      .from("saved_answers")
      .update({ status: "approved", approved_by: member.userId, approved_by_name: member.handle, approved_at: now.toISOString() })
      .eq("id", action.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(`saved_answers: ${error?.message ?? "no row"}`);
    await record(db, "approved", member, data as Row);
    return { ok: true, answer: answerFromRow(data as Row) ?? undefined };
  }

  // Edit: the words change; an approved answer stays approved only because an administrator edited it (mayChange).
  const { data, error } = await db
    .from("saved_answers")
    .update({ question: action.question.trim(), answer: action.answer.trim(), ...(action.language ? { language: action.language } : {}) })
    .eq("id", action.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`saved_answers: ${error?.message ?? "no row"}`);
  await record(db, "edited", member, data as Row);
  return { ok: true, answer: answerFromRow(data as Row) ?? undefined };
}
