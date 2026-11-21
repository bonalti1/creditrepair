// Rebuilds supabase/setup.sql from supabase/migrations: every migration, in
// order, for pasting into the Supabase SQL editor in one go. A test
// (src/lib/__tests__/launch.test.ts) fails when the two drift apart.
//
//   npm run db:setup-sql
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "supabase/migrations";
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => `-- ===== ${f} =====\n${readFileSync(`${dir}/${f}`, "utf8").trim()}\n`)
  .join("\n");
writeFileSync("supabase/setup.sql", sql);
console.log(`supabase/setup.sql: ${sql.split("\n").length} lines`);
