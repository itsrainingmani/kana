import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { KANA_DATA } from '../src/kana-data.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUTPUT_DIR = process.env.KANA_AUDIO_SOURCE_DIR ?? resolve(tmpdir(), 'kana-audio-source-mp3');
const BASE_URL = 'https://kuuuube.github.io/kana-quiz-sounds/audio/0';

function uniqueAudioIds() {
  return [...new Set(KANA_DATA.map((kana) => kana.audioId))].filter(Boolean).sort();
}

async function download(id) {
  const response = await fetch(`${BASE_URL}/${id}.mp3`);

  if (!response.ok) {
    throw new Error(`Failed to download ${id}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(resolve(OUTPUT_DIR, `${id}.mp3`), Buffer.from(arrayBuffer));
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const id of uniqueAudioIds()) {
    await download(id);
  }
}

await main();
