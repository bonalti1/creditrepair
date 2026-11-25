import { projectHash } from "./hash";
import { cleanBrief } from "./rules";
import { clipFromMedia, newEdit } from "./timeline";
import type { MediaItem, MusicTrack, VideoEvent, VideoProject } from "./types";

// The demo's Video Studio (no database): three invented videos and the small
// sample clips bundled in public/video-studio/samples (made for the demo by
// the team with ffmpeg: moving brand-colour backgrounds and tones, under
// half a megabyte in all), each labelled as a sample on screen. The sample
// music track is generated tones too, so its rights are the team's own.

const SAMPLE_DIR = "/video-studio/samples";

export const SAMPLE_MEDIA: MediaItem[] = [
  { id: "md_sample1navy", kind: "video", name: "Sample clip 1 (navy, with sound)", mediaType: "video/webm", bytes: 120270, duration: 4, width: 540, height: 960, hasAudio: true, source: "sample", ref: `${SAMPLE_DIR}/sample-1-navy.webm`, addedBy: "carmen", addedAt: "2026-11-20T15:00:00.000Z" },
  { id: "md_sample2light", kind: "video", name: "Sample clip 2 (light, no sound)", mediaType: "video/webm", bytes: 79948, duration: 4, width: 540, height: 960, hasAudio: false, source: "sample", ref: `${SAMPLE_DIR}/sample-2-light.webm`, addedBy: "carmen", addedAt: "2026-11-20T15:00:00.000Z" },
  { id: "md_sample3wide", kind: "video", name: "Sample clip 3 (landscape)", mediaType: "video/webm", bytes: 122266, duration: 4, width: 960, height: 540, hasAudio: true, source: "sample", ref: `${SAMPLE_DIR}/sample-3-wide.webm`, addedBy: "carmen", addedAt: "2026-11-20T15:00:00.000Z" },
  { id: "md_samplepicture", kind: "image", name: "Sample picture", mediaType: "image/jpeg", bytes: 17802, duration: null, width: 720, height: 900, hasAudio: false, source: "sample", ref: `${SAMPLE_DIR}/sample-picture.jpg`, addedBy: "carmen", addedAt: "2026-11-20T15:00:00.000Z" },
];

export const SAMPLE_TRACK: MusicTrack = {
  id: "mu_samplechords",
  name: "Sample music: soft chords (generated)",
  mediaType: "audio/ogg",
  bytes: 107490,
  duration: 12,
  source: "sample",
  ref: `${SAMPLE_DIR}/sample-music.ogg`,
  rights: { confirmedBy: "carmen", confirmedAt: "2026-11-20T15:00:00.000Z", note: "Made by the team for the demo (generated tones). Ours to use." },
  addedBy: "carmen",
  addedAt: "2026-11-20T15:00:00.000Z",
  removedAt: null,
};

export interface DemoVideoStudio {
  projects: VideoProject[];
  events: VideoEvent[];
  tracks: MusicTrack[];
}

export function buildDemoVideos(now: Date): DemoVideoStudio {
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const base = (id: string, title: string, daysAgo: number): Omit<VideoProject, "brief" | "plan" | "edit" | "media" | "status" | "language"> => ({
    id,
    title,
    checklist: {},
    clientAppears: null,
    consents: [],
    exports: [],
    approval: null,
    changesNote: null,
    contentPieceId: null,
    owner: "luis",
    createdBy: "carmen",
    createdAt: iso(daysAgo),
    updatedAt: iso(daysAgo),
  });

  // 1. From the Ads Manager: planned, no clips yet.
  const fromAds: VideoProject = {
    ...base("vp_demoadsmyth01", "Myth: checking your report hurts it", 3),
    status: "planned",
    language: "en",
    brief: cleanBrief({
      title: "Myth: checking your report hurts it",
      goal: "A 20-second Reel that clears up one myth and invites people to start a review.",
      hook: "Myth: checking your own credit report hurts it.",
      script: "Myth: checking your own credit report hurts it. Fact: looking at your own report is a soft inquiry. You can see all three reports every week at AnnualCreditReport.com. If something looks wrong, you can dispute it.",
      format: "reel",
      source: "ads",
      ref: "ad-demo-myth-01",
    }),
    plan: { script: "", shots: [], postCaption: "", cta: "Start my review", aiDraft: false },
    media: [],
    edit: newEdit("9:16", "en"),
  };

  // 2. Being edited: the sample clips on the timeline, words on screen and captions.
  const clips = [
    { ...clipFromMedia(SAMPLE_MEDIA[0]!, "cl_demo01a"), in: 0.5, out: 3.5 },
    { ...clipFromMedia(SAMPLE_MEDIA[1]!, "cl_demo01b"), out: 2.5 },
    { ...clipFromMedia(SAMPLE_MEDIA[3]!, "cl_demo01c"), out: 2.5 },
  ];
  const editing: VideoProject = {
    ...base("vp_demoeditrights", "Your right to dispute, in 10 seconds", 1),
    status: "editing",
    language: "en",
    brief: cleanBrief({
      title: "Your right to dispute, in 10 seconds",
      goal: "Explain the right to dispute an inaccurate item, plainly.",
      hook: "Something on your report looks wrong?",
      script: "Something on your report looks wrong? You have the right to dispute it. You tell us what is inaccurate, and our team prepares and mails the letters.",
      format: "reel",
      source: "studio",
      ref: null,
    }),
    plan: {
      script: "Something on your report looks wrong? You have the right to dispute it. You tell us what is inaccurate, and our team prepares and mails the letters.",
      shots: [],
      postCaption: "You have the right to dispute an item you believe is inaccurate. You tell us what is wrong; our team prepares and mails the letters. Results vary.",
      cta: "Start my review",
      aiDraft: false,
    },
    media: SAMPLE_MEDIA,
    edit: {
      ...newEdit("9:16", "en"),
      clips,
      overlays: [{ id: "ov_demo01", kind: "title", text: "Something looks wrong?", sub: "", start: 0, end: 2.5, position: "top", style: "white" }],
      captions: [
        { id: "cc_demo01", start: 0, end: 2.4, text: "Something on your report looks wrong?" },
        { id: "cc_demo02", start: 2.4, end: 5, text: "You have the right to dispute it." },
        { id: "cc_demo03", start: 5, end: 8, text: "You tell us what is inaccurate. We prepare and mail the letters." },
      ],
      music: { trackId: SAMPLE_TRACK.id, volume: 0.35, duck: true, duckTo: 0.12, fadeOut: true },
    },
  };

  // 3. A Spanish idea, planned.
  const spanish: VideoProject = {
    ...base("vp_demoitinspanish", "ITIN: también puedes revisar tu reporte", 0.5),
    status: "planned",
    language: "es",
    brief: cleanBrief({
      title: "ITIN: también puedes revisar tu reporte",
      goal: "Un Reel corto en español para personas con ITIN.",
      hook: "¿Tienes ITIN? También tienes reporte de crédito.",
      script: "",
      format: "tiktok",
      source: "studio",
      ref: null,
    }),
    plan: { script: "", shots: [], postCaption: "", cta: "Empezar mi revisión", aiDraft: false },
    media: [],
    edit: newEdit("9:16", "es"),
  };

  const projects = [fromAds, editing, spanish];
  const events: VideoEvent[] = projects.map((p, i) => ({ id: `ev_demo${i}seed`, projectId: p.id, at: p.createdAt, by: "carmen", kind: "created" as const, to: p.status, hash: projectHash(p) }));
  return { projects, events, tracks: [SAMPLE_TRACK] };
}
