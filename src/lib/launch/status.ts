import { ITEM_BY_KEY, LAUNCH_ITEMS, OUTCOMES, type ItemState, type LaunchFacts, type LaunchGroup, type LaunchItem, type Needed, type Note, type Outcome, type Tick, type Who } from "./checklist";

// The launch report: every item's status from the facts, and the summary at
// the top of the screen. Pure: the server builds it from the real facts, the
// demo from its sample facts, the tests from any.
//
// The rule that matters: `live` is true only when EVERY required item is
// "ready". "Needs a check", "owner ticks by hand", "late" and "failing" are
// not ready.

export interface ItemReport {
  key: string;
  group: LaunchGroup;
  needed: Needed;
  who: Who;
  kind: LaunchItem["kind"];
  state: ItemState;
  notes: Note[];
  missingEnv: string[];
  docs: LaunchItem["docs"];
  blocks: readonly Outcome[];
  /** Items it waits on that are not ready yet. */
  waitingOn: string[];
  probe: LaunchItem["probe"] | null;
  tick: Tick | null;
}

export interface Count {
  ready: number;
  total: number;
}

export interface LaunchSummary {
  required: Count;
  recommended: Count;
  later: Count;
  /** True only when every required item is ready. */
  live: boolean;
  /** The next things to do: required items not ready, in priority order, whose own prerequisites are ready first. */
  next: string[];
  /** For each outcome that something blocks: the required or recommended items not ready that block it. */
  blocked: Array<{ outcome: Outcome; by: string[] }>;
  failing: number;
}

export interface LaunchReport {
  items: ItemReport[];
  summary: LaunchSummary;
  /** When the facts were read. */
  at: string;
  /** Sample facts (the demo): nothing was checked. */
  sample: boolean;
  /** The template names listed in WHATSAPP_APPROVED_TEMPLATES (names, not secrets). */
  templatesListed: string[];
}

function evaluate(item: LaunchItem, facts: LaunchFacts): { state: ItemState; notes: Note[]; missingEnv: string[] } {
  try {
    const e = item.evaluate ? item.evaluate(facts) : { state: "missing" as const, notes: [] };
    return { state: e.state, notes: e.notes, missingEnv: e.missingEnv ?? [] };
  } catch {
    // An item that cannot be worked out is never ready.
    return { state: "failing", notes: [{ code: "db_unreadable" }], missingEnv: [] };
  }
}

export function launchReport(facts: LaunchFacts, options: { sample?: boolean } = {}): LaunchReport {
  const first = new Map(LAUNCH_ITEMS.map((item) => [item.key, evaluate(item, facts)]));
  const items: ItemReport[] = LAUNCH_ITEMS.map((item) => {
    const e = first.get(item.key)!;
    return {
      key: item.key,
      group: item.group,
      needed: item.needed,
      who: item.who,
      kind: item.kind,
      state: e.state,
      notes: e.notes,
      missingEnv: e.missingEnv,
      docs: item.docs,
      blocks: item.blocks,
      waitingOn: (item.waitsOn ?? []).filter((k) => first.get(k)?.state !== "ready"),
      probe: item.probe ?? null,
      tick: item.kind === "manual" ? (facts.ticks[item.key] ?? null) : null,
    };
  });
  return { items, summary: summarize(items), at: facts.now, sample: Boolean(options.sample), templatesListed: [...facts.env.templatesListed] };
}

const count = (items: ItemReport[], needed: Needed): Count => {
  const of = items.filter((i) => i.needed === needed);
  return { ready: of.filter((i) => i.state === "ready").length, total: of.length };
};

export function summarize(items: ItemReport[]): LaunchSummary {
  const required = count(items, "required");
  const notReady = items.filter((i) => i.state !== "ready");
  const priority = (key: string) => ITEM_BY_KEY.get(key)?.priority ?? 999;
  // Next: required items not ready, whose prerequisites are ready (something to do now), by priority; then the rest.
  const todo = notReady.filter((i) => i.needed === "required").sort((a, b) => priority(a.key) - priority(b.key));
  const doable = todo.filter((i) => i.waitingOn.length === 0);
  const next = [...doable, ...todo.filter((i) => i.waitingOn.length > 0)].slice(0, 3).map((i) => i.key);
  const blocked = OUTCOMES.flatMap((outcome) => {
    const by = notReady.filter((i) => i.needed !== "later" && i.blocks.includes(outcome)).sort((a, b) => priority(a.key) - priority(b.key)).map((i) => i.key);
    return by.length > 0 ? [{ outcome, by }] : [];
  });
  return {
    required,
    recommended: count(items, "recommended"),
    later: count(items, "later"),
    live: required.total > 0 && required.ready === required.total,
    next,
    blocked,
    failing: items.filter((i) => i.state === "failing").length,
  };
}
