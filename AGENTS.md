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
- Rendering is build-once + patch-in-place for the font toggles, study
  sheets, and choice grid (`data-built` / `data-prompt-key` guards). Never
  revert these to per-render `innerHTML`: rebuilding kills the CSS state
  transitions, re-triggers entrance animations mid-answer, and makes every
  keystroke re-render ~500 sheet buttons.
- One-shot feedback animations (font-toggle deny nudge, streak pop) run
  through `replayAttributeAnimation`, keyed to `data-deny` / `data-pop`.
- Aural keyboard paths: 1–6 pick choices (hints render only on
  hover-capable pointers), R replays the clip; Enter/Space advance during
  feedback, and R also replays the answer during feedback in both modes.
  The drill glyph itself is tap-to-hear (same hint rules as HEAR
  pre-answer; free replay during feedback). The prompt entrance animation
  is keyed to the alternating `data-prompt-motion` value and suppressed on
  the very first paint.
- Hover affordances live in one `@media (hover: hover) and (pointer: fine)`
  block near the end of `styles.css`; keep new hover rules there so touch
  devices never see them.

## Write drill notes

- Everything write-mode lives in `src/write/` and loads as one lazy chunk
  (`ensureWriteModuleLoaded` in `app.js`, mirroring the waveforms
  pattern) plus a ~120 KB int8 model fetched on demand. Never import
  `src/write/*` statically from the main bundle.
- `src/write/stroke-data.js` and `src/write/kanji-data.js` are GENERATED
  by `scripts/build-stroke-data.mjs` from the vendored KanjiVG SVGs — do
  not hand-edit; re-run the script.
- `ml/features.py` and `src/write/recognizer-features.js` implement the
  same feature spec; `tests/write-parity.test.js` pins them to golden
  vectors exported by `ml/export.py`. Changing either side requires a
  FEATURE_VERSION bump + retrain + re-export (see `ml/README.md`).
- Stroke grading semantics live in `write-session.js` (pure, tested) —
  the canvas controller (`write-drill.js`) only renders what the session
  decides. Homoglyph pairs (へ/ヘ, カ/力 …) ship in the model header and
  grade as each other; keep that list in `ml/homoglyphs.py`.
- New JP interface copy must stay kana-only: the font subsets carry no
  extra kanji. Kanji glyphs render as canvas strokes or standalone
  elements falling back to system JP fonts.
- The drawing canvas needs `touch-action: none` and pointer capture (both
  in place); per-stroke feedback must respond on pointerup, never on a
  timer. `prefers-reduced-motion` swaps every canvas animation for its
  end state.