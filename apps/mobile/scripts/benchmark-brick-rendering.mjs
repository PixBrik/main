import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const catalog = require('../src/data/brickCatalog.json');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFlag = process.argv.indexOf('--output');
const outputDir = path.resolve(
  outputFlag >= 0 && process.argv[outputFlag + 1]
    ? process.argv[outputFlag + 1]
    : path.join(tmpdir(), 'pixbrik-brick-quality'),
);
const compileDir = await mkdtemp(path.join(tmpdir(), 'pixbrik-render-benchmark-'));
const tsc = path.join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const grid = 68;
const captureAspect = 5 / 6;
const tileSize = 336;

const subjects = [
  { file: 'portrait-source.png', id: 'portrait' },
  { file: 'pet-source.png', id: 'pet' },
  { file: 'car-source.png', id: 'car' },
];
const styles = ['classic', 'sepia', 'natural'];
const profiles = ['efficient', 'balanced', 'detailed'];
const catalogParts = new Map(
  [...catalog.bricks, ...(catalog.slopes ?? [])].map((part) => [part.part, part]),
);

function luma([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hexRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function correlation(first, second) {
  if (!first.length || first.length !== second.length) return 0;
  const meanA = first.reduce((sum, value) => sum + value, 0) / first.length;
  const meanB = second.reduce((sum, value) => sum + value, 0) / second.length;
  let numerator = 0;
  let squareA = 0;
  let squareB = 0;
  for (let index = 0; index < first.length; index++) {
    const a = first[index] - meanA;
    const b = second[index] - meanB;
    numerator += a * b;
    squareA += a * a;
    squareB += b * b;
  }
  return numerator / Math.max(Math.sqrt(squareA * squareB), 1e-9);
}

function gradients(values, width, height) {
  const result = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx, dy) => values[(y + dy) * width + x + dx];
      const gx =
        -at(-1, -1) + at(1, -1) - 2 * at(-1, 0) + 2 * at(1, 0) - at(-1, 1) + at(1, 1);
      const gy =
        -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
      result.push(Math.hypot(gx, gy));
    }
  }
  return result;
}

function sampleCrop(png) {
  const cropHeight = png.height;
  const cropWidth = Math.min(png.width, Math.round(cropHeight * captureAspect));
  const cropX = Math.floor((png.width - cropWidth) / 2);
  const colors = [];
  for (let gy = 0; gy < grid; gy++) {
    const y0 = Math.floor((gy * cropHeight) / grid);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * cropHeight) / grid));
    for (let gx = 0; gx < grid; gx++) {
      const x0 = cropX + Math.floor((gx * cropWidth) / grid);
      const x1 = cropX + Math.max(
        Math.floor(((gx + 1) * cropWidth) / grid),
        Math.floor((gx * cropWidth) / grid) + 1,
      );
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const offset = (y * png.width + x) * 4;
          const alpha = png.data[offset + 3] / 255;
          r += png.data[offset] * alpha + 255 * (1 - alpha);
          g += png.data[offset + 1] * alpha + 255 * (1 - alpha);
          b += png.data[offset + 2] * alpha + 255 * (1 - alpha);
          count++;
        }
      }
      colors.push([r / count, g / count, b / count]);
    }
  }
  return {
    colors,
    crop: { height: cropHeight, width: cropWidth, x: cropX, y: 0 },
    segmentation: {
      aspectRatio: captureAspect,
      colors,
      coverage: 1,
      grid,
      mask: new Array(grid * grid).fill(true),
      region: { height: 1, width: captureAspect, x: (1 - captureAspect) / 2, y: 0 },
    },
  };
}

