import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpot, HOOK_DEFAULTS, loadLock, loadSpot, SIZES, timelineSeconds, type Lock, type Spot } from "./spot";

// npm run content:assemble <spot-id> -- --clips <folder> --out <file.mp4>
//
// Turns the generated clips into the finished ad: trims and joins the shots,
// burns in the captions, adds the end card with a soft chime, and normalises
// loudness. Captions and the end card are drawn with the brand font in a
// headless browser, so they match the product exactly.
//
// Needs ffmpeg on the PATH and Playwright (`npm i -D playwright`, or a global install).

const GAUGE = ["#fde539", "#fdcb1f", "#fdb203", "#fb9d07", "#f9890b"];

function gaugeSvg(height: number): string {
  const pt = (r: number, deg: number) =>
    `${(32 + r * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(34 - r * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`;
  const span = (180 - 3 * 4) / 5;
  const paths = GAUGE.map((fill, i) => {
    const a0 = 180 - i * (span + 3);
    const a1 = a0 - span;
    return `<path d="M${pt(30, a0)}A30 30 0 0 1 ${pt(30, a1)}L${pt(18.5, a1)}A18.5 18.5 0 0 0 ${pt(18.5, a0)}Z" fill="${fill}"/>`;
  }).join("");
  return `<svg height="${height}" width="${height * 1.6}" viewBox="0 0 64 40">${paths}<path d="M32 34 51 10" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/><circle cx="32" cy="34" r="5" fill="#fff"/></svg>`;
}

const FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,800;0,900;1,900&family=Inter:wght@500&display=swap">';

function captionHtml(html: string, spot: Spot, lock: Lock): string {
  const [w, h] = SIZES[spot.format];
  const c = lock.captions;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0;width:${w}px;height:${h}px;background:transparent;overflow:hidden}
.c{position:absolute;left:70px;right:70px;top:${c.centerY[spot.format]}px;transform:translateY(-50%);text-align:center;
font-family:Nunito,sans-serif;font-weight:900;font-size:${c.sizePx}px;line-height:1.08;letter-spacing:-0.5px;color:${c.color};
-webkit-text-stroke:${c.stroke};paint-order:stroke fill;text-shadow:0 6px 18px rgba(6,23,59,.55)}
.c b{color:${c.highlight};font-weight:900}</style></head><body><div class="c">${html}</div></body></html>`;
}

function hookHtml(html: string, spot: Spot, lock: Lock): string {
  const [w, h] = SIZES[spot.format];
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0;width:${w}px;height:${h}px;background:transparent;overflow:hidden}
.h{position:absolute;left:80px;right:80px;top:${lock.hook.centerY[spot.format]}px;transform:translateY(-50%);text-align:center;
font-family:Nunito,sans-serif;font-weight:900;font-size:${lock.hook.sizePx}px;line-height:1.1;letter-spacing:-1px;color:#fff;
-webkit-text-stroke:16px #06173b;paint-order:stroke fill;text-shadow:0 8px 22px rgba(6,23,59,.6)}
.h b{color:${lock.captions.highlight};font-weight:900}</style></head><body><div class="h">${html}</div></body></html>`;
}

function endCardHtml(spot: Spot, lock: Lock): string {
  const [w, h] = SIZES[spot.format];
  const vertical = spot.format === "9:16";
  const logo = vertical
    ? `<div class="mark">${gaugeSvg(210)}</div><div class="word">Credit<span class="capi">Capi</span></div>`
    : `<div class="row">${gaugeSvg(190)}<div class="word">Credit<span class="capi">Capi</span></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{background:linear-gradient(180deg,#0a2152,#06173b);font-family:Nunito,sans-serif;color:#fff;position:relative}
.stack{position:absolute;left:0;right:0;top:${vertical ? 500 : 250}px;display:flex;flex-direction:column;align-items:center;text-align:center}
.row{display:flex;align-items:center;gap:36px}
.word{margin-top:${vertical ? 26 : 0}px;font-weight:900;font-style:italic;font-size:${vertical ? 164 : 176}px;letter-spacing:-3px;line-height:1}
.capi{background:linear-gradient(90deg,#ffc21a,#f9890b);-webkit-background-clip:text;color:transparent;padding-right:14px}
.tag{margin-top:${vertical ? 64 : 44}px;font-weight:800;font-size:${vertical ? 78 : 64}px;line-height:1.12;letter-spacing:-0.5px}
.tag b{color:#ffc21a;font-weight:800;${vertical ? "display:block" : ""}}
.legal{margin-top:${vertical ? 72 : 60}px;max-width:${vertical ? 820 : 1500}px;font-family:Inter,sans-serif;font-weight:500;font-size:${vertical ? 31 : 27}px;line-height:1.42;color:#c8d3f2}
svg.swoosh{position:absolute;left:0;right:0;bottom:0;width:100%;height:${vertical ? 150 : 120}px}
</style></head><body><div class="stack">${logo}
<div class="tag">${lock.endCard.tagline}</div><div class="legal">${lock.endCard.legal}</div></div>
<svg class="swoosh" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d="M0 62C380 132 1060 -8 1440 54V120H0Z" fill="#ffc21a"/></svg>
</body></html>`;
}

