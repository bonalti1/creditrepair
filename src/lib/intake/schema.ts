// Small helpers to write the JSON schemas the model must answer in
// (structured outputs). Every object is closed and lists every property as
// required: optional facts are `null`, never missing. That is what the API's
// strict mode expects, and it makes the answer easy to check.

export type JsonSchema = Record<string, unknown>;

export const S = {
  str: (description?: string): JsonSchema => ({ type: "string", ...(description ? { description } : {}) }),
  int: (description?: string): JsonSchema => ({ type: "integer", ...(description ? { description } : {}) }),
  num: (description?: string): JsonSchema => ({ type: "number", ...(description ? { description } : {}) }),
  bool: (description?: string): JsonSchema => ({ type: "boolean", ...(description ? { description } : {}) }),
  enum: (values: readonly string[], description?: string): JsonSchema => ({ type: "string", enum: [...values], ...(description ? { description } : {}) }),
  nullable: (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: "null" }] }),
  arr: (items: JsonSchema, description?: string): JsonSchema => ({ type: "array", items, ...(description ? { description } : {}) }),
  obj: (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(description ? { description } : {}),
  }),
};

export const BUREAU_VALUES = ["equifax", "experian", "transunion"] as const;
export const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

/** Where in the document a fact was read: the page and a short exact quote. */
export const CITATION_SCHEMA = S.obj(
  {
    page: S.int("1-based page number of the document where this was read. For a saved web page or text, use 1."),
    quote: S.str("A short exact quote (at most ~150 characters) copied from the document that shows this fact. Never include a Social Security number or a date of birth."),
  },
  "Where this was read, so a person can check it.",
);

/** Every object in a schema is closed and requires all its properties. Used by the tests. */
export function schemaProblems(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const problems: string[] = [];
  if (node.type === "object") {
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const required = new Set((node.required as string[] | undefined) ?? []);
    for (const key of Object.keys(properties)) if (!required.has(key)) problems.push(`${path}.${key}: not required`);
    for (const [key, value] of Object.entries(properties)) problems.push(...schemaProblems(value, `${path}.${key}`));
  }
  if (node.items) problems.push(...schemaProblems(node.items, `${path}[]`));
  if (Array.isArray(node.anyOf)) node.anyOf.forEach((option, i) => problems.push(...schemaProblems(option, `${path}|${i}`)));
  // Keywords the API's structured outputs do not take.
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "pattern", "minItems", "maxItems"]) {
    if (key in node) problems.push(`${path}: ${key} is not supported`);
  }
  return problems;
}
