# "Escuchar": the read-aloud voice

Many clients prefer listening to reading. Every important text in the client
app has an **Escuchar** button (`src/components/SpeakButton.tsx`): Home's
status sentence, "Mi caso", each item explanation in the review, each letter's
"en palabras simples" summary, each lesson in "Aprende", the calculators'
results, and AltiBot's chat messages.

## How it works today

`src/lib/voice/index.ts` defines a small interface, `VoiceAdapter`, and one
implementation, `browserVoice`: the phone's own speech engine (Web Speech
API). It costs nothing, works offline, reads in the app's language (`es-US` or
`en-US`) a little slower than normal, and sends nothing anywhere. Emoji and
symbols are stripped before reading (`speechText`).

`SpeakButton` asks `voiceFor(locale, speaker)` for a voice and stops any other
reading first, so only one thing is read at a time.

## Adding a brand voice later

The brand kit has voice reference recordings for **Alti** and **AltiBot**. No
provider is wired in. To add one:

1. Write an adapter that implements `VoiceAdapter` (`id`, `isAvailable`,
   `canSpeak(locale, speaker)`, `speak(text, options)`, `stop`). A synthetic
   voice would call a server route that holds the provider's key; the key must
   never reach the browser.
2. Register it once at start-up with `registerVoice(adapter)`. It is tried
   before the browser voice; when it cannot speak (offline, unsupported
   language), the browser voice reads instead.
3. Decide per speaker. Every button says whose words it reads:
   - `assistant`: AltiBot's words (his chat messages, the lessons he presents).
     His voice may read these. The screen still says he is AI.
   - `team`: the app speaking for the team as a whole. Alti's voice may read
     these.
   - `neutral`: plain app text (status, timeline, results).
   A message a real teammate wrote is read as `neutral`, never in Alti's voice:
   Alti never speaks for a particular person (docs/BRAND.md).
4. Rules that hold for any adapter: read exactly the text given (no rewording,
   summarising or additions: the text on screen passed the claim rules), and
   never present a synthetic voice as a person speaking live.