async function renderOverlays(
  spot: Spot,
  lock: Lock,
  dir: string,
): Promise<{ captions: string[]; endCard: string; hook: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = createRequire(import.meta.url)("playwright") as any;
  const [width, height] = SIZES[spot.format];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const shoot = async (html: string, path: string, transparent: boolean) => {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate("document.fonts.ready");
    await page.waitForTimeout(150);
    await page.screenshot({ path, omitBackground: transparent });
  };
  const captions: string[] = [];
  for (const [i, caption] of spot.captions.entries()) {
    const path = join(dir, `caption-${i}.png`);
    await shoot(captionHtml(caption.html, spot, lock), path, true);
    captions.push(path);
  }
  const endCard = join(dir, "endcard.png");
  await shoot(endCardHtml(spot, lock), endCard, false);
  let hook: string | null = null;
  if (spot.hook) {
    hook = join(dir, "hook.png");
    await shoot(hookHtml(spot.hook.html, spot, lock), hook, true);
  }
  await browser.close();
  return { captions, endCard, hook };
}

export interface AssembleOptions {
  clips: string;
  out: string;
  /** x264 quality: 18 is near-lossless for a master, 23 is a good upload size. */
  crf?: number;
}

/** Build the finished video for a spot. Throws if the spot fails the check or a clip is missing. */
export async function assembleSpot(spot: Spot, lock: Lock, options: AssembleOptions): Promise<string> {
  const { clips } = options;
  const problems = checkSpot(spot, lock);
  if (problems.length > 0) {
    throw new Error(
      `Spot "${spot.id}" fails the check; nothing was assembled:\n` +
        problems.map((p) => `  ${p.where}: ${p.problem}`).join("\n"),
    );
  }
  for (const shot of spot.shots) {
    if (!existsSync(join(clips, shot.file))) throw new Error(`Missing clip for shot "${shot.id}": ${join(clips, shot.file)}`);
  }

  const out = resolve(options.out);
  mkdirSync(resolve(out, ".."), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "capi-spot-"));
  const overlays = await renderOverlays(spot, lock, work);

  const [w, h] = SIZES[spot.format];
  const end = lock.endCard.seconds;
  const total = timelineSeconds(spot, lock);
  const inputs: string[] = [];
  const filters: string[] = [];

  spot.shots.forEach((shot, i) => {
    inputs.push("-i", join(clips, shot.file));
    const length = shot.out - shot.in;
    const fadeIn = i === 0 ? ",fade=t=in:st=0:d=0.2" : "";
    filters.push(
      `[${i}:v]trim=${shot.in}:${shot.out},setpts=PTS-STARTPTS,scale=${w}:${h},fps=24,format=yuv420p${fadeIn}[v${i}]`,
      `[${i}:a]atrim=${shot.in}:${shot.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,` +
        `afade=t=in:st=0:d=0.08,afade=t=out:st=${(length - 0.25).toFixed(2)}:d=0.25[a${i}]`,
    );
  });

  const n = spot.shots.length;
  inputs.push("-loop", "1", "-t", String(end), "-i", overlays.endCard);
  filters.push(`[${n}:v]scale=${w}:${h},fps=24,format=yuv420p,fade=t=in:st=0:d=0.3[v${n}]`);
  // Two soft notes under the end card so the ad does not end in silence.
  inputs.push(
    "-f", "lavfi", "-t", String(end), "-i",
    "aevalsrc='0.10*sin(2*PI*784*t)*exp(-5*t)+0.10*sin(2*PI*1046.5*(t-0.16))*exp(-4*(t-0.16))*gt(t,0.16)':s=48000:c=stereo",
  );
  filters.push(`[${n + 1}:a]adelay=150|150,apad=whole_dur=${end},atrim=0:${end}[a${n}]`);

  const pairs = Array.from({ length: n + 1 }, (_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${pairs}concat=n=${n + 1}:v=1:a=1[vc][ac]`);

  // Text overlays: captions, then the hook. Each is one more input.
  const overlaysToDraw = spot.captions.map((caption, i) => ({ path: overlays.captions[i]!, from: caption.from, to: caption.to }));
  if (spot.hook && overlays.hook) {
    overlaysToDraw.push({
      path: overlays.hook,
      from: spot.hook.from ?? HOOK_DEFAULTS.from,
      to: spot.hook.to ?? HOOK_DEFAULTS.to,
    });
  }
  let last = "vc";
  overlaysToDraw.forEach((overlay, i) => {
    inputs.push("-i", overlay.path);
    filters.push(`[${last}][${n + 2 + i}:v]overlay=enable='between(t,${overlay.from},${overlay.to})'[o${i}]`);
    last = `o${i}`;
  });
  filters.push("[ac]loudnorm=I=-16:TP=-1.5:LRA=11[an]");

  execFileSync(
    "ffmpeg",
    [
      "-loglevel", "error", "-y", ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", `[${last}]`, "-map", "[an]",
      "-t", total.toFixed(2),
      "-c:v", "libx264", "-preset", "slow", "-crf", String(options.crf ?? 18), "-pix_fmt", "yuv420p", "-r", "24",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out,
    ],
    { stdio: "inherit" },
  );
  return out;
}

export function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main() {
  const id = process.argv[2];
  const clips = arg("clips");
  if (!id || id.startsWith("--") || !clips) {
    console.error("Usage: npm run content:assemble <spot-id> -- --clips <folder> [--out <file.mp4>] [--crf 18]");
    process.exit(2);
  }
  const lock = loadLock();
  const spot = loadSpot(id);
  const out = await assembleSpot(spot, lock, {
    clips,
    out: arg("out") ?? `${spot.id}-${spot.format.replace(":", "x")}.mp4`,
    crf: arg("crf") ? Number(arg("crf")) : undefined,
  });
  console.log(`${out}  (${timelineSeconds(spot, lock).toFixed(1)}s)`);
}

// Run only when called directly, not when imported by variants.ts.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
