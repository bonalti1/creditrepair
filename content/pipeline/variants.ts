import { join, resolve } from "node:path";
import { arg, assembleSpot } from "./assemble";
import { checkSpot, hookVariants, loadHooks, loadLock, loadSpot } from "./spot";

// npm run content:variants <spot-id> -- --clips <folder> --out <folder> [--crf 23]
//
// One finished video per opening hook in content/hooks/<spot-id>.json, all cut
// from the same clips. No generation, so no credits: this is how a batch of ads
// for testing is made from one shoot.
async function main() {
  const id = process.argv[2];
  const clips = arg("clips");
  if (!id || id.startsWith("--") || !clips) {
    console.error("Usage: npm run content:variants <spot-id> -- --clips <folder> [--out <folder>] [--crf 23]");
    process.exit(2);
  }
  const lock = loadLock();
  const base = loadSpot(id);
  const variants = hookVariants(base, loadHooks(id));
  if (variants.length === 0) {
    console.error(`No hooks found: content/hooks/${id}.json`);
    process.exit(1);
  }

  // Check them all first, so a bad hook stops the batch before any rendering.
  const failures = variants.flatMap((v) => checkSpot(v, lock).map((p) => `${v.id}: ${p.where}: ${p.problem}`));
  if (failures.length > 0) {
    console.error("Nothing was assembled. Fix these first:\n  " + failures.join("\n  "));
    process.exit(1);
  }

  const outDir = resolve(arg("out") ?? "out");
  const crf = arg("crf") ? Number(arg("crf")) : 23;
  for (const variant of variants) {
    const out = await assembleSpot(variant, lock, { clips, out: join(outDir, `${variant.id}.mp4`), crf });
    console.log(out);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
