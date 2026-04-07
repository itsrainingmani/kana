import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { KANA_DATA } from '../src/kana-data.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const AUDIO_DIR = resolve(ROOT, 'audio');
const SOURCE_DIR = process.env.KANA_AUDIO_SOURCE_DIR ?? resolve(tmpdir(), 'kana-audio-source-mp3');
const OPUS_DIR = resolve(AUDIO_DIR, 'opus');
const MP3_DIR = resolve(AUDIO_DIR, 'mp3');
const WAVEFORM_MODULE = resolve(ROOT, 'src', 'waveforms.js');
const SAMPLE_RATE = '8000';
const WAVEFORM_BUCKETS = 64;

function uniqueAudioIds() {
  return [...new Set(KANA_DATA.map((kana) => kana.audioId))].filter(Boolean).sort();
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options
  });
}

function readDurationMs(sourcePath) {
  const output = run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    sourcePath
  ], { encoding: 'utf8' });

  return Math.round(Number.parseFloat(output.trim()) * 1000);
}

function readPcmFloats(sourcePath) {
  const buffer = run('ffmpeg', [
    '-i',
    sourcePath,
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    '-ac',
    '1',
    '-ar',
    SAMPLE_RATE,
    'pipe:1'
  ], { encoding: 'buffer' });

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const values = [];

  for (let index = 0; index < buffer.byteLength; index += 4) {
    values.push(view.getFloat32(index, true));
  }

  return values;
}

function bucketizeWaveform(samples, bucketCount) {
  if (samples.length === 0) {
    return Array.from({ length: bucketCount }, () => 12);
  }

  const globalPeak = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) || 1;
  const values = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const start = Math.floor((index / bucketCount) * samples.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / bucketCount) * samples.length));
    let bucketPeak = 0;

    for (let offset = start; offset < end; offset += 1) {
      bucketPeak = Math.max(bucketPeak, Math.abs(samples[offset]));
    }

    values.push(Math.max(12, Math.round((bucketPeak / globalPeak) * 100)));
  }

  return values;
}

function encodeAudioVariants(id) {
  const sourcePath = resolve(SOURCE_DIR, `${id}.mp3`);
  const opusPath = resolve(OPUS_DIR, `${id}.ogg`);
  const mp3Path = resolve(MP3_DIR, `${id}.mp3`);

  if (!existsSync(sourcePath)) {
    throw new Error(
      `Missing source audio for "${id}" at ${sourcePath}. Run "npm run audio:restore" first or set KANA_AUDIO_SOURCE_DIR.`
    );
  }

  run('ffmpeg', [
    '-y',
    '-i',
    sourcePath,
    '-ac',
    '1',
    '-ar',
    '24000',
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    opusPath
  ]);

  run('ffmpeg', [
    '-y',
    '-i',
    sourcePath,
    '-ac',
    '1',
    '-ar',
    '24000',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '48k',
    mp3Path
  ]);

  const duration = readDurationMs(sourcePath);
  const samples = readPcmFloats(sourcePath);

  return {
    d: duration,
    v: bucketizeWaveform(samples, WAVEFORM_BUCKETS)
  };
}

function main() {
  mkdirSync(OPUS_DIR, { recursive: true });
  mkdirSync(MP3_DIR, { recursive: true });

  const waveforms = {};

  for (const id of uniqueAudioIds()) {
    waveforms[id] = encodeAudioVariants(id);
  }

  writeFileSync(WAVEFORM_MODULE, `export const WAVEFORM_DATA = ${JSON.stringify(waveforms)};\n`);
}

main();
