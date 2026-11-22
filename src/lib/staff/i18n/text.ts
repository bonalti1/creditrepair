import type { StaffLocale } from "./locale";

// The console's string tables. Every table has the same keys in English and
// Spanish (the type below makes a missing one a compile error), and every
// table is listed in registry.ts so a test walks them all: a missing or empty
// value, or Spanish left in the English table, fails it.
//
// A value is a string, or a function that builds one (counts, names, dates).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TextValue = string | ((...args: any[]) => string);

export type TextShape = { [key: string]: TextValue | TextShape | readonly string[] };

/** A table: English is the shape; Spanish must have every key, with the same kind of value. */
export type StaffText<T extends TextShape> = Record<StaffLocale, T>;

type Same<T> = { [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : T[K] extends string ? string : Same<T[K]> };

/** Define a table. `es` is checked against `en`: the same keys, the same arguments. */
export function defineText<T extends TextShape>(table: { en: T; es: Same<T> }): StaffText<T> {
  return table as unknown as StaffText<T>;
}
