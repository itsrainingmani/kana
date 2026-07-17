# Kana Trainer — agents' guide

## Commands

- `npm run dev` — local dev server at http://127.0.0.1:4173
- `npm run build` — production build to `dist/`
- `npm test` — unit tests via Vitest (jsdom). Run after any source change.
- `npm run test:e2e` — Playwright smoke tests (chromium + Pixel 5 viewport).
- `npm run verify` — runs both `vitest run` and `vite build`. **Run this before committing.**

## Testing notes

- Node 22+ ships an experimental `localStorage` global that shadows jsdom's.
  `tests/setup.js` provides a jsdom-backed shim; do not remove.
- `tests/app-shell.test.js` reads the live `<main>` markup from
  `index.html` so its assertions stay in sync with the authored scaffold.
- When adding new kana (especially homophones like じ/ぢ, ず/づ), the grader
  treats any option with a matching `audioId` as correct (see
  `src/prompts.js` → `gradeSoundToKanaAnswer`).

## Performance notes

- `src/waveforms.js` (~22 KB of pre-bucketed audio peaks) is loaded via a
  dynamic `import()` only the first time the aural mode is entered. Keep
  that path lazy; static imports of it balloon the initial JS payload.
- The default gothic face is preloaded via `<link rel="preload">` in
  `index.html` so the first paint doesn't wait on CSS to discover it.
- `scripts/build-audio-assets.mjs` now produces 100-bucket waveform data
  to match the canvas renderer's bucket count exactly; rebuilding audio
  (`npm run audio:restore && npm run audio:build`) lets the runtime skip
  the upsample step.

## Architecture notes

- The interaction region's `<input>` and choice grid are authored in
  `index.html` and must stay stable across re-renders — never rewrite
  `innerHTML` of `.interaction-card__body`, it destroys IME composition
  and caret position. See `renderInteraction` in `src/app.js`.
- `setVisibleState` toggles `disabled` on hidden form controls so the tab
  order does not leak into non-applicable drill modes.