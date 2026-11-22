// A word-by-word comparison of two texts, for the editor's "Cambios" view and
// the attorney's packet. Words, spaces and chips are the units, so a chip is
// never shown half changed.

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

const UNIT = /\{[^{}\s]*\}|\n|[^\S\n]+|[^\s{]+|\{/g;

function units(text: string): string[] {
  return text.match(UNIT) ?? [];
}

/** Above this many cells the comparison is made line by line instead (very long letters). */
const MAX_CELLS = 2_500_000;

function lcsDiff(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j] = longest common run of a[i..] and b[j..].
  const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push("removed", a[i]!);
      i++;
    } else {
      push("added", b[j]!);
      j++;
    }
  }
  while (i < n) push("removed", a[i++]!);
  while (j < m) push("added", b[j++]!);
  return parts;
}

/** The parts of `after` against `before`: same, added and removed, in reading order. */
export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  let a = units(before);
  let b = units(after);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    a = before.split(/(?<=\n)/);
    b = after.split(/(?<=\n)/);
  }
  return lcsDiff(a, b);
}

/** True when the two texts differ. */
export function hasChanges(parts: DiffPart[]): boolean {
  return parts.some((p) => p.kind !== "same");
}

/** How many words were added and removed: "+12 / −3" on the screen. */
export function diffStats(parts: DiffPart[]): { added: number; removed: number } {
  const words = (text: string) => (text.match(/\S+/g) ?? []).length;
  return {
    added: parts.filter((p) => p.kind === "added").reduce((sum, p) => sum + words(p.text), 0),
    removed: parts.filter((p) => p.kind === "removed").reduce((sum, p) => sum + words(p.text), 0),
  };
}

/** The whole comparison of a letter: its "Re:" line and its body. */
export function diffSources(before: { subject: string; body: string }, after: { subject: string; body: string }): { subject: DiffPart[]; body: DiffPart[] } {
  return { subject: diffText(before.subject, after.subject), body: diffText(before.body, after.body) };
}
