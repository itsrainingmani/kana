# Kana Trainer

Mobile-first kana + kanji drill app built with plain HTML, CSS, and
JavaScript — Vite for dev/build, Cloudflare Workers (static assets) for
hosting, no framework runtime. Styled as a Tokyo Metro signage ×
Japanese magazine system: vermillion visual line, metro-blue aural line,
pine write line, bilingual JP/EN labels, and marubatsu (〇) grading.

## Features

- **Visual drills** — see a kana, type the romaji (grades romaji as you
  type so partial input never advances unless it's truly wrong; a wrong
  prefix shakes the field and selects the text for instant retyping).
- **Aural drills** — listen to a clip, then pick the matching kana from
  six choices. Distinct homophones that share a recording
  (じ/ぢ, ず/づ) are graded as correct. After answering, every choice
  captions its romaji and the target glyph is revealed.
- **Write drills (かく)** — draw kana and kyōiku grade 1–2 kanji with
  correct stroke order on a genkōyōshi-style canvas. Kana are dictated
  (romaji + audio), kanji prompted by meaning + readings. Every stroke
  is graded as it lands — wrong direction says ぎゃく, wrong order names
  the stroke that came too early — and assistance follows per-character
  mastery: traced ghost for new characters, guided feedback while shaky,
  free recall (そらがき) once strong. Recall drawings are recognized by
  an on-device ~120 KB int8 conv net (no ML runtime, no server; strokes
  never leave the page) with homoglyph-aware grading (へ/ヘ, カ/力 …),
  and every answer replays its canonical stroke order, sourced from
  KanjiVG.
- **Self-paced feedback** — auto-advance applies only to unassisted
  correct answers; revealed and incorrect outcomes wait for NEXT,
  Enter, or Space. Using Hear/Reveal shows an amber HINT chip before
  the answer is graded as assisted.
- **Kana sheets (五十音)** — interactive hiragana/katakana study sheets
  whose column headers are the 行 kana themselves, with ぜんぶ ALL /
  なし NONE per matrix and tap-to-hear audio on every kana.
- **Kanji sheets (漢字)** — kyōiku grade 1–2 kanji in curriculum-ordered
  groups of ten; tap a group to add it to the write drill.
- **Progress memory** — per-character attempts / correct / assisted /
  strong counts plus the current streak persisted in `localStorage`.
- **Five built-in font faces** — gothic, mincho, rounded, magic, dot;
  rotates between enabled fonts across prompts.

## Stack

- Vite 8 (dev server + production build)
- Vitest (jsdom) for unit tests, Playwright for e2e smoke
- Cloudflare Workers via Wrangler (`wrangler.jsonc` → `./dist`)
- No runtime npm dependencies

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

## Tests

```bash
npm test            # unit tests (Vitest + jsdom)
npm run test:e2e    # Playwright smoke (chromium + Pixel 5)
npm run verify      # unit + build; run before committing
```

## Deploy

```bash
npm run deploy          # vite build + wrangler deploy
npm run deploy:dry-run  # build + wrangler validate, no upload
```

## Project layout

```
src/
  app.js          drill UI controller — prompt + interaction + reference
  audio.js        clip map, source probing, single-active playback
  prompts.js      grader + prompt builders + selection matrix builders
  storage.js      session + progress stores (localStorage-backed)
  kana-data.js    hiragana/katakana dataset (base, dakuten, combination)
  waveforms.js    pre-bucketed audio peak data (lazy-loaded)
  main.js         entry point → createApp(document.querySelector('#app'))
  write/          write drill (lazy chunk: ~39 KB gz + 120 KB model)
    stroke-data.js         KanjiVG-derived stroke DB (generated)
    kanji-data.js          grade 1–2 kanji records (generated)
    stroke-engine.js       resampling + per-stroke grading verdicts
    write-session.js       per-prompt state machine (tiers, outcomes)
    write-drill.js         canvas controller: ink, animations, hints
    write-data.js          prompt pool, kanji groups, cue formatting
    recognizer-features.js 8-direction + endpoint feature rasterizer
    recognizer.js          KWM1 int8 model loader + conv forward pass
assets/models/    kana-writer.bin — int8 recognizer (see ml/)
ml/               training pipeline (Python; see ml/README.md)
index.html        authored scaffold; JS only enhances, never replaces
styles.css        signage-style design system + per-mode visibility states
audio/            opus + mp3 clips (generated)
scripts/          audio assets + fetch-stroke-sources + build-stroke-data
tests/            Vitest unit tests + Playwright e2e
```

## Audio assets

The deployable app ships compressed clips in `audio/mp3` and `audio/opus`.
Regenerate them locally with `ffmpeg` + `ffprobe` on PATH:

```bash
npm run audio:restore     # fetch source mp3s into a temp dir
npm run audio:build       # re-encode opus/mp3 + rebuild src/waveforms.js
```

`audio:restore` writes the source `.mp3` files into a temp directory
outside the repo by default. Set `KANA_AUDIO_SOURCE_DIR` to reuse a local
source directory. Rebuilding audio also refreshes `src/waveforms.js`
with 100-bucket peak data; the canvas renderer downsamples it to the
36 signage-style bars of the aural stage.

## Fonts

All type is self-hosted in `assets/fonts/`: five kana display subsets
(Noto Sans/Serif JP, Zen Maru Gothic, Yusei Magic, DotGothic16) for the
rotating drill faces, plus UI subsets of Zen Kaku Gothic New
(400/500/700/900) and IBM Plex Mono (400/500/600) covering latin, kana,
and the handful of kanji the interface uses. New JP interface copy must
stay kana-only (or the subsets must be regenerated); kanji from the
write drill render either as canvas strokes or as standalone glyphs via
system JP fonts.

## Stroke data + recognizer

The write drill's stroke database derives from
[KanjiVG](https://kanjivg.tagaini.net) (© Ulrich Apel, CC BY-SA 3.0),
pinned to release r20240807; kanji meanings/readings come from KANJIDIC2
(© EDRDG) via davidluzgouveia/kanji-data. To re-vendor and regenerate:

```bash
node scripts/fetch-stroke-sources.mjs   # vendors SVGs + metadata into ml/data/raw
node scripts/build-stroke-data.mjs      # regenerates src/write/{stroke,kanji}-data.js
```

The handwriting recognizer is a ~116K-parameter conv net over 8-direction
stroke feature maps, trained on synthetic handwriting generated from the
KanjiVG polylines and shipped as per-channel int8 weights in a single
binary (`assets/models/kana-writer.bin`) with a hand-written JS forward
pass — no ONNX/TF runtime. Training pipeline and export format live in
`ml/` (see `ml/README.md`). Characters that are visually identical
(へ/ヘ, ニ/二, カ/力 …) are grouped as homoglyphs in the model header and
grade as each other.
