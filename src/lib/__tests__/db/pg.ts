import { readFileSync } from "node:fs";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

// A test database: the REAL migrations (supabase/setup.sql) in PGlite, an
// in-process Postgres, with stand-ins for what Supabase itself provides, and a
// small adapter that runs the supabase-js query-builder calls this app makes
// as SQL under a chosen role, so row level security, triggers and constraints
// really apply.
//
// What the stand-ins are:
//   - roles anon, authenticated (row level security applies) and the
//     superuser for the service role (bypasses it, like Supabase's
//     service_role, which has BYPASSRLS);
//   - auth.users (id, email, phone, created_at) and auth.uid(), which reads
//     the JWT subject from the setting Supabase uses (request.jwt.claim.sub);
//   - storage.buckets / storage.objects / storage.foldername(), enough for
//     migration 0003; signed URLs are made up;
//   - grants as Supabase gives them: every table in public to anon and
//     authenticated, so the policies alone decide.
//
// What the adapter does NOT emulate (say so wherever a test relies on it):
//   - PostgREST itself: embedded resources ("letters!inner(...)") are refused
//     with an error, and the app code these tests run does not use them;
//     error messages and codes are Postgres's, not PostgREST's (except
//     PGRST116 for single()); filter values are typed by casting to the
//     column's type, which PostgREST does too, but not every operator exists
//     (eq, neq, in, is, gt, gte, lt, lte, or with those, order, limit).
//   - Auth: no cookies, sessions, JWT signing or expiry; "signed in" is the
//     uid the test chooses. Phone OTP and the SMS provider are not exercised.
//   - Storage objects and their policies beyond the table shape.
//   - Supabase's default privileges for functions and sequences, the
//     pg_graphql / realtime schemas, and connection pooling.

type Row = Record<string, unknown>;
type Value = unknown;

interface Column {
  dataType: string;
  udt: string;
}

export interface Harness {
  pg: PGlite;
  /** The service role: row level security does not apply. */
  service: SupabaseClient;
  /** A signed-in person: row level security applies, auth.uid() is `uid`. */
  as(uid: string, user?: { phone?: string | null; email?: string | null }): SupabaseClient;
  /** Signed out (the anon key). */
  anon: SupabaseClient;
  /** Adds someone to auth.users, as Supabase Auth would at their first sign-in. */
  createUser(id: string, user?: { phone?: string | null; email?: string | null }): Promise<void>;
  /** Raw SQL as the service role. */
  sql<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, phone text, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
`;

const GRANTS = `
  grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to anon, authenticated;
`;

/**
 * Starts a fresh database with every migration applied. A few seconds.
 * `before`: stop before that migration file (e.g. "0024_english_default.sql"),
 * to put rows in place and then run it with `pg.exec` (raw SQL only after that:
 * the adapter's column list is read here).
 */
export async function startHarness(options: { before?: string } = {}): Promise<Harness> {
  const pg = new PGlite();
  await pg.exec(BOOTSTRAP);
  const setup = readFileSync("supabase/setup.sql", "utf8");
  const cut = options.before ? setup.indexOf(`-- ===== ${options.before} =====`) : -1;
  if (options.before && cut < 0) throw new Error(`startHarness: no migration ${options.before} in supabase/setup.sql`);
  await pg.exec(cut >= 0 ? setup.slice(0, cut) : setup);
  await pg.exec(GRANTS);

  const columns = new Map<string, Map<string, Column>>();
  const colRows = await pg.query<{ table_name: string; column_name: string; data_type: string; udt_name: string }>(
    `select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public'`,
  );
  for (const c of colRows.rows) {
    const table = columns.get(c.table_name) ?? new Map<string, Column>();
    table.set(c.column_name, { dataType: c.data_type, udt: c.udt_name });
    columns.set(c.table_name, table);
  }
  const pkRows = await pg.query<{ table_name: string; column_name: string }>(
    `select tc.table_name, kcu.column_name from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position`,
  );
  const pkeys = new Map<string, string[]>();
  for (const r of pkRows.rows) pkeys.set(r.table_name, [...(pkeys.get(r.table_name) ?? []), r.column_name]);
  const fnRows = await pg.query<{ proname: string; proargnames: string[] | null; types: string[]; proretset: boolean }>(
    `select p.proname, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types, p.proretset
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
  );
  const functions = new Map(fnRows.rows.map((f) => [f.proname, { names: f.proargnames ?? [], types: f.types, returnsSet: f.proretset }]));

  const schema: Schema = { columns, pkeys, functions };
  const users = new Map<string, { phone?: string | null; email?: string | null }>();
  const make = (session: Session) => client(pg, schema, session);
  return {
    pg,
    service: make({ role: "service", uid: null, user: null }),
    anon: make({ role: "anon", uid: null, user: null }),
    as: (uid, user) => make({ role: "authenticated", uid, user: { ...users.get(uid), ...user } }),
    async createUser(id, user = {}) {
      users.set(id, user);
      await pg.query(`insert into auth.users (id, email, phone) values ($1::uuid, $2, $3)`, [id, user.email ?? null, user.phone?.replace(/^\+/, "") ?? null]);
    },
    async sql<T = Row>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };
}

interface Schema {
  columns: Map<string, Map<string, Column>>;
  pkeys: Map<string, string[]>;
  functions: Map<string, { names: string[]; types: string[]; returnsSet: boolean }>;
}

interface Session {
  role: "service" | "authenticated" | "anon";
  uid: string | null;
  user: { phone?: string | null; email?: string | null } | null;
}

interface PgError {
  message: string;
  code?: string;
}

async function run<T>(pg: PGlite, session: Session, fn: (tx: Transaction | PGlite) => Promise<T>): Promise<T> {
  if (session.role === "service") return fn(pg);
  return pg.transaction(async (tx) => {
    await tx.exec(`set local role ${session.role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [session.uid ?? ""]);
    return fn(tx);
  });
}