function frontGrid(model) {
  let minI = Infinity;
  let maxI = -Infinity;
  let minJ = Infinity;
  let maxJ = -Infinity;
  const front = new Map();
  for (const cell of model.cells) {
    minI = Math.min(minI, cell.i);
    maxI = Math.max(maxI, cell.i);
    minJ = Math.min(minJ, cell.j);
    maxJ = Math.max(maxJ, cell.j);
    const key = `${cell.i}|${cell.j}`;
    const current = front.get(key);
    if (!current || cell.k > current.k) front.set(key, cell);
  }
  const width = maxI - minI + 1;
  const height = maxJ - minJ + 1;
  const pixels = new Array(width * height).fill(null);
  for (const cell of front.values()) {
    const x = cell.i - minI;
    const y = maxJ - cell.j;
    pixels[y * width + x] = hexRgb(cell.colorHex ?? '#9BA19D');
  }
  return { height, pixels, width };
}

function modelHash(model) {
  const hash = createHash('sha256');
  for (const cell of model.cells) {
    hash.update(`${cell.i},${cell.j},${cell.k},${cell.colorHex ?? ''};`);
  }
  return hash.digest('hex');
}

function resampleSource(colors, targetWidth, targetHeight) {
  const result = [];
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(grid - 1, Math.floor(((y + 0.5) * grid) / targetHeight));
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(grid - 1, Math.floor(((x + 0.5) * grid) / targetWidth));
      result.push(colors[sourceY * grid + sourceX]);
    }
  }
  return result;
}

function setPixel(png, x, y, [r, g, b], alpha = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (y * png.width + x) * 4;
  png.data[offset] = Math.round(r);
  png.data[offset + 1] = Math.round(g);
  png.data[offset + 2] = Math.round(b);
  png.data[offset + 3] = alpha;
}

function fillRect(png, x0, y0, width, height, color) {
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) setPixel(png, x, y, color);
  }
}

