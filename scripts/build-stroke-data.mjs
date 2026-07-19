// Derives the write-mode stroke databases from the vendored KanjiVG SVGs
// (see scripts/fetch-stroke-sources.mjs):
//
//   ml/data/strokes.json        full-fidelity polylines (training input)
//   src/write/stroke-data.js    quantized + simplified polylines (app runtime)
//   src/write/kanji-data.js     kanji prompt records (meaning/readings/grade)
//
// KanjiVG paths are stroke centerlines in a 109×109 viewBox, one <path> per
// stroke, document order = correct stroke order. Cubic/quadratic segments are
// flattened adaptively; the app copy is Ramer-Douglas-Peucker simplified and
// quantized to the integer grid, which the canvas renderer re-smooths with
// midpoint quadratics.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KANA_DATA } from '../src/kana-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG_DIR = path.join(ROOT, 'ml', 'data', 'raw', 'kanjivg');
const META_PATH = path.join(ROOT, 'ml', 'data', 'raw', 'kanji-meta.json');
const TRAIN_OUT = path.join(ROOT, 'ml', 'data', 'strokes.json');
const APP_DIR = path.join(ROOT, 'src', 'write');

const KANJIVG_TAG = 'r20240807';
const GRID = 109;
const FLATTEN_TOLERANCE = 0.2;
const APP_RDP_TOLERANCE = 0.85;

// ---------------------------------------------------------------------------
// SVG path parsing

function tokenizeNumbers(chunk) {
  const matches = chunk.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi);
  return matches ? matches.map(Number) : [];
}

function parsePathCommands(d) {
  const commands = [];
  const pattern = /([MmLlHhVvCcSsQqTtZzAa])([^MmLlHhVvCcSsQqTtZzAa]*)/g;
  let match;

  while ((match = pattern.exec(d)) !== null) {
    commands.push({ op: match[1], args: tokenizeNumbers(match[2]) });
  }

  return commands;
}

function flattenCubic(p0, p1, p2, p3, tolerance, out, depth = 0) {
  // Flatness: max distance of control points from the chord.
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const d1 = Math.abs((p1[0] - p3[0]) * dy - (p1[1] - p3[1]) * dx);
  const d2 = Math.abs((p2[0] - p3[0]) * dy - (p2[1] - p3[1]) * dx);
  const chord = Math.hypot(dx, dy) || 1e-9;

  if (depth > 16 || (d1 + d2) / chord < tolerance) {
    out.push(p3);
    return;
  }

  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);

  flattenCubic(p0, p01, p012, p0123, tolerance, out, depth + 1);
  flattenCubic(p0123, p123, p23, p3, tolerance, out, depth + 1);
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pathToPolyline(d, tolerance = FLATTEN_TOLERANCE) {
  const commands = parsePathCommands(d);
  const points = [];
  let current = [0, 0];
  let start = [0, 0];
  let prevCubicControl = null;
  let prevQuadControl = null;

  const push = (point) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-6) {
      points.push(point);
    }
  };

  for (const { op, args } of commands) {
    const isRelative = op === op.toLowerCase();
    const upper = op.toUpperCase();

    if (upper === 'A') {
      throw new Error('Arc commands are not expected in KanjiVG paths');
    }

    if (upper === 'Z') {
      push(start);
      current = start;
      prevCubicControl = null;
      prevQuadControl = null;
      continue;
    }

    const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 }[upper];

    for (let index = 0; index + arity <= args.length; index += arity) {
      const slice = args.slice(index, index + arity);

      if (upper === 'M' || upper === 'L') {
        const target = isRelative
          ? [current[0] + slice[0], current[1] + slice[1]]
          : [slice[0], slice[1]];
        // An M with extra coordinate pairs treats the rest as implicit lines.
        if (upper === 'M' && index === 0) {
          start = target;
          if (points.length === 0) {
            points.push(target);
          } else {
            push(target);
          }
        } else {
          push(target);
        }
        current = target;
        prevCubicControl = null;
        prevQuadControl = null;
      } else if (upper === 'H' || upper === 'V') {
        const target =
          upper === 'H'
            ? [isRelative ? current[0] + slice[0] : slice[0], current[1]]
            : [current[0], isRelative ? current[1] + slice[0] : slice[0]];
        push(target);
        current = target;
        prevCubicControl = null;
        prevQuadControl = null;
      } else if (upper === 'C' || upper === 'S') {
        let c1;
        let c2;
        let end;

        if (upper === 'C') {
          c1 = isRelative ? [current[0] + slice[0], current[1] + slice[1]] : [slice[0], slice[1]];
          c2 = isRelative ? [current[0] + slice[2], current[1] + slice[3]] : [slice[2], slice[3]];
          end = isRelative ? [current[0] + slice[4], current[1] + slice[5]] : [slice[4], slice[5]];
        } else {
          c1 = prevCubicControl
            ? [2 * current[0] - prevCubicControl[0], 2 * current[1] - prevCubicControl[1]]
            : current;
          c2 = isRelative ? [current[0] + slice[0], current[1] + slice[1]] : [slice[0], slice[1]];
          end = isRelative ? [current[0] + slice[2], current[1] + slice[3]] : [slice[2], slice[3]];
        }

        flattenCubic(current, c1, c2, end, tolerance, points);
        current = end;
        prevCubicControl = c2;
        prevQuadControl = null;
      } else if (upper === 'Q' || upper === 'T') {
        let control;
        let end;

        if (upper === 'Q') {
          control = isRelative
            ? [current[0] + slice[0], current[1] + slice[1]]
            : [slice[0], slice[1]];
          end = isRelative ? [current[0] + slice[2], current[1] + slice[3]] : [slice[2], slice[3]];
        } else {
          control = prevQuadControl
            ? [2 * current[0] - prevQuadControl[0], 2 * current[1] - prevQuadControl[1]]
            : current;
          end = isRelative ? [current[0] + slice[0], current[1] + slice[1]] : [slice[0], slice[1]];
        }

        // Promote the quadratic to a cubic and reuse the same flattener.
        const c1 = [
          current[0] + (2 / 3) * (control[0] - current[0]),
          current[1] + (2 / 3) * (control[1] - current[1])
        ];
        const c2 = [
          end[0] + (2 / 3) * (control[0] - end[0]),
          end[1] + (2 / 3) * (control[1] - end[1])
        ];
        flattenCubic(current, c1, c2, end, tolerance, points);
        current = end;
        prevQuadControl = control;
        prevCubicControl = null;
      }
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Simplification

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lengthSquared)
  );
  return Math.hypot(point[0] - (lineStart[0] + t * dx), point[1] - (lineStart[1] + t * dy));
}

