# Video Studio: short videos and ads, edited in the console

`/equipo/video` (section 2 of the menu, right after Content) is where the
team plans, edits, checks and approves short social videos (Instagram Reels,
TikTok, YouTube Shorts, feed posts) and video ads, and hands the approved
ones to a Content piece, which posts them through the existing publishing.

The editor runs **in the team member's browser**: the clips are cut, the words,
captions, logo, cards and music are put on, and the MP4 is rendered there with
ffmpeg compiled to WebAssembly. Nothing is sent to an outside service to edit
a video. Files are kept in the team's private storage (in the demo, in the
browser).

Code: `src/lib/video/` (model, rules, check, render recipe, drawing, store),
`src/app/equipo/video/` (screens), `src/components/staff/video/` (editor and
panels), `src/app/api/staff/video/` (routes),
`public/video-studio/ffmpeg-worker.js` (the export engine's worker),
`supabase/migrations/0038_video.sql` (tables, policies, bucket).

## The screens

| Screen | Path | Who | What |
| --- | --- | --- | --- |
| Board | `/equipo/video` | content.view | Planned → Editing → Ready for approval → Approved → Handed to Content (archived folded away). A brief from the Ads Manager shows on top. On a phone: status chips and one list. `?columna=<status>` opens a column. |
| Music library | `/equipo/video/musica` | content.view (adding: content.edit) | The only music a video may use, each track with its rights record. |
| A video | `/equipo/video/<id>` | content.view | Four tabs (`?pestana=plan|edit|check|handoff`): Plan, Editor, Check & approve, Hand to Content; the history at the foot. |

Sales (content.share only) does not see the Video Studio; the menu hides it
and the screens and routes refuse it.

## The board

| Status | Means | Moves |
| --- | --- | --- |
| Planned | An idea or a brief | → Editing (by hand, or by itself once clips go on the timeline) |
| Editing | Being cut | → Ready with **Send for approval**, which needs an export of this exact version |
| Ready for approval | Exported, waiting for an administrator | → Approved (**content.approve**, no blocking issue, checklist done, the export current); → Editing (changes asked, with a note; or the editor pulls it back) |
| Approved | Approved **as exported** (the project's hash) | → Handed to Content |
| Handed to Content | A Content piece carries it | Archived only; duplicate it to make another |
| Archived | Put away | → Planned (restore) |

Any change to what was approved (the edit, the media, the script, the post's
words, the language) drops the approval and the video goes back to Editing,
in the browser, on the server and in the database (a trigger). The rules are
pure functions in `rules.ts`, the same in the demo and on the server.

## Briefs from the Ads Manager

Another screen sends a brief with a link:

```
/equipo/video?brief=<the brief as JSON, base64url-encoded (or URL-encoded JSON)>
```

```json
{ "title": "…", "goal": "…", "hook": "…", "script": "…",
  "format": "reel" | "tiktok" | "short" | "feed_square" | "feed_portrait" | "landscape" | "9:16" | "1:1" | "4:5" | "16:9",
  "id": "the sender's own id (optional)", "language": "en" | "es" (optional) }
```

`src/lib/video/brief.ts` has `briefLink(brief)` to build the link and
`parseBriefParam` to read it. Nothing is created by the link alone: the board
shows the brief and a person creates the video. A brief with an `id` is
turned into at most one live video (the database holds it: a unique
`brief_ref`); the link then offers to open that video.

## The plan, and Alti's draft

The brief (title, format, language, goal, hook), the script, the shot list
(seconds, what we see, the words on screen), the post's words (they become the
Content piece's caption) and the call to action (on the end card).

**Alti drafts the script and shots** (`assist.ts`), labelled "Alti · AI
assistant", the content assistant's way: with `ANTHROPIC_API_KEY`, Claude
(`CONTENT_MODEL`, the content assistant's cached rules plus the video
format, structured JSON, rewritten once on a blocking rule); without it, the
brief's own words and the closest pre-checked template. Every line goes
through the claim rules; it is a draft until a person uses it and saves it.

## The editor

- **Clips**: upload clips (MP4, MOV, WebM up to 250 MB) and pictures (JPEG,
  PNG, WebP up to 20 MB), or use the bundled sample clips; add them to the
  timeline; trim (typed seconds or «Start/End at playhead»), split at the
  playhead, reorder, remove; framing **Fill (crop)** with the crop position, or
  **Show all** with navy or black bars; the clip's volume or mute. A picture
  shows for the seconds chosen (up to 30).
- **Words**: titles and lower thirds in Poppins/Inter, in the brand's looks
  only (white with a navy edge, navy on white, navy on gold), placed inside the
  safe zone and clear of the logo; each line checked as it is typed.
- **Captions**: typed or pasted (plain lines spread at reading speed, lines
  with times "0:01-0:03 Hello", "[0:01] Hello", or SRT/WebVTT files), each
  editable with its times, shifted all at once, downloaded as .srt. Captions
  follow the brand lock (Poppins 700, 76 px on a 1080 px frame, white with a
  14 px navy edge), at the bottom of the safe zone or in the middle, beside
  Alti when he is on screen. **Auto captions** is a small adapter
  (`transcribe.ts`), **off by default**: the button reads «Not connected» until
  the server has `TRANSCRIBE_API_KEY` (`TRANSCRIBE_PROVIDER=openai`, the one
  written so far; optional `TRANSCRIBE_MODEL`, `TRANSCRIBE_API_URL`). When on,
  only the clips' own sound (16 kHz mono WAV, made in the browser) goes to the
  server and the provider; the captions come back as a draft to read and fix.
- **Brand & shape**: 9:16, 1:1, 4:5, 16:9 (the export is 1080×1920,
  1080×1080, 1080×1350, 1920×1080); the safe-zone guides on the preview
  (inside Reels', TikTok's and Shorts' buttons at once; approximate, from the
  networks' guides); the **logo** (the locked file, scaled evenly, never
  recoloured, with its clear space, in a corner; **automatic**: the white logo
  on dark footage and the navy one on light, measured per clip from a frame of
  it; or always white / always navy); the **intro card** (navy, the white logo,
  a title) and the **end card** (navy, the white logo, a line, the call to
  action on gold); **Alti** as an overlay (a pose, a side, a time), always with
  "Alti · AI assistant" drawn under him.
- **Music**: a track from the library, its volume, lower while a clip has
  sound (ducking, to a chosen level), faded out at the end; looped to the
  video's length.
- **Undo / redo**, and every change saved by itself a moment later as the
  project's edit decisions (JSON).
- **On a phone** the editor keeps to Clips (trim, split, order), Captions and
  Export; the other tools say they are on a larger screen.

The preview is a canvas drawn with the same functions as the export
(`draw.ts`): what the team sees is what the file holds.

## Export

The recipe is pure (`render.ts`, tested): each piece read from its in point
for its length, cropped or fitted with the preview's own numbers, at 30 frames
a second; its sound, or silence of the same length; the cards; every word, the
logo and Alti drawn by the editor into transparent pictures laid over the video
for their time; the music mixed under it; **H.264 (High) and AAC in an MP4**,
`+faststart`. Full quality (1080 p, CRF 21) or a quick draft (720 p).

It runs in a Web Worker with **ffmpeg.wasm's single-threaded core**
(`@ffmpeg/core@0.12.10`), so no cross-origin isolation headers are needed.
The core files are **self-hosted**: `scripts/copy-ffmpeg-core.mjs` copies
them from `node_modules` to `public/vendor/ffmpeg/0.12.10/` before `next dev`
and `next build` (not committed), and they are loaded only when an export (or
reading a file the browser can't) starts, never on the console's first paint.
The app sets no Content-Security-Policy today; if one is added, the editor
needs `worker-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` and
`media-src 'self' blob:` plus the storage host.

A progress bar shows each phase and the percentage; **Cancel** stops at once
(the worker is ended). Each export runs in a fresh worker, so memory is given
back. Measured in the demo (headless Chromium, one core): an 11-second quick
export in about 18 seconds; a 15.5-second full-quality export (intro, three
clips, Alti, captions, music, end card) in about 95 seconds.

The MP4 is kept with the video with the **hash of the version it was rendered
from** (database: storage plus `video_exports`; demo: this browser's
IndexedDB), and can be watched and downloaded. Approval needs an export of the
version as it is.

## The check before approval (`check.ts`)

Every word a viewer reads or hears goes through **the same rules as every
Content piece** (`content/check.ts`: `checkMarketingCopy` and
`checkClaimGuardrails` from `src/lib/compliance/guardrails.ts`, nothing called
free, no outcome words, no score visuals, no price, no pressure): each title
and lower third, each caption, the intro and end cards, the script, the hook,
the post's words and the call to action, each issue shown on the item it is
in. Over all the words: Alti labelled as AI, "Results vary" when the video
talks about credit, the monitoring commission. Also:

- **Texas only**: Georgia blocks; another state's name is a warning.
- **Music**: only a library track with its rights on record (blocks otherwise).
- **A client**: someone answers whether a client appears (face, voice or
  name); if one does, a **written consent** must be recorded (the person's
  name, the date signed, where the signed form is kept; who recorded it).
- Warnings: captions too fast to read (over 20 letters a second), words or
  captions after the clips end.

The checklist (only what applies): every word passes (app); the rights to
every clip and picture (a person); the music's rights (app); no credit score,
dial or before/after on screen (a person: words can't show it); captions on and
matching (a person); a client only with consent (app); Alti's AI label (app);
the export of this exact version (app). **Approval needs `content.approve`**
(administrators), no blocking issue and the checklist done.

## Hand-off to Content

An approved video goes to Content with **Hand to Content**: a new piece (short
video, or YouTube for 16:9; channels from the format; the video's words; Alti
as a character when he is in it) or an existing open one, with the approved MP4
uploaded as the piece's file through the content hub's own upload, the
checklist items the studio already guarantees ticked (logo, colours, fonts,
Alti's label, captions), and the piece sent to its review. Every step is the
content hub's own action (`useContent`), each skipped when already done, so a
hand-off that stopped halfway finishes with the same piece. From there the
piece is approved in Content (its own hash) and posted by a person or by the
existing publishing (Meta, TikTok, YouTube) under its gates. **The Video Studio
has no publishing code.**

## Music library

`/equipo/video/musica`: upload MP3, M4A, WAV or OGG (up to 30 MB) **only with
the box "I confirm the team has the rights…" ticked**, and a note on what the
rights rest on. The record keeps who confirmed it and when (the database
refuses a track without it and never changes it); removing a track keeps the
record.

## The red circle

The Content group's circle on the menu adds the Video Studio's «Needs you»
(`videoNeeds`): for an administrator the videos waiting for approval, for an
editor the changes asked of them and the approved videos not yet handed to
Content. The shell reads it on every page, after every change to a video and
every minute (`lib/video/badge.ts`, `GET /api/staff/video?needs=1`).

## Database (migration 0038)

`video_projects` (the brief, plan, media, edit JSON, checklist, client answer
and consents, `project_hash`, the approval, the Content piece),
`video_exports` (append-only), `video_music` (rights required, unchangeable),
`video_events` (append-only). Row level security: administrators and
specialists read; sales, clients, partners and signed-out visitors read
nothing; only the server writes, after `requireCapability`. Triggers: never
deleted; an edit needs a new hash and drops an approval of the old one; ready,
approved and handed-off need an export of the exact version; a handed-off
video no longer changes. The private bucket **`video-studio`** (250 MB a file;
video, picture and audio types) with storage policies: the content team reads
and adds files; nobody else, and only the server changes or removes one. Files
go straight from the browser to storage with one-time upload links; the server
reads each file's first bytes before recording it and deletes anything that is
not what it should be.

Routes (each asks `requireCapability`): `GET/POST /api/staff/video`,
`POST /api/staff/video/files`, `POST /api/staff/video/assist`,
`GET/POST /api/staff/video/transcribe`.

## The demo

Without a database: three invented videos (one from an Ads brief), the bundled
**sample clips** (generated with ffmpeg: moving brand-colour backgrounds and
tones, about 450 KB in all, each labelled "Sample" in the editor and on
screen), and a generated sample music track with the team's own rights. Edits,
exports and uploads stay in the browser (localStorage and IndexedDB); «Reset
the demo» clears them.

## Tests

- `src/lib/__tests__/video.test.ts`: the frame and safe zones, crop/fit,
  timeline math, trims, splits, captions (parsing, timing, SRT), export
  settings and the exact ffmpeg arguments (and, where ffmpeg is installed, a
  real render checked with ffprobe), the layers' order, the check and the
  checklist, the board's moves and capabilities, briefs, Alti's draft with a
  mocked model, the captions adapter with a mocked provider, files, the menu,
  the red circle.
- `src/lib/__tests__/db/video.test.ts` (PGlite, the real migrations): who may
  do what through the routes, row level security for every role and anon, the
  triggers, the bucket's policies.
- The whole flow was run in Playwright on the demo (brief → Alti's draft →
  editor with the sample clips → a full-quality export → check → approval →
  hand-off → the Content piece in review), at 1440 and 390 px, in English and
  Spanish.

## What needs the owner

- Nothing to turn on for editing and exporting: it works on deploy.
- **Automatic captions**: set `TRANSCRIBE_API_KEY` (an OpenAI key; Whisper),
  knowing the clips' sound then goes to that provider. Off until then.
- `ANTHROPIC_API_KEY` for Alti to draft with Claude (templates otherwise).
- **License**: the export engine is FFmpeg built with libx264 (GPL), served
  unchanged from `@ffmpeg/core`. Serving it to the team's browsers is
  distribution; keep the package's license notice and point to its source
  (github.com/ffmpegwasm/ffmpeg.wasm) if counsel asks.
- Music: upload the tracks the company has licensed, with the licence noted.

## Not done yet

- Multi-track timelines, transitions, speed changes, keyframed zoom, and
  per-word caption highlighting: the editor is deliberately one track.
- Exports are rendered on one CPU core in the browser: a 60-second full-quality
  video takes several minutes, and older phones may not have the memory; use the
  quick draft or a computer. A multi-threaded core would need cross-origin
  isolation on the editor route.
- The Overview's Content card and the Today list don't list videos yet (the
  menu's red circle does).
- A clip the browser can't play (an iPhone HEVC .mov in Chrome) exports
  correctly but shows a placeholder in the preview.
