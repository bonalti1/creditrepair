import { checkSpot, estimateCredits, hookVariants, listSpots, loadHooks, loadLock, loadSpot, timelineSeconds } from "./spot";

// npm run content:check            → every spot
// npm run content:check mecanico   → one spot
const lock = loadLock();
const base = process.argv[2] ? [loadSpot(process.argv[2])] : listSpots();
// Each spot, plus one variant per opening hook (hooks cost nothing to cut).
const spots = base.flatMap((spot) => [spot, ...hookVariants(spot, loadHooks(spot.id))]);
let failed = false;

for (const spot of spots) {
  const problems = checkSpot(spot, lock);
  const summary = spot.hook
    ? `${spot.id}: hook "${spot.hook.html.replace(/<[^>]+>/g, "")}" (no credits)`
    : `${spot.id}: ${timelineSeconds(spot, lock).toFixed(1)}s, about ${estimateCredits(spot, lock).toFixed(0)} credits for one clean pass`;
  if (problems.length === 0) {
    console.log(`OK    ${summary}`);
  } else {
    failed = true;
    console.log(`FAIL  ${summary}`);
    for (const p of problems) console.log(`      ${p.where}: ${p.problem}`);
  }
}
process.exit(failed ? 1 : 0);
