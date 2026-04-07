# Kana Trainer

Mobile-first kana drill app built with plain HTML, CSS, and JavaScript.

Current v1 scope:
- kana to sound typing drills
- sound to kana listening drills
- collapsible session settings with row, group, script, and font selection
- grouped kana reference with lightweight mastery states
- local audio clip library

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

## Tests

```bash
npm test
npm run test:e2e
```

## Audio Assets

The deployable app only ships compressed clips in `audio/mp3` and `audio/opus`.

To regenerate them locally:

```bash
npm run audio:restore
npm run audio:build
```

`audio:restore` downloads the source `.mp3` files into a temp directory outside the repo by default. Set `KANA_AUDIO_SOURCE_DIR` if you want to reuse a different local source directory.
