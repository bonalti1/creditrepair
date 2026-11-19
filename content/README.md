# Content kit: ads that stay on brand and inside the rules

Everything needed to make a CreditCapi video ad the same way every time. It is
written to be lifted into ALTO Control later: plain data files plus four small
scripts, no dependency on the web app except the claim rules.

## What is locked

| What | Where | Notes |
| --- | --- | --- |
| Capi's look, wardrobe, size and manner | `brand/lock.json` → `character` | Written into every generation request. |
| Capi's reference stills | `brand/capi-reference-closeup.jpg`, `brand/capi-reference-wide.jpg` | Every new shot starts from one of these. The Higgsfield job ids are in `lock.json`. |
| Film look | `brand/lock.json` → `look` | Photoreal, 35mm, golden light, locked-off camera. |
| Models and cost | `brand/lock.json` → `models` | Stills: GPT Image 2.6, 2.75 credits each. Video: Gemini Omni Flash 1.2 at 1080p, 3.25 credits per second. |
| Captions and end card | `brand/lock.json` → `captions`, `endCard` | Drawn by code in the brand font. Free. |
| Capi's voice | `brand/lock.json` → `voice` | **Not locked yet.** The video model invents the voice on each render. Pick one before publishing at volume. |

## A spot is a data file

`spots/mecanico.json` is the 15-second mechanic ad: the spoken lines, each
shot's framing and action, the trim points and the caption timings. To make a
new ad, copy it and change the words.

## The four steps

```bash
# 1. The gate. Claim rules on every spoken line, caption and end-card line,
#    plus consistency checks. Also runs in CI for every spot in the repo.
npm run content:check

# 2. The generation requests: one still and one clip per shot, with the locked
#    character and look written in. Refuses a spot that fails step 1.
npm run content:prompts mecanico

# 3. Generate. Today this is done by an agent with the Higgsfield connector,
#    using the output of step 2: still first (from the locked reference), then
#    the clip from that still. Save the clips as <clips>/<shot.file>.

# 4. Assemble: trim, join, burn in captions, end card, chime, loudness.
npm run content:assemble mecanico -- --clips ./clips --out ./out/mecanico-9x16.mp4

# 5. Check the words. Transcribes the result and compares it with the script.
python3 content/pipeline/transcribe.py ./out/mecanico-9x16.mp4 content/spots/mecanico.json --model ./sherpa-onnx-whisper-small
```

Step 4 needs `ffmpeg` and Playwright. Step 5 needs `sherpa-onnx` and the
Whisper small model (setup is in the script's header).

## Rules that are enforced, not remembered

- **No outcome promises.** `checkMarketingCopy` in `src/lib/compliance/guardrails.ts`
  blocks "te voy a arreglar tu crédito", "aumenta tu puntaje", "para que vayas
  por el carro…" and the rest. The commercial's first-draft punchline is a test
  case that must stay blocked.
- **Captions say what is spoken.** A caption that adds a claim fails the check.
- **Every spoken line is directed.** A line not written into a shot's action
  fails the check, because the video model would improvise it.

## What still needs a person

- Watching the result with sound on. The transcript check covers words, not
  accent, tone or whether a gag lands.
- Approving anything before it is published or put behind ad spend.
- Choosing Capi's voice.

## Cheap testing

Most of an ad's performance is decided in the first three seconds. Re-cutting
the same clips with a different opening caption or trim costs no credits: copy
the spot file, change `captions` and `in`/`out`, run step 4 again.
