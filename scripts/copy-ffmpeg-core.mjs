// Copies ffmpeg.wasm's core (@ffmpeg/core, single-threaded ESM build) from
// node_modules into public/vendor/ffmpeg/<version>/, so the Video Studio's
// export engine is served by this site (never a third-party CDN) and only
// downloaded when the editor needs it. Runs before `next dev` and
// `next build` (package.json). The copied files are not committed (.gitignore).
//
// The core is FFmpeg built with libx264 (GPL): see docs/VIDEO.md, "License".
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const source = "node_modules/@ffmpeg/core";
if (!existsSync(join(source, "package.json"))) {
  console.warn("copy-ffmpeg-core: @ffmpeg/core is not installed; the Video Studio's export will say it cannot load.");
  process.exit(0);
}
const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const target = join("public/vendor/ffmpeg", version);
mkdirSync(target, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  const from = join(source, "dist/esm", file);
  const to = join(target, file);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
}
console.log(`copy-ffmpeg-core: ${target}`);
