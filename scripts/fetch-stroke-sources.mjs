// Vendors the upstream sources for the write-mode stroke database:
//
//   ml/data/raw/kanjivg/<hex>.svg   KanjiVG stroke SVGs (CC BY-SA 3.0,
//                                   https://kanjivg.tagaini.net) pinned to
//                                   KANJIVG_TAG so re-runs are reproducible.
//   ml/data/raw/kanji-meta.json     Kyōiku grade 1+2 kanji metadata slimmed
//                                   from davidluzgouveia/kanji-data (KANJIDIC2,
//                                   EDRDG licence, CC BY-SA).
//
// Characters covered: every single-glyph kana in src/kana-data.js (combination
// digraphs are two glyphs and are not writing targets) plus all grade 1 and
// grade 2 kanji. Run `node scripts/build-stroke-data.mjs` afterwards to
// regenerate the derived stroke modules.
//
// Behind a corporate/agent proxy, run with NODE_USE_ENV_PROXY=1 so Node's
// fetch honours HTTPS_PROXY.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KANA_DATA } from '../src/kana-data.js';

const KANJIVG_TAG = 'r20240807';
const KANJIVG_HOSTS = [
  (hex) => `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@${KANJIVG_TAG}/kanji/${hex}.svg`,
  (hex) => `https://raw.githubusercontent.com/KanjiVG/kanjivg/${KANJIVG_TAG}/kanji/${hex}.svg`
];
const KANJI_META_URL =
  'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'ml', 'data', 'raw');
const SVG_DIR = path.join(RAW_DIR, 'kanjivg');
const META_PATH = path.join(RAW_DIR, 'kanji-meta.json');

const CONCURRENCY = 8;
const RETRIES = 3;

function hexForGlyph(glyph) {
  return glyph.codePointAt(0).toString(16).padStart(5, '0');
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithRetry(urls, label) {
  let lastError = null;

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          return await response.text();
        }
        lastError = new Error(`${label}: HTTP ${response.status} from ${url}`);
      } catch (error) {
        lastError = new Error(`${label}: ${error.message} (${url})`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }

  throw lastError;
}

async function fetchKanjiMeta() {
  if (await exists(META_PATH)) {
    console.log('kanji-meta.json already vendored, skipping');
    return JSON.parse(await readFile(META_PATH, 'utf8'));
  }

  console.log('fetching kanji metadata …');
  const raw = JSON.parse(await fetchWithRetry([KANJI_META_URL], 'kanji metadata'));
  const slim = {};

  for (const [glyph, info] of Object.entries(raw)) {
    if (info.grade !== 1 && info.grade !== 2) {
      continue;
    }

    slim[glyph] = {
      grade: info.grade,
      strokes: info.strokes,
      freq: info.freq ?? null,
      jlpt: info.jlpt_new ?? null,
      meanings: (info.meanings ?? []).slice(0, 3),
      kun: (info.readings_kun ?? []).slice(0, 3),
      on: (info.readings_on ?? []).slice(0, 3)
    };
  }

  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(META_PATH, `${JSON.stringify(slim, null, 1)}\n`);
  console.log(`kanji-meta.json written (${Object.keys(slim).length} kanji)`);
  return slim;
}

function collectGlyphs(kanjiMeta) {
  const kanaGlyphs = KANA_DATA.filter((kana) => [...kana.glyph].length === 1).map(
    (kana) => kana.glyph
  );
  const kanjiGlyphs = Object.keys(kanjiMeta);
  return [...new Set([...kanaGlyphs, ...kanjiGlyphs])];
}

async function fetchSvgs(glyphs) {
  await mkdir(SVG_DIR, { recursive: true });
  const queue = [...glyphs];
  const failures = [];
  let fetched = 0;
  let skipped = 0;

  async function worker() {
    while (queue.length > 0) {
      const glyph = queue.shift();
      const hex = hexForGlyph(glyph);
      const file = path.join(SVG_DIR, `${hex}.svg`);

      if (await exists(file)) {
        skipped += 1;
        continue;
      }

      try {
        const svg = await fetchWithRetry(
          KANJIVG_HOSTS.map((toUrl) => toUrl(hex)),
          `${glyph} (${hex})`
        );
        await writeFile(file, svg);
        fetched += 1;
        if (fetched % 50 === 0) {
          console.log(`  … ${fetched} fetched`);
        }
      } catch (error) {
        failures.push({ glyph, hex, message: error.message });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`SVGs: ${fetched} fetched, ${skipped} already vendored`);
  if (failures.length > 0) {
    console.error(`FAILED (${failures.length}):`);
    for (const failure of failures) {
      console.error(`  ${failure.glyph} ${failure.hex}: ${failure.message}`);
    }
    process.exitCode = 1;
  }
}

const kanjiMeta = await fetchKanjiMeta();
const glyphs = collectGlyphs(kanjiMeta);
console.log(`${glyphs.length} characters to vendor`);
await fetchSvgs(glyphs);
