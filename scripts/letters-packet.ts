import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildLetterPacket, PACKET_PATH, packetEntries } from "../src/lib/letters/packet";

// npm run letters:packet   (or: npx tsx scripts/letters-packet.ts)
//
// Writes the attorney review packet to docs/LETTER-LIBRARY.md: a cover note,
// then every letter template with its metadata and the letter rendered for one
// fictional consumer. The output is deterministic, and a test asserts that the
// committed file equals it, so run this whenever a template or the catalogue
// changes and commit the result.

const target = resolve(process.cwd(), PACKET_PATH);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buildLetterPacket(), "utf8");
console.log(`Wrote ${PACKET_PATH}: ${packetEntries().length} letters.`);