function client(pg: PGlite, schema: Schema, session: Session): SupabaseClient {
  const api = {
    from: (table: string) => new Builder(pg, schema, session, table),
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const def = schema.functions.get(fn);
      if (!def) return { data: null, error: { message: `function public.${fn} does not exist`, code: "42883" } };
      const params: unknown[] = [];
      const parts = Object.entries(args).map(([name, value]) => {
        const i = def.names.indexOf(name);
        params.push(value === null || value === undefined ? null : String(value));
        return `${quote(name)} => $${params.length}::${def.types[i] ?? "text"}`;
      });
      try {
        // A function that returns a table (rows) comes back as rows, as PostgREST gives them.
        if (def.returnsSet) {
          const rows = await run(pg, session, (db) => db.query<Row>(`select * from public.${quote(fn)}(${parts.join(", ")})`, params));
          return { data: rows.rows.map((r) => shape(r, undefined)), error: null };
        }
        const result = await run(pg, session, (db) => db.query<{ result: unknown }>(`select public.${quote(fn)}(${parts.join(", ")}) as result`, params));
        return { data: result.rows[0]?.result ?? null, error: null };
      } catch (e) {
        return { data: null, error: pgError(e) };
      }
    },
    auth: {
      async getUser() {
        return {
          data: { user: session.uid ? { id: session.uid, phone: session.user?.phone?.replace(/^\+/, "") ?? undefined, email: session.user?.email ?? undefined } : null },
          error: null,
        };
      },
    },
    storage: {
      from: (bucket: string) => ({
        async createSignedUrl(path: string) {
          return { data: { signedUrl: `https://storage.test/${bucket}/${path}?token=test` }, error: null };
        },
      }),
      async getBucket(id: string) {
        const rows = await pg.query<Row>(`select id, name, public from storage.buckets where id = $1`, [id]);
        return { data: rows.rows[0] ?? null, error: null };
      },
    },
  };
  return api as unknown as SupabaseClient;
}

const quote = (identifier: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`adapter: unexpected identifier ${JSON.stringify(identifier)}`);
  return `"${identifier}"`;
};

function pgError(e: unknown): PgError {
  const err = e as { message?: string; code?: string };
  return { message: err.message ?? String(e), ...(err.code ? { code: err.code } : {}) };
}

type Filter = { sql: (p: Params) => string };