function simplifyRdp(points, tolerance) {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let maxIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[points.length - 1]];
  }

  const left = simplifyRdp(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyRdp(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

// ---------------------------------------------------------------------------
// SVG file handling

function extractStrokePaths(svg) {
  // Every <path> in a KanjiVG file is a stroke (stroke numbers are <text>).
  // Sort by the -s<N> id suffix as a belt-and-braces ordering guarantee.
  const entries = [];
  const pattern = /<path[^>]*\bid="[^"]*-s(\d+)"[^>]*\bd="([^"]+)"|<path[^>]*\bd="([^"]+)"[^>]*\bid="[^"]*-s(\d+)"/g;
  let match;

  while ((match = pattern.exec(svg)) !== null) {
    const order = Number(match[1] ?? match[4]);
    const d = match[2] ?? match[3];
    entries.push({ order, d });
  }

  entries.sort((a, b) => a.order - b.order);
  return entries.map((entry) => entry.d);
}

function hexForGlyph(glyph) {
  return glyph.codePointAt(0).toString(16).padStart(5, '0');
}

// ---------------------------------------------------------------------------
// Kanji display formatting

function formatKunReading(reading) {
  const cleaned = reading.replace(/^-+|-+$/g, '');
  const [base, okurigana] = cleaned.split('.');
  return okurigana ? `${base}（${okurigana}）` : base;
}

function titleCase(meaning) {
  return meaning.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Main

const kanjiMeta = JSON.parse(await readFile(META_PATH, 'utf8'));
const kanaGlyphs = KANA_DATA.filter((kana) => [...kana.glyph].length === 1).map(
  (kana) => kana.glyph
);
const kanjiGlyphs = Object.keys(kanjiMeta).sort((a, b) => {
  const infoA = kanjiMeta[a];
  const infoB = kanjiMeta[b];
  if (infoA.grade !== infoB.grade) {
    return infoA.grade - infoB.grade;
  }
  const freqA = infoA.freq ?? Number.MAX_SAFE_INTEGER;
  const freqB = infoB.freq ?? Number.MAX_SAFE_INTEGER;
  if (freqA !== freqB) {
    return freqA - freqB;
  }
  return a.codePointAt(0) - b.codePointAt(0);
});

const glyphs = [...new Set([...kanaGlyphs, ...kanjiGlyphs])];
const available = new Set(await readdir(SVG_DIR));

const trainingChars = {};
const appEntries = [];
const problems = [];

for (const glyph of glyphs) {
  const hex = hexForGlyph(glyph);
  const filename = `${hex}.svg`;

  if (!available.has(filename)) {
    problems.push(`${glyph}: missing ${filename}`);
    continue;
  }

  const svg = await readFile(path.join(SVG_DIR, filename), 'utf8');
  const ds = extractStrokePaths(svg);

  if (ds.length === 0) {
    problems.push(`${glyph}: no stroke paths found`);
    continue;
  }

  const fine = ds.map((d) => pathToPolyline(d));
  trainingChars[glyph] = fine.map((stroke) =>
    stroke.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100])
  );

  const coarse = fine.map((stroke) => {
    const simplified = simplifyRdp(stroke, APP_RDP_TOLERANCE);
    const flat = [];
    for (const [x, y] of simplified) {
      flat.push(
        Math.max(0, Math.min(GRID - 1, Math.round(x))),
        Math.max(0, Math.min(GRID - 1, Math.round(y)))
      );
    }
    return flat;
  });
  appEntries.push([glyph, coarse]);
}

if (problems.length > 0) {
  console.error('PROBLEMS:');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

// Expected stroke counts: KANJIDIC and KanjiVG should agree for kanji.
for (const [glyph, info] of Object.entries(kanjiMeta)) {
  const got = trainingChars[glyph]?.length ?? 0;
  if (info.strokes !== got) {
    console.warn(`stroke count mismatch ${glyph}: kanjidic=${info.strokes} kanjivg=${got}`);
  }
}

await mkdir(path.dirname(TRAIN_OUT), { recursive: true });
await writeFile(
  TRAIN_OUT,
  `${JSON.stringify({ version: KANJIVG_TAG, grid: GRID, chars: trainingChars })}\n`
);

await mkdir(APP_DIR, { recursive: true });

const strokeLines = appEntries.map(
  ([glyph, strokes]) => `  ${JSON.stringify(glyph)}: ${JSON.stringify(strokes)}`
);
const strokeModule = `// GENERATED by scripts/build-stroke-data.mjs — do not edit.
// Stroke centerline polylines derived from KanjiVG ${KANJIVG_TAG}
// (© Ulrich Apel, CC BY-SA 3.0, https://kanjivg.tagaini.net), quantized to
// the integer 0..${GRID - 1} grid and simplified for rendering + grading.
// Point layout per stroke: [x0, y0, x1, y1, …] in drawing order.

export const STROKE_GRID = ${GRID};

export const STROKE_DATA = {
${strokeLines.join(',\n')}
};
`;
await writeFile(path.join(APP_DIR, 'stroke-data.js'), strokeModule);

const kanjiRecords = kanjiGlyphs.map((glyph) => {
  const info = kanjiMeta[glyph];
  return {
    id: `kj-${glyph}`,
    glyph,
    script: 'kanji',
    grade: info.grade,
    meaning: titleCase(info.meanings[0] ?? ''),
    meanings: info.meanings.map(titleCase),
    kun: info.kun.map(formatKunReading),
    on: info.on,
    strokeCount: trainingChars[glyph].length
  };
});

const kanjiModule = `// GENERATED by scripts/build-stroke-data.mjs — do not edit.
// Kyōiku grade 1+2 kanji prompt records. Meanings/readings from KANJIDIC2
// via davidluzgouveia/kanji-data (© EDRDG, CC BY-SA), ordered by grade then
// newspaper frequency.

export const KANJI_DATA = [
${kanjiRecords.map((record) => `  ${JSON.stringify(record)}`).join(',\n')}
];
`;
await writeFile(path.join(APP_DIR, 'kanji-data.js'), kanjiModule);

const strokeBytes = Buffer.byteLength(strokeModule);
const kanjiBytes = Buffer.byteLength(kanjiModule);
const totalPoints = appEntries.reduce(
  (sum, [, strokes]) => sum + strokes.reduce((s, stroke) => s + stroke.length / 2, 0),
  0
);
console.log(
  `stroke-data.js: ${appEntries.length} chars, ${totalPoints} points, ${(strokeBytes / 1024).toFixed(1)} KB`
);
console.log(`kanji-data.js: ${kanjiRecords.length} records, ${(kanjiBytes / 1024).toFixed(1)} KB`);
console.log(`strokes.json: written for training`);
