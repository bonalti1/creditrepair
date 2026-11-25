import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiByline } from "../brand";
import { can, CAPABILITIES, type Capability } from "../staff/permissions";
import { MORE_NAV, NAV_GROUPS, groupOfPath } from "../staff/nav";
import { altiJobs } from "../staff/altiHelp";
import { helpForPath } from "../staff/playbook";
import { currentBadges, publishBadges, resetBadges } from "../staff/navBadges";
import { checkVideoDraft, draftVideoPlan, templateVideoDraft, type VideoAssistOutput } from "../video/assist";
import { briefLink, formatFrom, parseBriefParam } from "../video/brief";
import { asContentPiece, blockingVideoIssues, checkVideo, videoApprovalBlockers, videoChecklist } from "../video/check";
import { buildDemoVideos, SAMPLE_MEDIA, SAMPLE_TRACK } from "../video/demo";
import { FFMPEG_CORE_VERSION } from "../video/ffmpegClient";
import { checkStudioFile, looksLikeMp4, sniffStudioFile } from "../video/files";
import { approvalHolds, currentExport, projectHash } from "../video/hash";
import { VIDEO_TEXT } from "../video/labels";
import { buildRenderPlan, buildSpeechArgs, layerSpecs, layersAt, probeFromLog, progressFromLog, type RenderMedia } from "../video/render";
import { applyVideoAction, canMoveVideo, mediaRefAllowed, VIDEO_ACTION_CAPABILITY, videoNeeds, type VideoAction } from "../video/rules";
import { videoBodySchema, videoFilesBodySchema } from "../video/schemas";
import {
  addClip,
  bodyDuration,
  cleanEdit,
  clipFromMedia,
  cueAt,
  cuesToSrt,
  exportSettings,
  fitRect,
  formatTime,
  frameSize,
  momentAt,
  moveClip,
  newEdit,
  normalizeCues,
  parseCaptions,
  parseTime,
  placeClips,
  removeClip,
  safeRect,
  safeZone,
  shiftCues,
  soundSpans,
  splitAt,
  srtTime,
  tooFastToRead,
  totalDuration,
  trimClip,
} from "../video/timeline";
import { cuesFromSegments, transcribe, transcribeStatus } from "../video/transcribe";
import type { MediaItem, MusicTrack, VideoEdit, VideoExport, VideoProject } from "../video/types";

// The Video Studio (docs/VIDEO.md): the project model (timeline math, trims,
// splits, captions, export settings and the exact ffmpeg arguments), the
// check before approval, the board's moves and who may make them, briefs
// from the Ads Manager, Alti's draft (mocked model), the automatic captions
// adapter (mocked provider), files, and the menu. When ffmpeg is installed on
// the machine running the tests, the export recipe is also rendered for real.

const NOW = new Date("2026-12-07T15:00:00.000Z");
const VIDEO: MediaItem = { ...SAMPLE_MEDIA[0]! };
const IMAGE: MediaItem = { ...SAMPLE_MEDIA[3]! };
const WIDE: MediaItem = { ...SAMPLE_MEDIA[2]! };

const clip = (media: MediaItem, id: string, inPoint: number, out: number) => ({ ...clipFromMedia(media, id), in: inPoint, out });

function edit(patch: Partial<VideoEdit> = {}): VideoEdit {
  return { ...newEdit("9:16"), clips: [clip(VIDEO, "cl_a00001", 0.5, 3.5), clip(IMAGE, "cl_b00002", 0, 2), clip(WIDE, "cl_c00003", 1, 3)], ...patch };
}

function project(patch: Partial<VideoProject> = {}): VideoProject {
  const base = buildDemoVideos(NOW).projects.find((p) => p.id === "vp_demoeditrights")!;
  return { ...base, edit: { ...base.edit, music: { ...base.edit.music, trackId: null } }, ...patch };
}

const exportOf = (p: VideoProject, id = "ex_test000001"): VideoExport => ({ id, at: NOW.toISOString(), by: "marta", hash: projectHash(p), width: 1080, height: 1920, duration: totalDuration(p.edit), bytes: 1000, ref: `idb:${id}` });

/** A video ready for approval: exported, checklist ticked, no client. */
function readyProject(): VideoProject {
  const p = project({ status: "editing", checklist: { footageRights: true, noScoreVisuals: true, captionsMatch: true }, clientAppears: false });
  return { ...p, exports: [exportOf(p)], status: "ready" };
}

