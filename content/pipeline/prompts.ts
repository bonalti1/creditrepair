import { buildPrompts, checkSpot, loadLock, loadSpot } from "./spot";

// npm run content:prompts mecanico
// Prints the generation requests for a spot (one still + one clip per shot),
// with the locked character and look written in. Refuses a spot that fails the
// claim check, so nothing is generated from a script that could not ship.
const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run content:prompts <spot-id>");
  process.exit(2);
}
const lock = loadLock();
const spot = loadSpot(id);
const problems = checkSpot(spot, lock);
if (problems.length > 0) {
  console.error(`Spot "${spot.id}" fails the check; fix it before generating:`);
  for (const p of problems) console.error(`  ${p.where}: ${p.problem}`);
  process.exit(1);
}
console.log(JSON.stringify(buildPrompts(spot, lock), null, 2));