class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** A value as text, for a parameter cast to its column's type. */
function asText(value: Value, column: Column | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (column && (column.dataType === "ARRAY" || column.udt === "jsonb" || column.udt === "json")) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function castTo(placeholder: string, column: Column | undefined): string {
  if (!column) return placeholder;
  if (column.dataType === "ARRAY") return `array(select jsonb_array_elements_text(${placeholder}::jsonb))::${column.udt.slice(1)}[]`;
  if (column.udt === "jsonb" || column.udt === "json") return `${placeholder}::jsonb`;
  return `${placeholder}::${column.udt}`;
}

/** A row as supabase-js gives it: timestamps as ISO strings, dates as YYYY-MM-DD. */
function shape(row: Row, table: Map<string, Column> | undefined): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const column = table?.get(key);
    if (value instanceof Date) out[key] = column?.udt === "date" ? value.toISOString().slice(0, 10) : value.toISOString();
    else if (typeof value === "bigint") out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

class Builder implements PromiseLike<{ data: unknown; error: PgError | null; count?: number | null }> {
  private kind: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columnsSql = "*";
  private returning: string | null = null;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private values: Row[] = [];
  private onConflict: string[] | null = null;
  private ignoreDuplicates = false;
  private head = false;
  private counting = false;

  constructor(
    private pg: PGlite,
    private schema: Schema,
    private session: Session,
    private table: string,
  ) {
    quote(table);
  }

  private column(name: string): Column | undefined {
    return this.schema.columns.get(this.table)?.get(name);
  }

  private columnList(columns: string): string {
    const trimmed = columns.trim();
    if (trimmed === "*" || trimmed === "") return "*";
    if (trimmed.includes("(")) throw new Error(`adapter: embedded resources are not emulated (${trimmed})`);
    return trimmed
      .split(",")
      .map((c) => quote(c.trim()))
      .join(", ");
  }

  select(columns = "*", options: { head?: boolean; count?: string } = {}): this {
    if (this.kind === "select") {
      this.columnsSql = this.columnList(columns);
      this.head = Boolean(options.head);
      this.counting = Boolean(options.count);
    } else {
      this.returning = this.columnList(columns);
    }
    return this;
  }
  insert(values: Row | Row[]): this {
    this.kind = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.kind = "upsert";
    this.values = Array.isArray(values) ? values : [values];
    this.onConflict = options.onConflict ? options.onConflict.split(",").map((c) => c.trim()) : (this.schema.pkeys.get(this.table) ?? null);
    this.ignoreDuplicates = Boolean(options.ignoreDuplicates);
    return this;
  }
  update(values: Row): this {
    this.kind = "update";
    this.values = [values];
    return this;
  }
  delete(): this {
    this.kind = "delete";
    return this;
  }

  private compare(column: string, op: string, value: Value): this {
    const col = this.column(column);
    this.filters.push({ sql: (p) => `${quote(column)} ${op} ${castTo(p.add(asText(value, col && col.dataType === "ARRAY" ? undefined : col)), col)}` });
    return this;
  }
  eq(column: string, value: Value) {
    return this.compare(column, "=", value);
  }
  neq(column: string, value: Value) {
    return this.compare(column, "<>", value);
  }
  gt(column: string, value: Value) {
    return this.compare(column, ">", value);
  }
  gte(column: string, value: Value) {
    return this.compare(column, ">=", value);
  }
  lt(column: string, value: Value) {
    return this.compare(column, "<", value);
  }
  lte(column: string, value: Value) {
    return this.compare(column, "<=", value);
  }
  in(column: string, values: readonly Value[]): this {
    const col = this.column(column);
    const type = col?.udt ?? "text";
    this.filters.push({ sql: (p) => `${quote(column)} = any(array(select jsonb_array_elements_text(${p.add(JSON.stringify(values.map((v) => (v == null ? null : String(v)))))}::jsonb))::${type}[])` });
    return this;
  }
  is(column: string, value: null | boolean): this {
    const word = value === null ? "null" : value ? "true" : "false";
    this.filters.push({ sql: () => `${quote(column)} is ${word}` });
    return this;
  }
  /** "email.eq.a@b.c,phone_e164.eq.+1555": the operators above, joined with OR. */
  or(expression: string): this {
    const parts = expression.split(",").map((part) => {
      const [column, op, ...rest] = part.split(".");
      return { column: column!, op: op!, value: rest.join(".") };
    });
    const ops: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    this.filters.push({
      sql: (p) =>
        `(${parts
          .map(({ column, op, value }) => {
            if (op === "is") return `${quote(column)} is ${value === "null" ? "null" : value === "true" ? "true" : "false"}`;
            const sqlOp = ops[op];
            if (!sqlOp) throw new Error(`adapter: operator ${op} in or() is not emulated`);
            return `${quote(column)} ${sqlOp} ${castTo(p.add(value), this.column(column))}`;
          })
          .join(" or ")})`,
    });
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orders.push(`${quote(column)} ${options.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.mode = "single";
    return this;
  }
  maybeSingle(): this {
    this.mode = "maybe";
    return this;
  }

  private where(p: Params): string {
    return this.filters.length > 0 ? ` where ${this.filters.map((f) => f.sql(p)).join(" and ")}` : "";
  }

  private build(): { text: string; params: unknown[] } {
    const p = new Params();
    const t = `public.${quote(this.table)}`;
    if (this.kind === "select") {
      const where = this.where(p);
      if (this.head) return { text: `select count(*)::int as count from ${t}${where}`, params: p.values };
      const order = this.orders.length > 0 ? ` order by ${this.orders.join(", ")}` : "";
      const limit = this.limitN !== null ? ` limit ${Number(this.limitN)}` : "";
      return { text: `select ${this.columnsSql} from ${t}${where}${order}${limit}`, params: p.values };
    }
    if (this.kind === "insert" || this.kind === "upsert") {
      const keys = [...new Set(this.values.flatMap((v) => Object.keys(v)))];
      const rowsSql = this.values
        .map((v) => `(${keys.map((k) => (k in v ? castTo(p.add(asText(v[k], this.column(k))), this.column(k)) : "default")).join(", ")})`)
        .join(", ");
      let text = `insert into ${t} (${keys.map(quote).join(", ")}) values ${rowsSql}`;
      if (this.kind === "upsert" && this.onConflict) {
        const updates = keys.filter((k) => !this.onConflict!.includes(k));
        text +=
          this.ignoreDuplicates || updates.length === 0
            ? ` on conflict (${this.onConflict.map(quote).join(", ")}) do nothing`
            : ` on conflict (${this.onConflict.map(quote).join(", ")}) do update set ${updates.map((k) => `${quote(k)} = excluded.${quote(k)}`).join(", ")}`;
      }
      if (this.returning) text += ` returning ${this.returning}`;
      return { text, params: p.values };
    }
    if (this.kind === "update") {
      const v = this.values[0]!;
      const sets = Object.keys(v).map((k) => `${quote(k)} = ${castTo(p.add(asText(v[k], this.column(k))), this.column(k))}`);
      let text = `update ${t} set ${sets.join(", ")}${this.where(p)}`;
      if (this.returning) text += ` returning ${this.returning}`;
      return { text, params: p.values };
    }
    let text = `delete from ${t}${this.where(p)}`;
    if (this.returning) text += ` returning ${this.returning}`;
    return { text, params: p.values };
  }

  private async execute(): Promise<{ data: unknown; error: PgError | null; count?: number | null }> {
    let built;
    try {
      built = this.build();
    } catch (e) {
      return { data: null, error: pgError(e) };
    }
    let rows: Row[];
    try {
      const result = await run(this.pg, this.session, (db) => db.query<Row>(built.text, built.params));
      rows = result.rows.map((r) => shape(r, this.schema.columns.get(this.table)));
    } catch (e) {
      return { data: null, error: pgError(e) };
    }
    if (this.kind === "select" && this.head) return { data: null, error: null, count: Number(rows[0]?.count ?? 0) };
    if (this.kind !== "select" && !this.returning) return { data: null, error: null };
    if (this.mode === "single") {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    if (this.mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "JSON object requested, multiple rows returned", code: "PGRST116" } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null, count: this.counting ? rows.length : null };
  }

  then<A = { data: unknown; error: PgError | null }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: PgError | null; count?: number | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
