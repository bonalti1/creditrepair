import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queueStatus } from "../../autopilot/store";
import { startHarness } from "./pg";
import { addClient } from "./seed";

// Migration 0024 on the real migrations: English first. New rows default to
// English; rows that existed before keep the language they had (Spanish);
// the client writes their own language through their own connection, and
// automatic messages follow it.

const MIGRATION = "0024_english_default.sql";

const partner = (phone: string) => ({
  name: "Laura Benítez",
  kind: "realtor",
  phone_e164: phone,
  terms_version: "2026-11-socios-v1",
  terms_accepted_at: new Date().toISOString(),
});

describe("migration 0024: English by default, for new rows only", () => {
  it("changes defaults only: no UPDATE of profiles anywhere in it", () => {
    const sql = readFileSync(`supabase/migrations/${MIGRATION}`, "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\bupdate\s+public\.profiles\b/i);
    expect(sql).toMatch(/alter table public\.profiles alter column locale set default 'en'/);
  });

  it("a profile and a partner from before keep Spanish; new ones start in English", async () => {
    const h = await startHarness({ before: MIGRATION });
    const before = await addClient(h, { name: "Rosa Martínez" });
    const [oldPartner] = await h.sql<{ id: string }>(
      `insert into public.partners (name, kind, phone_e164, terms_version, terms_accepted_at) values ($1, $2, $3, $4, $5) returning id`,
      Object.values(partner("+17135550171")),
    );
    expect((await h.sql<{ locale: string }>(`select locale from public.profiles where id = $1`, [before]))[0]!.locale).toBe("es");

    await h.pg.exec(readFileSync(`supabase/migrations/${MIGRATION}`, "utf8"));

    // Nothing that existed was rewritten.
    expect((await h.sql<{ locale: string }>(`select locale from public.profiles where id = $1`, [before]))[0]!.locale).toBe("es");
    expect((await h.sql<{ locale: string }>(`select locale from public.partners where id = $1`, [oldPartner!.id]))[0]!.locale).toBe("es");

    // New rows: English.
    const after = await addClient(h, { name: "Luis Gómez" });
    expect((await h.sql<{ locale: string }>(`select locale from public.profiles where id = $1`, [after]))[0]!.locale).toBe("en");
    const [newPartner] = await h.sql<{ locale: string }>(
      `insert into public.partners (name, kind, phone_e164, terms_version, terms_accepted_at) values ($1, $2, $3, $4, $5) returning locale`,
      Object.values(partner("+17135550172")),
    );
    expect(newPartner!.locale).toBe("en");
    const [wait] = await h.sql<{ locale: string }>(`insert into public.waitlist (email, state) values ('a@b.co', 'CA') returning locale`);
    expect(wait!.locale).toBe("en");
    const defaults = await h.sql<{ table_name: string; column_default: string }>(
      `select table_name, column_default from information_schema.columns
        where table_schema = 'public' and column_name = 'locale' and table_name in ('profiles', 'outbound_messages', 'client_pulses', 'waitlist', 'partners')`,
    );
    expect(defaults).toHaveLength(5);
    for (const d of defaults) expect(d.column_default, d.table_name).toMatch(/^'en'/);
  }, 60_000);
});

describe("the client's language on the database", () => {
  it("the client saves their own language (and nobody else's); only es or en", async () => {
    const h = await startHarness();
    const A = await addClient(h, { name: "Rosa Martínez" });
    const B = await addClient(h, { name: "Luis Gómez" });
    // What the language button does, signed in (src/lib/i18n/index.tsx).
    expect((await h.as(A).from("profiles").update({ locale: "es" }).eq("id", A)).error).toBeNull();
    expect((await h.sql<{ locale: string }>(`select locale from public.profiles where id = $1`, [A]))[0]!.locale).toBe("es");
    // Row level security: B's row is not A's to change.
    await h.as(A).from("profiles").update({ locale: "es" }).eq("id", B);
    expect((await h.sql<{ locale: string }>(`select locale from public.profiles where id = $1`, [B]))[0]!.locale).toBe("en");
    await expect(h.sql(`update public.profiles set locale = 'fr' where id = $1`, [A])).rejects.toThrow(/check/i);

    // Automatic messages follow it: Spanish for A, English (the default) for B.
    const event = { kind: "letters_mailed", roundNumber: 1, letterCount: 2 } as const;
    expect(await queueStatus(h.service, A, event)).toBe("queued");
    expect(await queueStatus(h.service, B, event)).toBe("queued");
    const rows = await h.sql<{ user_id: string; locale: string; body: string }>(`select user_id, locale, body from public.outbound_messages`);
    const of = (id: string) => rows.find((r) => r.user_id === id)!;
    expect(of(A)).toMatchObject({ locale: "es" });
    expect(of(A).body).toMatch(/^Hola Rosa/);
    expect(of(B)).toMatchObject({ locale: "en" });
    expect(of(B).body).toMatch(/^Hi Luis/);
  }, 60_000);
});