describe("video: the frame", () => {
  it("has the networks' sizes for each shape, and a quicker draft size", () => {
    expect(frameSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(frameSize("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(frameSize("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(frameSize("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(frameSize("9:16", "quick")).toEqual({ width: 720, height: 1280 });
  });

  it("keeps words inside the safe zone of Reels, TikTok and Shorts at once on 9:16", () => {
    const z = safeZone("9:16");
    expect(z.bottom).toBeGreaterThanOrEqual(0.26);
    expect(z.right).toBeGreaterThanOrEqual(0.14);
    expect(z.top).toBeGreaterThanOrEqual(0.12);
    const r = safeRect("9:16", 1080, 1920);
    expect(r.y + r.h).toBeLessThanOrEqual(1920 * 0.74 + 1);
    expect(safeZone("16:9").bottom).toBeLessThan(0.1);
  });

  it("crops (cover) around the focus point and fits (contain) with centred bars, in even numbers", () => {
    const cover = fitRect(960, 540, 1080, 1920, "cover", 0.5, 0.5);
    expect(cover.sh).toBe(540);
    expect(cover.sw % 2).toBe(0);
    expect(cover.sw).toBe(304);
    expect(cover.sx).toBe(Math.round((960 - 304) / 2));
    expect(fitRect(960, 540, 1080, 1920, "cover", 0, 0.5).sx).toBe(0);
    expect(fitRect(960, 540, 1080, 1920, "cover", 1, 0.5).sx).toBe(960 - 304);
    const contain = fitRect(960, 540, 1080, 1920, "contain");
    expect(contain).toMatchObject({ sx: 0, sy: 0, sw: 960, sh: 540, dw: 1080, dh: 608, dx: 0, dy: 656 });
    expect(fitRect(540, 960, 1080, 1920, "cover")).toMatchObject({ sx: 0, sy: 0, sw: 540, sh: 960 });
  });
});

describe("video: the timeline", () => {
  it("places the clips one after the other and adds the cards", () => {
    const e = edit({ intro: { enabled: true, title: "Hi", seconds: 2 } });
    expect(placeClips(e.clips).map((p) => [p.start, p.end])).toEqual([[0, 3], [3, 5], [5, 7]]);
    expect(bodyDuration(e)).toBe(7);
    expect(totalDuration(e)).toBe(2 + 7 + 3);
    expect(totalDuration({ ...e, intro: { ...e.intro, enabled: false }, outro: { ...e.outro, enabled: false } })).toBe(7);
  });

  it("knows what is on screen at any moment: the intro, a clip at its source time, the end card", () => {
    const e = edit({ intro: { enabled: true, title: "Hi", seconds: 2 } });
    expect(momentAt(e, 1).part).toBe("intro");
    const m = momentAt(e, 2.5);
    expect(m.part).toBe("body");
    if (m.part === "body") {
      expect(m.placed?.clip.id).toBe("cl_a00001");
      expect(m.sourceTime).toBe(1);
    }
    const later = momentAt(e, 8.5);
    if (later.part === "body") {
      expect(later.placed?.clip.id).toBe("cl_c00003");
      expect(later.sourceTime).toBe(2.5);
    }
    expect(momentAt(e, 9.5).part).toBe("outro");
  });

  it("trims inside the source, keeps at least 0.2 seconds, and keeps the other side where it was", () => {
    const e = edit();
    const a = trimClip(e, "cl_a00001", { in: -2 }, VIDEO);
    expect(a.ok && a.edit.clips[0]!.in).toBe(0);
    const b = trimClip(e, "cl_a00001", { out: 99 }, VIDEO);
    expect(b.ok && b.edit.clips[0]!.out).toBe(4);
    const c = trimClip(e, "cl_a00001", { in: 3.45 }, VIDEO);
    expect(c.ok && [c.edit.clips[0]!.in, c.edit.clips[0]!.out]).toEqual([3.3, 3.5]);
    const picture = trimClip(e, "cl_b00002", { out: 45 }, IMAGE);
    expect(picture.ok && picture.edit.clips[1]!.out).toBe(30);
    expect(trimClip(e, "cl_missing", { in: 1 }, VIDEO)).toEqual({ ok: false, code: "not_found" });
  });

  it("splits a clip at its source time, and a picture into two that add up", () => {
    const kinds = (id: string) => [VIDEO, IMAGE, WIDE].find((m) => m.id === id)?.kind;
    const s = splitAt(edit(), 1.25, kinds, "cl_new0001");
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.edit.clips.slice(0, 2).map((c) => [c.in, c.out])).toEqual([[0.5, 1.75], [1.75, 3.5]]);
      expect(bodyDuration(s.edit)).toBe(7);
    }
    const p = splitAt(edit(), 3.5, kinds, "cl_new0002");
    if (p.ok) expect(p.edit.clips.slice(1, 3).map((c) => [c.in, c.out])).toEqual([[0, 0.5], [0, 1.5]]);
    expect(splitAt(edit(), 3.1, kinds).ok).toBe(false);
    expect(splitAt(edit(), 50, kinds)).toEqual({ ok: false, code: "not_found" });
  });

  it("moves, removes and adds clips within the limits", () => {
    const moved = moveClip(edit(), "cl_c00003", 0);
    expect(moved.ok && moved.edit.clips.map((c) => c.id)).toEqual(["cl_c00003", "cl_a00001", "cl_b00002"]);
    const removed = removeClip(edit(), "cl_b00002");
    expect(removed.ok && removed.edit.clips.length).toBe(2);
    const long = { ...edit(), clips: [clip(VIDEO, "cl_long0001", 0, 179)] };
    expect(addClip(long, clip(VIDEO, "cl_long0002", 0, 2))).toEqual({ ok: false, code: "too_long" });
    expect(clipFromMedia(IMAGE).out).toBe(3);
    expect(clipFromMedia(VIDEO).out).toBe(4);
  });

  it("knows when a clip's own sound plays (for lowering the music)", () => {
    const spans = soundSpans(edit(), (id) => id !== IMAGE.id);
    expect(spans).toEqual([{ start: 0, end: 3 }, { start: 5, end: 7 }]);
    const muted = edit();
    muted.clips[0] = { ...muted.clips[0]!, muted: true };
    expect(soundSpans(muted, () => true)).toEqual([{ start: 3, end: 7 }]);
  });

  it("cleans a stored edit so an old or hand-made one never breaks the editor", () => {
    const cleaned = cleanEdit({ aspect: "2:1", clips: [{ id: "x", mediaId: "m", in: 1, out: 1.05 }, { id: "y", mediaId: "m", in: 0, out: 2, fit: "weird" }], logo: { corner: "middle" } });
    expect(cleaned.aspect).toBe("9:16");
    expect(cleaned.clips).toHaveLength(1);
    expect(cleaned.clips[0]!.fit).toBe("cover");
    expect(cleaned.logo.corner).toBe("tr");
    expect(cleaned.logo.version).toBe("auto");
    expect(cleanEdit(null).clips).toEqual([]);
  });
});

describe("video: captions", () => {
  let n = 0;
  const id = () => `cc_t${String(++n).padStart(6, "0")}`;

  it("reads times as people type them", () => {
    expect(parseTime("3")).toBe(3);
    expect(parseTime("0:03.5")).toBe(3.5);
    expect(parseTime("1:02")).toBe(62);
    expect(parseTime("00:00:03,250")).toBe(3.25);
    expect(parseTime("abc")).toBeNull();
    expect(formatTime(62.25)).toBe("1:02.3");
    expect(srtTime(3.25)).toBe("00:00:03,250");
  });

  it("reads an SRT file, a WebVTT file, lines with times, lines with a start, and plain lines", () => {
    const srt = "1\n00:00:00,500 --> 00:00:02,000\nHello there\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond line\nwraps\n";
    expect(parseCaptions(srt, 10, id).map((c) => [c.start, c.end, c.text])).toEqual([[0.5, 2, "Hello there"], [2, 4, "Second line wraps"]]);
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.500\nUno\n";
    expect(parseCaptions(vtt, 10, id).map((c) => [c.start, c.end, c.text])).toEqual([[1, 2.5, "Uno"]]);
    expect(parseCaptions("0:01-0:03 Hello\n0:03 - 0:05 World", 10, id).map((c) => [c.start, c.end])).toEqual([[1, 3], [3, 5]]);
    expect(parseCaptions("[0:01] Hello\n[0:04] World", 10, id).map((c) => [c.start, c.end])).toEqual([[1, 4], [4, 5]]);
    const plain = parseCaptions("A short line.\nAnother line here, a bit longer this time.", 20, id);
    expect(plain.map((c) => c.start)).toEqual([0, plain[0]!.end]);
    expect(plain[1]!.end - plain[1]!.start).toBeGreaterThanOrEqual(1);
  });

  it("cleans captions: in order, inside the video, never two at once, at least half a second", () => {
    const cues = normalizeCues(
      [
        { id: "b", start: 2, end: 6, text: "second" },
        { id: "a", start: 0, end: 3, text: "first" },
        { id: "c", start: 5.8, end: 5.9, text: "  third  " },
        { id: "d", start: 12, end: 14, text: "after the end" },
      ],
      10,
    );
    expect(cues.map((c) => [c.id, c.start, c.end, c.text])).toEqual([["a", 0, 2, "first"], ["b", 2, 5.8, "second"], ["c", 5.8, 6.3, "third"]]);
    expect(cueAt(cues, 2.1)?.id).toBe("b");
    expect(cueAt(cues, 9)).toBeNull();
  });

  it("shifts every caption, writes SRT, and spots captions too fast to read", () => {
    const cues = normalizeCues([{ id: "a", start: 1, end: 2, text: "Hi" }], 10);
    expect(shiftCues(cues, 0.5, 10)[0]).toMatchObject({ start: 1.5, end: 2.5 });
    expect(shiftCues(cues, -3, 10)).toEqual([]);
    expect(cuesToSrt(cues)).toBe("1\n00:00:01,000 --> 00:00:02,000\nHi\n");
    expect(tooFastToRead({ start: 0, end: 1, text: "This caption is far too long to read in a second." })).toBe(true);
    expect(tooFastToRead({ start: 0, end: 3, text: "Short and fine." })).toBe(false);
  });

  it("turns a transcription provider's segments into captions", () => {
    const cues = cuesFromSegments([{ start: 0, end: 1.2, text: " Hello " }, { start: 1, end: 3, text: "there" }, { start: "x" }], 10, id);
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([[0, 1, "Hello"], [1, 3, "there"]]);
  });
});

describe("video: the export", () => {
  const media: Record<string, RenderMedia> = {
    [VIDEO.id]: { file: "m0.webm", kind: "video", width: 540, height: 960, hasAudio: true },
    [IMAGE.id]: { file: "m1.jpg", kind: "image", width: 720, height: 900, hasAudio: false },
    [WIDE.id]: { file: "m2.webm", kind: "video", width: 960, height: 540, hasAudio: false },
  };

  it("writes H.264 and AAC in an MP4 at the shape's size, 30 frames a second", () => {
    expect(exportSettings("9:16")).toMatchObject({ width: 1080, height: 1920, fps: 30, videoCodec: "libx264", audioCodec: "aac", pixelFormat: "yuv420p", container: "mp4", crf: 21 });
    expect(exportSettings("16:9", "quick")).toMatchObject({ width: 1280, height: 720, preset: "ultrafast", crf: 26 });
  });

  it("builds the exact ffmpeg recipe: each piece from its in point, cropped like the preview, silence where there is no sound", () => {
    const e = edit({ intro: { enabled: true, title: "Hi", seconds: 2 }, overlays: [{ id: "ov_t0000001", kind: "title", text: "Hello", sub: "", start: 1, end: 4, position: "top", style: "white" }] });
    const built = buildRenderPlan({ edit: e, settings: exportSettings("9:16"), media, layers: [{ file: "l0.png", start: 1, end: 4 }, { file: "l1.png", start: 6.5, end: 99 }], introFile: "intro.png", outroFile: "outro.png", musicFile: null, output: "out.mp4" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const args = built.plan.args;
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(built.plan.duration).toBe(12);
    // The first clip: from 0.5 s for 3 s.
    expect(args.join(" ")).toContain("-ss 0.5 -t 3 -i m0.webm");
    // The picture is looped for its length.
    expect(args.join(" ")).toContain("-loop 1 -framerate 30 -t 2 -i m1.jpg");
    // The landscape clip, cropped around the centre to the frame's shape (the same numbers as the preview).
    const f = fitRect(960, 540, 1080, 1920, "cover");
    expect(graph).toContain(`crop=${f.sw}:${f.sh}:${f.sx}:${f.sy}`);
    // No sound on the picture and the silent clip: silence of the same length.
    expect(graph).toContain("aevalsrc=0:channel_layout=stereo:sample_rate=48000:duration=2");
    expect(graph).toContain("[1:a]asetpts=PTS-STARTPTS");
    expect(graph).not.toContain("[2:a]");
    expect(graph).not.toContain("[3:a]");
    expect(graph).toContain("concat=n=5:v=1:a=1[vcat][acat]");
    // Words over the body, after the 2-second intro; the second one clipped to the end of the clips.
    expect(graph).toContain("enable='between(t,3,6)'");
    expect(graph).toContain("enable='between(t,8.5,9)'");
    for (const flag of ["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30"]) expect(args).toContain(flag);
    expect(args.slice(-3)).toEqual(["-t", "12", "out.mp4"]);
  });

  it("mixes the music under it all, lower while a clip speaks, faded at the end", () => {
    const e = edit({ music: { trackId: "mu_x", volume: 0.4, duck: true, duckTo: 0.1, fadeOut: true } });
    const built = buildRenderPlan({ edit: e, settings: exportSettings("9:16"), media, layers: [], introFile: null, outroFile: "outro.png", musicFile: "music.ogg", output: "out.mp4" });
    if (!built.ok) throw new Error(built.problem);
    const args = built.plan.args;
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.join(" ")).toContain("-stream_loop -1 -i music.ogg");
    expect(graph).toContain("volume='if(gt(between(t,0,3),0),0.100,0.400)':eval=frame");
    expect(graph).toContain("afade=t=out:st=8.5:d=1.5");
    expect(graph).toContain("amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[aout]");
  });

  it("refuses what it can't render", () => {
    const base = { settings: exportSettings("9:16"), media, layers: [], introFile: null, outroFile: "o.png", musicFile: null, output: "o.mp4" };
    expect(buildRenderPlan({ ...base, edit: { ...edit(), clips: [] } })).toEqual({ ok: false, problem: "no_clips" });
    expect(buildRenderPlan({ ...base, media: {}, edit: edit() })).toEqual({ ok: false, problem: "missing_media" });
    expect(buildRenderPlan({ ...base, outroFile: null, edit: edit() })).toEqual({ ok: false, problem: "missing_card" });
  });

  it("draws the logo, Alti, words and captions in one order, for the preview and the export alike", () => {
    const e = edit({
      logo: { enabled: true, corner: "tr", version: "white" },
      alti: { enabled: true, pose: "wave", corner: "br", start: 0, end: 2 },
      overlays: [{ id: "ov_a0000001", kind: "title", text: "Hi", sub: "", start: 0, end: 2, position: "top", style: "white" }],
      captions: [{ id: "cc_a0000001", start: 1, end: 3, text: "Hello" }],
    });
    expect(layerSpecs(e).map((l) => l.kind)).toEqual(["logo", "alti", "overlay", "caption"]);
    expect(layersAt(e, 1.5).map((l) => l.kind)).toEqual(["logo", "alti", "overlay", "caption"]);
    expect(layersAt(e, 2.5).map((l) => l.kind)).toEqual(["logo", "caption"]);
    // Auto: one logo per clip, so each clip gets its own shade.
    const auto = layerSpecs({ ...e, logo: { ...e.logo, version: "auto" } }).filter((l) => l.kind === "logo");
    expect(auto.map((l) => [l.id, l.start, l.end])).toEqual([["cl_a00001", 0, 3], ["cl_b00002", 3, 5], ["cl_c00003", 5, 7]]);
    // An empty title draws nothing.
    expect(layerSpecs({ ...e, overlays: [{ ...e.overlays[0]!, text: " " }] }).some((l) => l.kind === "overlay")).toBe(false);
  });

  it("makes the clips' own sound into 16 kHz WAV for automatic captions", () => {
    const args = buildSpeechArgs(edit(), media, "speech.wav")!;
    expect(args.join(" ")).toContain("-ss 0.5 -t 3 -i m0.webm");
    expect(args.join(" ")).not.toContain("m2.webm");
    expect(args).toContain("pcm_s16le");
    expect(buildSpeechArgs({ ...edit(), clips: [clip(IMAGE, "cl_i0000001", 0, 2)] }, media, "s.wav")).toBeNull();
  });

  it("reads ffmpeg's progress and what it says about a file", () => {
    expect(progressFromLog("frame=  120 fps= 30 q=28.0 size=  256kB time=00:00:04.00 bitrate= 524.3kbits/s")).toBe(4);
    expect(progressFromLog("nothing here")).toBeNull();
    const probe = probeFromLog([
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'm0.mov':",
      "  Duration: 00:00:12.50, start: 0.000000, bitrate: 9000 kb/s",
      "  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080, 30 fps",
      "      rotate          : 90",
      "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s",
    ]);
    expect(probe).toEqual({ duration: 12.5, width: 1080, height: 1920, hasAudio: true, hasVideo: true });
    expect(probeFromLog(["Duration: 00:00:04.00", "Stream #0:0: Video: vp9, yuv420p, 540x960"]).hasAudio).toBe(false);
  });

  it("serves the export engine from this site, at the version installed", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; scripts: Record<string, string> };
    expect(pkg.dependencies["@ffmpeg/core"]).toBe(FFMPEG_CORE_VERSION);
    expect(pkg.scripts.prebuild).toContain("copy-ffmpeg-core");
    expect(pkg.scripts.predev).toContain("copy-ffmpeg-core");
    const worker = readFileSync("public/video-studio/ffmpeg-worker.js", "utf8");
    expect(worker).not.toMatch(/unpkg|jsdelivr|https?:\/\//);
    expect(readFileSync(".gitignore", "utf8")).toContain("public/vendor/ffmpeg/");
  });

  const ffmpeg = spawnSync("ffmpeg", ["-hide_banner", "-version"]).status === 0;
  it.skipIf(!ffmpeg)("renders a real MP4 with the recipe (ffmpeg on this machine)", () => {
    const dir = mkdtempSync(join(tmpdir(), "video-render-"));
    for (const f of ["sample-1-navy.webm", "sample-2-light.webm", "sample-picture.jpg", "sample-music.ogg"]) copyFileSync(join("public/video-studio/samples", f), join(dir, f));
    // A transparent layer and the two cards, made with ffmpeg itself.
    const make = (args: string[]) => expect(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: dir }).status).toBe(0);
    make(["-f", "lavfi", "-i", "color=c=0xEFB537:s=200x60", "-vf", "format=rgba,pad=720:1280:100:900:color=black@0", "-frames:v", "1", "layer.png"]);
    make(["-f", "lavfi", "-i", "color=c=0x12213A:s=720x1280", "-frames:v", "1", "card.png"]);
    const e = { ...newEdit("9:16"), intro: { enabled: true, title: "Hi", seconds: 1 }, clips: [clip(VIDEO, "cl_r0000001", 0.5, 2), clip(SAMPLE_MEDIA[1]!, "cl_r0000002", 0, 1), clip(IMAGE, "cl_r0000003", 0, 1)], music: { trackId: "mu_x", volume: 0.3, duck: true, duckTo: 0.1, fadeOut: true } };
    const built = buildRenderPlan({
      edit: e,
      settings: exportSettings("9:16", "quick"),
      media: {
        [VIDEO.id]: { file: "sample-1-navy.webm", kind: "video", width: 540, height: 960, hasAudio: true },
        [SAMPLE_MEDIA[1]!.id]: { file: "sample-2-light.webm", kind: "video", width: 540, height: 960, hasAudio: false },
        [IMAGE.id]: { file: "sample-picture.jpg", kind: "image", width: 720, height: 900, hasAudio: false },
      },
      layers: [{ file: "layer.png", start: 0, end: 2 }],
      introFile: "card.png",
      outroFile: "card.png",
      musicFile: "sample-music.ogg",
      output: "out.mp4",
    });
    if (!built.ok) throw new Error(built.problem);
    const run = spawnSync("ffmpeg", built.plan.args, { cwd: dir, encoding: "utf8" });
    expect(run.status, run.stderr.slice(-800)).toBe(0);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", "out.mp4"], { cwd: dir, encoding: "utf8" });
    const info = JSON.parse(probe.stdout) as { streams: Array<{ codec_name: string; width?: number; height?: number }>; format: { duration: string } };
    expect(info.streams.map((s) => s.codec_name).sort()).toEqual(["aac", "h264"]);
    expect(info.streams.find((s) => s.codec_name === "h264")).toMatchObject({ width: 720, height: 1280 });
    expect(Math.abs(Number(info.format.duration) - built.plan.duration)).toBeLessThan(0.1);
    writeFileSync(join(dir, "done"), "ok");
  }, 60_000);
});

describe("video: the check before approval", () => {
  it("the demo's video passes every word rule; its checklist waits for a person and an export", () => {
    const p = project();
    expect(blockingVideoIssues(checkVideo(p))).toEqual([expect.objectContaining({ rule: "client-question" })]);
    const items = videoChecklist(p);
    expect(items.find((i) => i.key === "words")?.done).toBe(true);
    expect(items.filter((i) => i.by === "person").every((i) => !i.done)).toBe(true);
    expect(items.find((i) => i.key === "export")?.done).toBe(false);
  });

  it("every caption, title, card and the post's words go through the claim rules", () => {
    const p = project();
    const bad = {
      ...p,
      edit: {
        ...p.edit,
        captions: [...p.edit.captions, { id: "cc_bad00001", start: 8, end: 9, text: "Get a free review today" }],
        overlays: [{ id: "ov_bad00001", kind: "title" as const, text: "+100 points in 30 days", sub: "", start: 0, end: 2, position: "top" as const, style: "white" as const }],
        outro: { enabled: true, line: "Last chance: act now", seconds: 3 },
      },
      plan: { ...p.plan, postCaption: "We remove negative items. Guaranteed." },
    };
    const rules = checkVideo(bad).filter((i) => i.severity === "block");
    const at = (field: string, rule: string) => rules.some((i) => i.field === field && i.rule === rule);
    expect(at("caption", "no-free")).toBe(true);
    expect(at("overlay", "no-score-visuals")).toBe(true);
    expect(at("outro", "no-pressure")).toBe(true);
    expect(rules.some((i) => i.field === "postCaption")).toBe(true);
    expect(rules.find((i) => i.field === "caption")?.itemId).toBe("cc_bad00001");
  });

  it("Texas only: Georgia blocks; another state is a warning", () => {
    const p = project();
    const georgia = { ...p, plan: { ...p.plan, postCaption: `${p.plan.postCaption} Now in Georgia too.` } };
    expect(checkVideo(georgia).some((i) => i.rule === "texas-only" && i.severity === "block")).toBe(true);
    const other = { ...p, plan: { ...p.plan, script: `${p.plan.script} Like many people in Florida.` } };
    expect(checkVideo(other).some((i) => i.rule === "other-state" && i.severity === "warn")).toBe(true);
  });

  it("talk about credit needs 'results vary' in the video's own language", () => {
    const p = project({ language: "en" });
    const without = { ...p, plan: { ...p.plan, postCaption: "You tell us what is wrong on your report." }, edit: { ...p.edit, outro: { ...p.edit.outro, line: "Your credit, explained." } } };
    expect(checkVideo(without).some((i) => i.rule === "results-vary")).toBe(true);
  });

  it("Alti on screen always carries his AI label, drawn by the editor", () => {
    const p = project({ edit: { ...project().edit, alti: { enabled: true, pose: "wave", corner: "br", start: 0, end: 2 } } });
    expect(asContentPiece(p).copy.onScreen.en).toContain(aiByline("en"));
    expect(checkVideo(p).some((i) => i.rule === "alti-label")).toBe(false);
    expect(videoChecklist(p).find((i) => i.key === "altiLabel")?.done).toBe(true);
  });

  it("music only with its rights on record", () => {
    const p = project({ edit: { ...project().edit, music: { trackId: SAMPLE_TRACK.id, volume: 0.3, duck: true, duckTo: 0.1, fadeOut: true } } });
    expect(checkVideo(p, [SAMPLE_TRACK]).some((i) => i.rule === "music-rights")).toBe(false);
    expect(checkVideo(p, []).some((i) => i.rule === "music-rights")).toBe(true);
    const noRights: MusicTrack = { ...SAMPLE_TRACK, rights: { confirmedBy: "", confirmedAt: "", note: "" } };
    expect(checkVideo(p, [noRights]).some((i) => i.rule === "music-rights")).toBe(true);
    expect(checkVideo(p, [{ ...SAMPLE_TRACK, removedAt: NOW.toISOString() }]).some((i) => i.rule === "music-rights")).toBe(true);
  });

  it("a client appears only with written consent on record", () => {
    expect(checkVideo(project({ clientAppears: null })).some((i) => i.rule === "client-question")).toBe(true);
    expect(checkVideo(project({ clientAppears: true })).some((i) => i.rule === "client-consent")).toBe(true);
    const consent = { id: "cn_x0000001", name: "Rosa M.", signedOn: "2026-12-01", where: "Drive / consents / rosa.pdf", recordedBy: "carmen", recordedAt: NOW.toISOString() };
    expect(checkVideo(project({ clientAppears: true, consents: [consent] })).some((i) => i.rule.startsWith("client"))).toBe(false);
    expect(checkVideo(project({ clientAppears: false })).some((i) => i.rule.startsWith("client"))).toBe(false);
  });

  it("warns about captions too fast to read or after the end", () => {
    const p = project();
    const fast = { ...p, edit: { ...p.edit, captions: [{ id: "cc_fast0001", start: 0, end: 0.6, text: "This caption is much too long for the time it gets." }, { id: "cc_late0001", start: 30, end: 31, text: "Late" }] } };
    const issues = checkVideo(fast);
    expect(issues.some((i) => i.rule === "too-fast" && i.severity === "warn")).toBe(true);
    expect(issues.some((i) => i.rule === "caption-after-end")).toBe(true);
  });

  it("approval needs no blocking issue, the checklist done, and an export of this exact version", () => {
    const ready = readyProject();
    expect(videoApprovalBlockers(ready)).toEqual([]);
    const stale = { ...ready, edit: { ...ready.edit, captions: [] } };
    expect(currentExport(stale)).toBeNull();
    expect(videoApprovalBlockers(stale).map((b) => b.code)).toContain("checklist:export");
    expect(videoApprovalBlockers({ ...ready, checklist: {} }).map((b) => b.code)).toEqual(expect.arrayContaining(["checklist:footageRights", "checklist:noScoreVisuals", "checklist:captionsMatch"]));
  });
});

describe("video: the board", () => {
  const by = "carmen";
  const apply = (projects: VideoProject[], action: VideoAction) => applyVideoAction(projects, action, by, NOW);

  it("asks the right capability for each action: editors make, only content.approve approves", () => {
    expect(VIDEO_ACTION_CAPABILITY.approve).toBe("content.approve");
    expect(VIDEO_ACTION_CAPABILITY.request_changes).toBe("content.approve");
    for (const action of ["create", "update", "move", "add_export", "submit", "link_piece", "publish", "duplicate"] as const) expect(VIDEO_ACTION_CAPABILITY[action]).toBe("content.edit");
    expect(can("admin", "content.approve")).toBe(true);
    expect(can("specialist", "content.approve")).toBe(false);
    expect(can("specialist", "content.edit")).toBe(true);
    expect(can("sales", "content.view")).toBe(false);
    // No new capability: the Video Studio uses the content team's.
    expect(CAPABILITIES.some((c) => c.startsWith("video"))).toBe(false);
  });

  it("creates a planned video from a brief, shaped by its format", () => {
    const r = apply([], { action: "create", title: "From an ad", language: "es", brief: { format: "landscape", source: "ads", ref: "ad-1", hook: "Hola" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.status).toBe("planned");
    expect(r.project.edit.aspect).toBe("16:9");
    expect(r.project.brief).toMatchObject({ source: "ads", ref: "ad-1", hook: "Hola" });
    expect(r.project.plan.cta).toBe("Empezar mi revisión");
    expect(r.events[0]).toMatchObject({ kind: "created", note: "brief:ad-1" });
    expect(apply([], { action: "create", title: "x", language: "en", brief: { format: "reel" } }).ok).toBe(false);
  });

  it("moves Planned → Editing when clips go on, Ready only with an export, Approved, then Published with a Content piece", () => {
    const planned = { ...project(), status: "planned" as const, edit: { ...project().edit, clips: [] }, media: [] };
    const withClips = apply([planned], { action: "update", id: planned.id, patch: { media: SAMPLE_MEDIA, edit: { ...planned.edit, clips: [clipFromMedia(VIDEO, "cl_z0000001")] } } });
    expect(withClips.ok && withClips.project.status).toBe("editing");
    if (!withClips.ok) return;
    const noExport = apply([withClips.project], { action: "submit", id: planned.id });
    expect(noExport.ok === false && noExport.code).toBe("no_export");
    const prepared = { ...withClips.project, checklist: { footageRights: true, noScoreVisuals: true, captionsMatch: true }, clientAppears: false };
    const exported = apply([prepared], { action: "add_export", id: planned.id, export: exportOf(prepared, "ex_z00000001") });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const submitted = apply([exported.project], { action: "submit", id: planned.id });
    expect(submitted.ok && submitted.project.status).toBe("ready");
    if (!submitted.ok) return;
    const approved = apply([submitted.project], { action: "approve", id: planned.id });
    expect(approved.ok && approved.project.status).toBe("approved");
    if (!approved.ok) return;
    expect(approvalHolds(approved.project)).toBe(true);
    expect(approved.project.approval?.hash).toBe(projectHash(approved.project));
    const linked = apply([approved.project], { action: "link_piece", id: planned.id, pieceId: "pc_abc123456" });
    expect(linked.ok && linked.project.contentPieceId).toBe("pc_abc123456");
    if (!linked.ok) return;
    expect(apply([linked.project], { action: "publish", id: planned.id, pieceId: "pc_other12345" }).ok).toBe(false);
    const published = apply([linked.project], { action: "publish", id: planned.id, pieceId: "pc_abc123456" });
    expect(published.ok && published.project.status).toBe("published");
    if (!published.ok) return;
    const after = apply([published.project], { action: "update", id: planned.id, patch: { title: "Changed" } });
    expect(after.ok === false && after.code).toBe("published");
    expect(canMoveVideo("published", "archived")).toBe(true);
    expect(canMoveVideo("published", "editing")).toBe(false);
  });

  it("an edit after approval drops it and sends the video back to Editing; the ticks are asked again", () => {
    const ready = readyProject();
    const approved = apply([ready], { action: "approve", id: ready.id });
    if (!approved.ok) throw new Error("not approved");
    const edited = apply([approved.project], { action: "update", id: ready.id, patch: { edit: { ...approved.project.edit, captions: [] } } });
    expect(edited.ok && [edited.project.status, edited.project.approval, edited.project.checklist]).toEqual(["editing", null, {}]);
    expect(edited.ok && edited.events.map((e) => e.kind)).toContain("approval_reset");
    // A change that is not in what was approved (the owner) keeps it.
    const owner = apply([approved.project], { action: "update", id: ready.id, patch: { owner: "luis" } });
    expect(owner.ok && owner.project.status).toBe("approved");
  });

  it("refuses approval while something blocks it, and asking for changes needs a note", () => {
    const ready = readyProject();
    const blocked = apply([{ ...ready, clientAppears: true }], { action: "approve", id: ready.id });
    expect(blocked.ok === false && blocked.code).toBe("blocked");
    expect(apply([ready], { action: "request_changes", id: ready.id, note: "" }).ok).toBe(false);
    const back = apply([ready], { action: "request_changes", id: ready.id, note: "Shorter hook, please." });
    expect(back.ok && [back.project.status, back.project.changesNote]).toEqual(["editing", "Shorter hook, please."]);
    expect(apply([project({ status: "editing" })], { action: "approve", id: ready.id }).ok).toBe(false);
  });

  it("keeps files to samples, this browser's store or the video's own storage folder", () => {
    expect(mediaRefAllowed("/video-studio/samples/sample-1-navy.webm", "vp_abc123456")).toBe(true);
    expect(mediaRefAllowed("idb:md_abc123456", "vp_abc123456")).toBe(true);
    expect(mediaRefAllowed("vp_abc123456/md_xyz123456.mp4", "vp_abc123456")).toBe(true);
    expect(mediaRefAllowed("vp_other12345/md_xyz123456.mp4", "vp_abc123456")).toBe(false);
    expect(mediaRefAllowed("https://example.com/clip.mp4", "vp_abc123456")).toBe(false);
    const p = project();
    expect(apply([p], { action: "update", id: p.id, patch: { media: [{ ...VIDEO, ref: "https://example.com/x.mp4" }] } }).ok).toBe(false);
  });

  it("records consent only with a name, a past date and where the form is kept", () => {
    const p = project();
    const good = { id: "cn_ok000001", name: "Rosa M.", signedOn: "2026-12-01", where: "Drive / consents", recordedBy: "", recordedAt: "" };
    expect(apply([p], { action: "update", id: p.id, patch: { consents: [good] } }).ok).toBe(true);
    expect(apply([p], { action: "update", id: p.id, patch: { consents: [{ ...good, signedOn: "2027-01-01" }] } }).ok).toBe(false);
    expect(apply([p], { action: "update", id: p.id, patch: { consents: [{ ...good, where: "" }] } }).ok).toBe(false);
  });

  it("counts what needs a person: approvers the ready videos; editors their changes and the hand-offs", () => {
    const list = [
      project({ status: "ready" }),
      project({ id: "vp_two000001", status: "editing", changesNote: "Fix the hook", owner: "luis" }),
      project({ id: "vp_three0001", status: "editing", changesNote: "Fix it", owner: "marta" }),
      project({ id: "vp_four00001", status: "approved" }),
      project({ id: "vp_five00001", status: "archived" }),
    ];
    expect(videoNeeds(list, { approve: true, edit: true, handle: "carmen" })).toMatchObject({ ready: 1, changes: 0, toHandOff: 1, count: 2 });
    expect(videoNeeds(list, { approve: false, edit: true, handle: "luis" })).toMatchObject({ ready: 0, changes: 1, toHandOff: 1, count: 2 });
    expect(videoNeeds(list, { approve: false, edit: false, handle: null }).count).toBe(0);
  });

  it("duplicates a video without its approval, exports or Content piece", () => {
    const ready = readyProject();
    const copy = apply([ready], { action: "duplicate", id: ready.id, newId: "vp_copy000001" });
    expect(copy.ok && copy.project).toMatchObject({ id: "vp_copy000001", status: "editing", approval: null, exports: [], contentPieceId: null });
  });
});

describe("video: briefs from the Ads Manager", () => {
  it("reads a brief from a link, base64url or plain JSON, and maps the format", () => {
    const link = briefLink({ title: "Myth or fact", goal: "Clear a myth", hook: "Myth: …", script: "Línea uno.", format: "9:16", id: "ad-7", language: "es" });
    expect(link).toMatch(/^\/equipo\/video\?brief=[A-Za-z0-9_-]+$/);
    const parsed = parseBriefParam(link.split("=")[1]!);
    expect(parsed).toEqual({ language: "es", brief: { title: "Myth or fact", goal: "Clear a myth", hook: "Myth: …", script: "Línea uno.", format: "reel", source: "ads", ref: "ad-7" } });
    expect(parseBriefParam(JSON.stringify({ title: "Plain", format: "youtube" }))?.brief.format).toBe("landscape");
    expect(parseBriefParam("not a brief")).toBeNull();
    expect(parseBriefParam(JSON.stringify({ title: "" }))).toBeNull();
    expect(parseBriefParam("x".repeat(9000))).toBeNull();
    expect(formatFrom("4:5")).toBe("feed_portrait");
    expect(formatFrom("whatever")).toBe("reel");
  });
});

describe("video: Alti's script and shots (mocked model)", () => {
  const request = { language: "en" as const, brief: { title: "Your right to dispute", goal: "", hook: "", script: "", format: "reel" as const } };

  it("without a key, drafts from the brief or the closest template, and every line passes the rules", async () => {
    for (const language of ["en", "es"] as const) {
      const draft = await draftVideoPlan({ ...request, language }, null);
      expect(draft.source).toBe("templates");
      expect(draft.draft).toBe(true);
      expect(draft.note).toBe("not_configured");
      expect(draft.shots.length).toBeGreaterThanOrEqual(3);
      expect(draft.shots.every((s) => s.id.startsWith("sh_"))).toBe(true);
      expect(draft.issues.filter((i) => i.severity === "block"), JSON.stringify(draft.issues)).toEqual([]);
    }
    const fromBrief = templateVideoDraft({ ...request, brief: { ...request.brief, hook: "A hook.", script: "One. Two sentences here." } });
    expect(fromBrief.hook).toBe("A hook.");
    expect(fromBrief.shots.map((s) => s.onScreen)).toContain("One");
  });

  it("with a model: its draft, checked; written again once when it breaks a rule; templates when it fails", async () => {
    const good: VideoAssistOutput = { hook: "Something looks wrong?", script: "You tell us what is inaccurate. Our team prepares and mails the letters.", shots: [{ seconds: 3, shot: "Talking to camera", onScreen: "Looks wrong?" }], postCaption: "You tell us what is wrong; our team prepares and mails the letters. Results vary.", cta: "Start my review" };
    const bad = { ...good, postCaption: "Free review! We remove items. Results vary." };
    const calls: string[] = [];
    const caller = async ({ user }: { system: string; user: string }) => {
      calls.push(user);
      return { output: calls.length === 1 ? bad : good, problem: null };
    };
    const result = await draftVideoPlan(request, caller);
    expect(result.source).toBe("model");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/broke these rules/);
    expect(result.postCaption).toBe(good.postCaption);
    expect(checkVideoDraft(good, "en").filter((i) => i.severity === "block")).toEqual([]);
    const refused = await draftVideoPlan(request, async () => ({ output: null, problem: "refusal" }));
    expect([refused.source, refused.note]).toEqual(["templates", "refusal"]);
    const nonsense = await draftVideoPlan(request, async () => ({ output: { hook: 1 }, problem: null }));
    expect(nonsense.note).toBe("invalid_output");
  });
});

describe("video: automatic captions (off by default)", () => {
  it("is not connected without TRANSCRIBE_API_KEY", async () => {
    expect(transcribeStatus({})).toEqual({ configured: false, provider: null });
    expect(transcribeStatus({ TRANSCRIBE_API_KEY: "k", TRANSCRIBE_PROVIDER: "unknown" })).toEqual({ configured: false, provider: null });
    expect(transcribeStatus({ TRANSCRIBE_API_KEY: "k" })).toEqual({ configured: true, provider: "openai" });
    expect(await transcribe(new Uint8Array(10), { language: "en", duration: 5, makeId: () => "cc_x0000001" }, {})).toEqual({ ok: false, code: "not_configured" });
  });

  it("sends only the speech to the provider and returns timed captions (mocked provider)", async () => {
    let n = 0;
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ segments: [{ start: 0, end: 1.5, text: "Hello" }, { start: 1.5, end: 3, text: "there" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await transcribe(new Uint8Array(100), { language: "es", duration: 10, makeId: () => `cc_m${++n}000000` }, { TRANSCRIBE_API_KEY: "secret" }, fetcher);
    expect(result).toEqual({ ok: true, cues: [expect.objectContaining({ start: 0, end: 1.5, text: "Hello" }), expect.objectContaining({ start: 1.5, end: 3, text: "there" })] });
    expect(seen[0]).toEqual({ url: "https://api.openai.com/v1/audio/transcriptions", auth: "Bearer secret" });
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await transcribe(new Uint8Array(100), { language: "en", duration: 10, makeId: () => "cc_x0000001" }, { TRANSCRIBE_API_KEY: "k" }, down)).toEqual({ ok: false, code: "provider_error" });
  });
});

describe("video: files", () => {
  const head = (file: string) => new Uint8Array(readFileSync(`public/video-studio/samples/${file}`)).subarray(0, 64);

  it("reads a file's type from its first bytes, for the kind it is meant to be", () => {
    expect(sniffStudioFile(head("sample-1-navy.webm"), "video")).toBe("video/webm");
    expect(sniffStudioFile(head("sample-picture.jpg"), "image")).toBe("image/jpeg");
    expect(sniffStudioFile(head("sample-music.ogg"), "audio")).toBe("audio/ogg");
    expect(sniffStudioFile(head("sample-1-navy.webm"), "audio")).toBe("audio/webm");
    expect(sniffStudioFile(head("sample-picture.jpg"), "video")).toBeNull();
    expect(sniffStudioFile(new Uint8Array([0x49, 0x44, 0x33, 4, 0]), "audio")).toBe("audio/mpeg");
    expect(sniffStudioFile(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), "audio")).toBe("audio/wav");
    expect(sniffStudioFile(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "video")).toBeNull();
    expect(checkStudioFile(head("sample-1-navy.webm"), 300 * 1024 * 1024, "video")).toEqual({ ok: false, code: "too_large" });
    expect(checkStudioFile(new Uint8Array(), 0, "video")).toEqual({ ok: false, code: "empty" });
    expect(looksLikeMp4(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))).toBe(true);
  });

  it("bundles small sample clips, labelled as samples, under a megabyte in all", () => {
    const total = SAMPLE_MEDIA.reduce((sum, m) => sum + readFileSync(`public${m.ref}`).length, 0) + readFileSync(`public${SAMPLE_TRACK.ref}`).length;
    expect(total).toBeLessThan(1024 * 1024);
    for (const m of SAMPLE_MEDIA) {
      expect(m.source).toBe("sample");
      expect(m.name).toMatch(/^Sample/);
      expect(readFileSync(`public${m.ref}`).length).toBe(m.bytes);
    }
    expect(SAMPLE_TRACK.rights.confirmedBy).toBeTruthy();
  });

  it("accepts only the shapes the routes expect", () => {
    expect(videoBodySchema.safeParse({ action: "create", title: "Hi there", language: "en", brief: { format: "reel" } }).success).toBe(true);
    expect(videoBodySchema.safeParse({ action: "create", title: "Hi there", language: "fr", brief: { format: "reel" } }).success).toBe(false);
    expect(videoBodySchema.safeParse({ action: "approve", id: "vp_abc123456", extra: 1 }).success).toBe(false);
    expect(videoFilesBodySchema.safeParse({ action: "confirm_music", fileId: "mu_abc123456", path: "music/mu_abc123456.mp3", name: "x", duration: 3, rightsConfirmed: false, rightsNote: "" }).success).toBe(false);
    expect(videoFilesBodySchema.safeParse({ action: "confirm_music", fileId: "mu_abc123456", path: "music/mu_abc123456.mp3", name: "x", duration: 3, rightsConfirmed: true, rightsNote: "" }).success).toBe(true);
  });
});

describe("video: in the console", () => {
  it("sits in the Content group right after Content, for the content team only", () => {
    const group = NAV_GROUPS.find((g) => g.key === "content")!;
    expect(group.hrefs.slice(0, 2)).toEqual(["/equipo/contenido", "/equipo/video"]);
    expect(MORE_NAV.find((n) => n.href === "/equipo/video")?.needs).toBe("content.view");
    expect(groupOfPath("/equipo/video/vp_abc123456").key).toBe("content");
    expect(helpForPath("/equipo/video/vp_abc123456", "en").title).toBe("Video Studio");
    expect(helpForPath("/equipo/video", "es").title).toBe("Estudio de video");
  });

  it("Alti's job here is a draft of words a person saves; sales has none", () => {
    const as = (role: "admin" | "specialist" | "sales") => (c: Capability) => can(role, c);
    expect(altiJobs("content", as("specialist")).map((j) => j.id)).toContain("video_script");
    expect(altiJobs("content", as("sales")).map((j) => j.id)).not.toContain("video_script");
    expect(altiJobs("content", as("admin")).find((j) => j.id === "video_script")?.gate).toBe("words");
  });

  it("adds the Video Studio's count to the Content group's red circle", () => {
    resetBadges();
    publishBadges("video", { content: 2 });
    expect(currentBadges().content).toBe(2);
    publishBadges("overview", { content: 3 });
    expect(currentBadges().content).toBe(5);
    publishBadges("video", {});
    expect(currentBadges().content).toBe(3);
    resetBadges();
  });

  it("says every word in English and Spanish", () => {
    expect(Object.keys(VIDEO_TEXT.en.status)).toEqual(Object.keys(VIDEO_TEXT.es.status));
    expect(VIDEO_TEXT.es.status.ready).not.toBe(VIDEO_TEXT.en.status.ready);
  });
});
