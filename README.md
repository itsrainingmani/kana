# Kana Trainer

Mobile-first kana drill app built with plain HTML, CSS, and JavaScript —
Vite for dev/build, Cloudflare Workers (static assets) for hosting, no
framework runtime.

## Features

- **Visual drills** — see a kana, type the romaji (apters romaji as you
  type so partial input never advances unless it's truly wrong).
- **Aural drills** — listen to a clip, then pick the matching kana from
  six choices. Distinct homophones that share a recording
  (じ/ぢ, ず/づ) are graded as correct.
- **Kana sheets** — interactive hiragana/katakana reference with column
  toggles, check-all / clear-all per matrix, and tap-to-hear audio.
- **Progress memory** — per-kana attempts / correct / assisted / strong
  counts persisted in `localStorage`.
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
styles.css        poster-style layout + per-mode visibility states
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
with 100-bucket peak data so the canvas renderer skips the upsample step.
