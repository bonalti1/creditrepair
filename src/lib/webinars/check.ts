import { checkMarketingCopy } from "../compliance/guardrails";

// A webinar's public words (its titles and topic) are checked like any page a
// prospect reads, on the screen as they are typed and again on the server
// before they are saved: no promised result, never "free", no pressure.

const FREE = /\bfree\b|\bgratis\b|\bgratuit[oa]s?\b/i;
const PRESSURE = /today only|last (spots?|chance)|hurry|act now|limited time|don['’]t wait|don['’]t miss|solo hoy|[uú]ltimos lugares|ap[uú]rate|date prisa|por tiempo limitado|no esperes|no te lo pierdas/i;
const SCORE = /\+\s?\d+\s?(pts?|points?|puntos?)|\b\d{3}\s?(score|puntaje)\b/i;

export type CopyProblem = "promise" | "free" | "pressure" | "score";

export function webinarCopyProblems(text: string): CopyProblem[] {
  const out: CopyProblem[] = [];
  if (checkMarketingCopy(text, "full_service").length > 0) out.push("promise");
  if (FREE.test(text)) out.push("free");
  if (PRESSURE.test(text)) out.push("pressure");
  if (SCORE.test(text)) out.push("score");
  return out;
}
