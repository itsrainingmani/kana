# Kana Trainer

Mobile-first kana drill app built with plain HTML, CSS, and JavaScript —
Vite for dev/build, Cloudflare Workers (static assets) for hosting, no
framework runtime. Styled as a Tokyo Metro signage × Japanese magazine
system: vermillion visual line, metro-blue aural line, bilingual JP/EN
labels, and marubatsu (〇) grading.

## Features

- **Visual drills** — see a kana, type the romaji (grades romaji as you
  type so partial input never advances unless it's truly wrong; a wrong
  prefix shakes the field and selects the text for instant retyping).
- **Aural drills** — listen to a clip, then pick the matching kana from
  six choices. Distinct homophones that share a recording
  (じ/ぢ, ず/づ) are graded as correct. After answering, every choice
  captions its romaji and the target glyph is revealed.
- **Self-paced feedback** — auto-advance applies only to unassisted
  correct answers; revealed and incorrect outcomes wait for NEXT,
  Enter, or Space. Using Hear/Reveal shows an amber HINT chip before
  the answer is graded as assisted.
- **Kana sheets (五十音)** — interactive hiragana/katakana study sheets
  whose column headers are the 行 kana themselves, with ぜんぶ ALL /
  なし NONE per matrix and tap-to-hear audio on every kana.
- **Progress memory** — per-kana attempts / correct / assisted / strong
  counts plus the current streak persisted in `localStorage`.
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
index.html        authored scaffold; JS only enhances, never replaces
styles.css        signage-style design system + per-mode visibility states
audio/            opus + mp3 clips (generated)
scripts/          build-audio-assets.mjs, restore-audio-sources.mjs
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
and the handful of kanji the interface uses.
