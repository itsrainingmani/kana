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
- The default gothic face, Zen Kaku 700, and Plex Mono 400 are preloaded
  via `<link rel="preload">` in `index.html` so the first paint doesn't
  wait on CSS to discover them.
- `scripts/build-audio-assets.mjs` produces 100-bucket waveform data;
  the canvas renderer downsamples it to `WAVEFORM_BAR_COUNT` (36) chunky
  signage bars per the redesign, so the runtime resample stays cheap.
- UI fonts (Zen Kaku Gothic New, IBM Plex Mono) are subset woff2 files in
  `assets/fonts/` covering latin + kana + the UI kanji only. If new JP
  copy is added to the interface, the subsets must be regenerated
  (fontTools `pyftsubset`) or the glyphs will fall back to system fonts.

## Architecture notes

- The interaction region's `<input>` and choice grid are authored in
  `index.html` and must stay stable across re-renders — never rewrite
  `innerHTML` of `.interaction-card__body`, it destroys IME composition
  and caret position. See `renderInteraction` in `src/app.js`.
- `setVisibleState` toggles `disabled` on hidden form controls so the tab
  order does not leak into non-applicable drill modes.
- Flow rules (from the redesign): auto-advance fires only for unassisted
  correct answers (`advanceDelayMs`, default 800 ms); revealed/incorrect
  outcomes wait for NEXT / Enter / Space (document-level keydown, guarded
  by `root.isConnected`). Wrong typed prefixes never block — the field
  shakes and self-selects. `createApp(root, options)` accepts
  `autoAdvance`, `advanceDelayMs`, and `romajiCaptions` flags.
- The active mode paints `--mode-color` via `data-has-audio` on the drill
  card: vermillion for visual, metro blue for aural. Sheets are color-coded
  the same way via `data-kana-sheet`.