function drawSourceTile(sheet, png, crop, targetX, targetY) {
  fillRect(sheet, targetX, targetY, tileSize, tileSize, [23, 19, 10]);
  const scale = Math.min((tileSize - 24) / crop.width, (tileSize - 24) / crop.height);
  const width = Math.round(crop.width * scale);
  const height = Math.round(crop.height * scale);
  const offsetX = targetX + Math.floor((tileSize - width) / 2);
  const offsetY = targetY + Math.floor((tileSize - height) / 2);
  for (let y = 0; y < height; y++) {
    const sy = crop.y + Math.min(crop.height - 1, Math.floor(((y + 0.5) * crop.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = crop.x + Math.min(crop.width - 1, Math.floor(((x + 0.5) * crop.width) / width));
      const source = (sy * png.width + sx) * 4;
      setPixel(sheet, offsetX + x, offsetY + y, [png.data[source], png.data[source + 1], png.data[source + 2]]);
    }
  }
}

function drawBrickTile(sheet, front, targetX, targetY) {
  fillRect(sheet, targetX, targetY, tileSize, tileSize, [23, 19, 10]);
  const cellSize = Math.max(2, Math.floor((tileSize - 24) / Math.max(front.width, front.height)));
  const width = front.width * cellSize;
  const height = front.height * cellSize;
  const offsetX = targetX + Math.floor((tileSize - width) / 2);
  const offsetY = targetY + Math.floor((tileSize - height) / 2);
  for (let y = 0; y < front.height; y++) {
    for (let x = 0; x < front.width; x++) {
      const color = front.pixels[y * front.width + x];
      if (!color) continue;
      const px = offsetX + x * cellSize;
      const py = offsetY + y * cellSize;
      fillRect(sheet, px, py, cellSize - 1, cellSize - 1, color);
      if (cellSize >= 5) {
        const highlight = color.map((channel) => channel + (255 - channel) * 0.18);
        setPixel(sheet, px + 1, py + 1, highlight);
        const shade = color.map((channel) => channel * 0.72);
        setPixel(sheet, px + cellSize - 2, py + cellSize - 2, shade);
      }
    }
  }
}

await mkdir(outputDir, { recursive: true });

try {
  await execFileAsync(process.execPath, [
    tsc,
    path.join(appRoot, 'src', 'lib', 'photoEngine', 'voxelizePhoto.ts'),
    path.join(appRoot, 'src', 'lib', 'brickify.ts'),
    '--ignoreConfig',
    '--outDir', compileDir,
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--resolveJsonModule',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
    '--noUncheckedIndexedAccess',
    '--ignoreDeprecations', '6.0',
  ]);

  const { voxelizeSegmentation } = require(path.join(compileDir, 'lib', 'photoEngine', 'voxelizePhoto.js'));
  const { brickify } = require(path.join(compileDir, 'lib', 'brickify.js'));
  const metrics = [];

  for (const subject of subjects) {
    const png = PNG.sync.read(await readFile(path.join(appRoot, 'assets', 'home', subject.file)));
    const sampled = sampleCrop(png);
    const sheet = new PNG({ height: tileSize * styles.length, width: tileSize * (profiles.length + 1) });

    for (let row = 0; row < styles.length; row++) {
      const style = styles[row];
      drawSourceTile(sheet, png, sampled.crop, 0, row * tileSize);
      for (let column = 0; column < profiles.length; column++) {
        const profile = profiles[column];
        const model = voxelizeSegmentation(sampled.segmentation, profile, 'relief', style, null, true);
        const repeated = voxelizeSegmentation(sampled.segmentation, profile, 'relief', style, null, true);
        const outputHash = modelHash(model);
        if (modelHash(repeated) !== outputHash) {
          throw new Error(`Non-deterministic output for ${subject.id}/${style}/${profile}`);
        }
        const bom = brickify(model, '#006CB7');
        const front = frontGrid(model);
        const source = resampleSource(sampled.colors, front.width, front.height);
        const sourceLuma = source.map(luma);
        const outputLuma = front.pixels.map((color) => luma(color ?? [255, 255, 255]));
        const sourceSpan = Math.max(...sourceLuma) - Math.min(...sourceLuma) || 1;
        const outputSpan = Math.max(...outputLuma) - Math.min(...outputLuma) || 1;
        const normalizedSource = sourceLuma.map((value) => (value - Math.min(...sourceLuma)) / sourceSpan);
        const normalizedOutput = outputLuma.map((value) => (value - Math.min(...outputLuma)) / outputSpan);
        const substitutions = bom.lines.filter((line) => line.substituted);
        const invalidPartColorLines = bom.lines.filter(
          (line) => !catalogParts.get(line.part)?.elements?.[String(line.colorId)],
        ).length;
        const stockShortageParts = bom.lines.reduce((total, line) => {
          const available = catalogParts.get(line.part)?.inventory?.[String(line.colorId)];
          return total + (available === undefined ? 0 : Math.max(0, line.quantity - available));
        }, 0);
        metrics.push({
          catalogColors: new Set(front.pixels.filter(Boolean).map((color) => color.join(','))).size,
          edgeCorrelation: Number(
            correlation(
              gradients(normalizedSource, front.width, front.height),
              gradients(normalizedOutput, front.width, front.height),
            ).toFixed(4),
          ),
          height: front.height,
          invalidPartColorLines,
          lumaCorrelation: Number(correlation(normalizedSource, normalizedOutput).toFixed(4)),
          outputHash,
          packedParts: bom.totalParts,
          placementCells: bom.placements.reduce(
            (total, placement) => total + placement.spanI * placement.spanK,
            0,
          ),
          profile,
          style,
          subject: subject.id,
          stockShortageParts,
          substitutedParts: substitutions.reduce((sum, line) => sum + line.quantity, 0),
          substitutionLines: substitutions.length,
          visibleCells: front.pixels.filter(Boolean).length,
          width: front.width,
        });
        drawBrickTile(sheet, front, (column + 1) * tileSize, row * tileSize);
      }
    }

    await writeFile(path.join(outputDir, `${subject.id}-matrix.png`), PNG.sync.write(sheet));
  }

  await writeFile(path.join(outputDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.table(metrics);
  console.log(`Brick rendering benchmark written to ${outputDir}`);
} finally {
  await rm(compileDir, { force: true, recursive: true });
}
