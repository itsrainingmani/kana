import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KANA_DATA } from '../src/kana-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const labels = KANA_DATA.filter((kana) => kana.group !== 'combination').map((kana) => ({
  id: kana.id,
  glyph: kana.glyph,
  romaji: kana.romaji,
  script: kana.script,
  group: kana.group
}));

const output = `${JSON.stringify(labels, null, 2)}\n`;

await mkdir(path.join(root, 'ml'), { recursive: true });
await mkdir(path.join(root, 'public', 'models'), { recursive: true });

await Promise.all([
  writeFile(path.join(root, 'ml', 'labels.json'), output, 'utf8'),
  writeFile(path.join(root, 'public', 'models', 'kana-labels.json'), output, 'utf8')
]);
