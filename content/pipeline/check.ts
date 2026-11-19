import { checkSpot, estimateCredits, listSpots, loadLock, loadSpot, timelineSeconds } from "./spot";

// npm run content:check            → every spot
// npm run content:check mecanico   → one spot
const lock = loadLock();
const spots = process.argv[2] ? [loadSpot(process.argv[2])] : listSpots();
let failed = false;

for (const spot of spots) {
  const problems = checkSpot(spot, lock);
  const summary = `${spot.id}: ${timelineSeconds(spot, lock).toFixed(1)}s, about ${estimateCredits(spot, lock).toFixed(0)} credits for one clean pass`;
  if (problems.length === 0) {
    console.log(`OK    ${summary}`);
  } else {
    failed = true;
    console.log(`FAIL  ${summary}`);
    for (const p of problems) console.log(`      ${p.where}: ${p.problem}`);
  }
}
process.exit(failed ? 1 : 0);
