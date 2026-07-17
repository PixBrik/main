/*
 * Generates the compact colour grids used by the homepage before/after demo.
 *
 * The source photos stay as local assets. This script samples them at the
 * balanced portrait-panel width (52 studs), posterizes the result, and maps
 * every cell to a real solid colour from the parts catalog. The app renders
 * those cells as grouped SVG paths, so the preview is deterministic and
 * cheap even though it visibly contains 2,704 studs.
 *
 * Run from apps/mobile with:
 *   node scripts/generate-home-showcases.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const ASSET_DIR = path.join(ROOT, 'assets', 'home');
const OUTPUT = path.join(ROOT, 'src', 'data', 'homeShowcases.generated.ts');
const GRID = 52;
const CLUSTERS = 22;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

const SOURCES = [
  { id: 'portrait', file: 'portrait-source.png' },
  { id: 'pet', file: 'pet-source.png' },
  { id: 'car', file: 'car-source.png' },
];

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'brickCatalog.json'), 'utf8'));
const catalogColors = catalog.colors
  .filter((color) => !color.trans)
  .map((color) => ({ hex: color.rgb.toUpperCase(), rgb: hexToRgb(color.rgb) }));

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function colorDistance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}

function nearestCatalog(rgb) {
  let best = catalogColors[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of catalogColors) {
    const distance = colorDistance(rgb, candidate.rgb);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.hex;
}

function averageCells(png) {
  const result = [];
  for (let gridY = 0; gridY < GRID; gridY++) {
    const y0 = Math.floor((gridY * png.height) / GRID);
    const y1 = Math.max(y0 + 1, Math.floor(((gridY + 1) * png.height) / GRID));
    for (let gridX = 0; gridX < GRID; gridX++) {
      const x0 = Math.floor((gridX * png.width) / GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((gridX + 1) * png.width) / GRID));
      let red = 0;
      let green = 0;
      let blue = 0;
      let weight = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const index = (y * png.width + x) * 4;
          const alpha = png.data[index + 3] / 255;
          red += png.data[index] * alpha + 255 * (1 - alpha);
          green += png.data[index + 1] * alpha + 255 * (1 - alpha);
          blue += png.data[index + 2] * alpha + 255 * (1 - alpha);
          weight++;
        }
      }
      result.push([red / weight, green / weight, blue / weight]);
    }
  }
  return result;
}

function inlineFallback(png) {
  const size = 128;
  const preview = new PNG({ height: size, width: size });
  for (let targetY = 0; targetY < size; targetY++) {
    const sourceY = Math.min(png.height - 1, Math.floor(((targetY + 0.5) * png.height) / size));
    for (let targetX = 0; targetX < size; targetX++) {
      const sourceX = Math.min(png.width - 1, Math.floor(((targetX + 0.5) * png.width) / size));
      const sourceOffset = (sourceY * png.width + sourceX) * 4;
      const targetOffset = (targetY * size + targetX) * 4;
      preview.data[targetOffset] = png.data[sourceOffset];
      preview.data[targetOffset + 1] = png.data[sourceOffset + 1];
      preview.data[targetOffset + 2] = png.data[sourceOffset + 2];
      preview.data[targetOffset + 3] = png.data[sourceOffset + 3];
    }
  }
  return `data:image/png;base64,${PNG.sync.write(preview).toString('base64')}`;
}

function posterize(samples) {
  const byLuma = [...samples].sort(
    (a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11),
  );
  let centroids = Array.from({ length: CLUSTERS }, (_, index) => {
    const pick = byLuma[Math.floor(((index + 0.5) / CLUSTERS) * byLuma.length)];
    return [...pick];
  });
  const assignments = new Int32Array(samples.length);

  for (let iteration = 0; iteration < 8; iteration++) {
    for (let index = 0; index < samples.length; index++) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let cluster = 0; cluster < centroids.length; cluster++) {
        const distance = colorDistance(samples[index], centroids[cluster]);
        if (distance < bestDistance) {
          best = cluster;
          bestDistance = distance;
        }
      }
      assignments[index] = best;
    }

    const sums = Array.from({ length: centroids.length }, () => [0, 0, 0, 0]);
    for (let index = 0; index < samples.length; index++) {
      const sum = sums[assignments[index]];
      sum[0] += samples[index][0];
      sum[1] += samples[index][1];
      sum[2] += samples[index][2];
      sum[3]++;
    }
    centroids = centroids.map((old, index) => {
      const sum = sums[index];
      return sum[3] > 0 ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : old;
    });
  }

  const clusterColors = centroids.map(nearestCatalog);
  const palette = [...new Set(clusterColors)];
  if (palette.length > ALPHABET.length) throw new Error('Too many colours to encode');
  const paletteIndex = new Map(palette.map((hex, index) => [hex, index]));
  const rows = Array.from({ length: GRID }, (_, y) =>
    Array.from({ length: GRID }, (_, x) => {
      const cluster = assignments[y * GRID + x];
      return ALPHABET[paletteIndex.get(clusterColors[cluster])];
    }).join(''),
  );
  return { palette, rows };
}

const generated = {};
for (const source of SOURCES) {
  const input = path.join(ASSET_DIR, source.file);
  if (!fs.existsSync(input)) continue;
  const png = PNG.sync.read(fs.readFileSync(input));
  const samples = averageCells(png);
  generated[source.id] = { ...posterize(samples), fallbackUri: inlineFallback(png) };
}

const body = `/* This file is generated by scripts/generate-home-showcases.cjs. */\n` +
  `export const HOME_MOSAICS = ${JSON.stringify(generated, null, 2)} as const;\n` +
  `export const HOME_MOSAIC_GRID = ${GRID};\n` +
  `export const HOME_MOSAIC_ALPHABET = '${ALPHABET}';\n`;
fs.writeFileSync(OUTPUT, body);
console.log(`Generated ${Object.keys(generated).length} homepage mosaics at ${GRID}x${GRID}.`);
