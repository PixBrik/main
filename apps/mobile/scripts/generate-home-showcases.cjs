/*
 * Generates the subject-only colour grids used by the homepage comparison.
 *
 * Background removal is deterministic and local: a row-aware colour model is
 * learned from the clear image borders, then a flood fill follows that smooth
 * background around the subject. Only the enclosed foreground is sampled into
 * catalog colours. The higher-resolution grid and restrained error diffusion
 * preserve eyes, hair, fur, lights, glass, and bodywork without inventing
 * colours that are not present in the parts catalog.
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
const GRID = 72;
const MASK_SCALE = 4;
const EMPTY = '.';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

const SOURCES = [
  {
    id: 'portrait',
    file: 'portrait-source.png',
    backgroundTolerance: 20,
    detailBoost: 0.34,
    fringePasses: 8,
    neutralFringeLuma: 75,
    neutralFringeChroma: 75,
    fringeSupport: 6,
  },
  { id: 'pet', file: 'pet-source.png', backgroundTolerance: 19, detailBoost: 0.38 },
  {
    id: 'car',
    file: 'car-source.png',
    backgroundTolerance: 22,
    detailBoost: 0.48,
    // The generated studio photograph has a soft floor shadow below the tyres.
    // It is presentation lighting, not part of the physical object.
    floorLimit: 0.77,
    fringePasses: 8,
    neutralFringeLuma: 70,
    neutralFringeChroma: 72,
    fringeSupport: 5,
  },
];

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'brickCatalog.json'), 'utf8'));
const catalogColors = catalog.colors
  .filter((color) => !color.trans && !color.metallic)
  .map((color) => ({ hex: color.rgb.toUpperCase(), rgb: hexToRgb(color.rgb) }));

function clamp(value, minimum = 0, maximum = 255) {
  return Math.max(minimum, Math.min(maximum, value));
}

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

function perceptualDelta(a, b) {
  return Math.sqrt(colorDistance(a, b) / 8);
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
  return best;
}

function resizeForMask(png) {
  const size = GRID * MASK_SCALE;
  const pixels = new Float32Array(size * size * 3);
  for (let targetY = 0; targetY < size; targetY++) {
    const y0 = Math.floor((targetY * png.height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((targetY + 1) * png.height) / size));
    for (let targetX = 0; targetX < size; targetX++) {
      const x0 = Math.floor((targetX * png.width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((targetX + 1) * png.width) / size));
      let red = 0;
      let green = 0;
      let blue = 0;
      let weight = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const offset = (y * png.width + x) * 4;
          const alpha = png.data[offset + 3] / 255;
          red += png.data[offset] * alpha + 255 * (1 - alpha);
          green += png.data[offset + 1] * alpha + 255 * (1 - alpha);
          blue += png.data[offset + 2] * alpha + 255 * (1 - alpha);
          weight++;
        }
      }
      const target = (targetY * size + targetX) * 3;
      pixels[target] = red / weight;
      pixels[target + 1] = green / weight;
      pixels[target + 2] = blue / weight;
    }
  }
  return { pixels, size };
}

function pixelAt(image, x, y) {
  const offset = (y * image.size + x) * 3;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function rowBackgroundModel(image) {
  const band = Math.max(3, Math.floor(image.size * 0.035));
  return Array.from({ length: image.size }, (_, y) => {
    const left = [0, 0, 0];
    const right = [0, 0, 0];
    for (let x = 0; x < band; x++) {
      const a = pixelAt(image, x, y);
      const b = pixelAt(image, image.size - 1 - x, y);
      for (let channel = 0; channel < 3; channel++) {
        left[channel] += a[channel] / band;
        right[channel] += b[channel] / band;
      }
    }
    return { left, right };
  });
}

function expectedBackground(model, x, y, size) {
  const t = x / Math.max(1, size - 1);
  const row = model[y];
  return row.left.map((value, channel) => value * (1 - t) + row.right[channel] * t);
}

function floodBackground(image, tolerance, floorLimit) {
  const background = new Uint8Array(image.size * image.size);
  const model = rowBackgroundModel(image);
  const queue = new Int32Array(image.size * image.size);
  let head = 0;
  let tail = 0;

  const canVisit = (x, y) => {
    if (x < 0 || y < 0 || x >= image.size || y >= image.size) return false;
    const index = y * image.size + x;
    if (background[index]) return false;
    const pixel = pixelAt(image, x, y);
    const expected = expectedBackground(model, x, y, image.size);
    const delta = perceptualDelta(pixel, expected);
    const luma = pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114;
    const expectedLuma = expected[0] * 0.299 + expected[1] * 0.587 + expected[2] * 0.114;
    // Studio floor shadows are achromatic, soft, and remain close in luminance
    // to the learned backdrop. This secondary allowance lets the fill pass
    // through them while hard, high-contrast object boundaries still stop it.
    const chroma = Math.max(...pixel) - Math.min(...pixel);
    const softStudioShadow = chroma < 14 && expectedLuma - luma < 58 && delta < tolerance * 2.35;
    return delta <= tolerance || softStudioShadow;
  };

  const enqueue = (x, y) => {
    if (!canVisit(x, y)) return;
    const index = y * image.size + x;
    background[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < image.size; x++) {
    enqueue(x, 0);
    enqueue(x, image.size - 1);
  }
  for (let y = 1; y < image.size - 1; y++) {
    enqueue(0, y);
    enqueue(image.size - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % image.size;
    const y = Math.floor(index / image.size);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  const foreground = new Uint8Array(background.length);
  const maximumY = floorLimit ? Math.floor(floorLimit * image.size) : image.size - 1;
  for (let index = 0; index < foreground.length; index++) {
    const y = Math.floor(index / image.size);
    foreground[index] = !background[index] && y <= maximumY ? 1 : 0;
  }
  return keepLargestComponent(foreground, image.size);
}

function keepLargestComponent(mask, size) {
  const seen = new Uint8Array(mask.length);
  let largest = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start];
    const component = [];
    seen[start] = 1;
    while (queue.length) {
      const index = queue.pop();
      component.push(index);
      const x = index % size;
      const y = Math.floor(index / size);
      const neighbors = [index - 1, index + 1, index - size, index + size];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= mask.length || seen[neighbor] || !mask[neighbor]) continue;
        const neighborX = neighbor % size;
        const neighborY = Math.floor(neighbor / size);
        if (Math.abs(neighborX - x) + Math.abs(neighborY - y) !== 1) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const result = new Uint8Array(mask.length);
  for (const index of largest) result[index] = 1;
  return result;
}

function sampleForeground(image, mask) {
  const cells = Array.from({ length: GRID * GRID }, () => null);
  for (let gridY = 0; gridY < GRID; gridY++) {
    for (let gridX = 0; gridX < GRID; gridX++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let foregroundPixels = 0;
      for (let dy = 0; dy < MASK_SCALE; dy++) {
        for (let dx = 0; dx < MASK_SCALE; dx++) {
          const x = gridX * MASK_SCALE + dx;
          const y = gridY * MASK_SCALE + dy;
          if (!mask[y * image.size + x]) continue;
          const rgb = pixelAt(image, x, y);
          red += rgb[0];
          green += rgb[1];
          blue += rgb[2];
          foregroundPixels++;
        }
      }
      // A quarter-cell threshold keeps fine hair, ears, mirrors, and bumpers
      // while rejecting one-pixel halos from antialiasing.
      if (foregroundPixels >= MASK_SCALE * MASK_SCALE * 0.25) {
        cells[gridY * GRID + gridX] = [
          red / foregroundPixels,
          green / foregroundPixels,
          blue / foregroundPixels,
        ];
      }
    }
  }
  return cells;
}

function enhanceDetail(cells, amount) {
  return cells.map((rgb, index) => {
    if (!rgb) return null;
    const x = index % GRID;
    const y = Math.floor(index / GRID);
    const neighbors = [];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const neighbor = cells[ny * GRID + nx];
      if (neighbor) neighbors.push(neighbor);
    }
    if (!neighbors.length) return rgb;
    const average = [0, 1, 2].map((channel) =>
      neighbors.reduce((sum, neighbor) => sum + neighbor[channel], 0) / neighbors.length,
    );
    const sharpened = rgb.map((value, channel) => clamp(value + (value - average[channel]) * amount));
    const luma = sharpened[0] * 0.299 + sharpened[1] * 0.587 + sharpened[2] * 0.114;
    return sharpened.map((value) => clamp(luma + (value - luma) * 1.08));
  });
}

function catalogDither(cells) {
  const working = cells.map((rgb) => (rgb ? [...rgb] : null));
  const mapped = new Array(cells.length).fill(null);
  const diffusion = [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const index = y * GRID + x;
      const rgb = working[index];
      if (!rgb) continue;
      const nearest = nearestCatalog(rgb);
      mapped[index] = nearest.hex;
      const error = rgb.map((value, channel) => value - nearest.rgb[channel]);
      for (const [dx, dy, weight] of diffusion) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const neighbor = working[ny * GRID + nx];
        if (!neighbor) continue;
        for (let channel = 0; channel < 3; channel++) {
          neighbor[channel] = clamp(neighbor[channel] + error[channel] * weight * 0.58);
        }
      }
    }
  }
  return mapped;
}

function removeBackdropFringe(mapped, options = {}) {
  let result = [...mapped];
  const passes = options.fringePasses ?? 1;
  const neutralFringeLuma = options.neutralFringeLuma ?? 180;
  const neutralFringeChroma = options.neutralFringeChroma ?? 22;
  const fringeSupport = options.fringeSupport ?? 4;
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
    return result[y * GRID + x];
  };
  const cardinal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const surrounding = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (let pass = 0; pass < passes; pass++) {
    const next = [...result];
    let removed = 0;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const hex = at(x, y);
        if (!hex) continue;
        const [red, green, blue] = hexToRgb(hex);
        const luma = red * 0.299 + green * 0.587 + blue * 0.114;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        const warmBackdrop = luma > 180 && red > green && green > blue && red - blue > 16;
        const nearWhiteBackdrop = luma > 242 && chroma < 16;
        const neutralBackdrop = luma > neutralFringeLuma && chroma < neutralFringeChroma;
        if (!warmBackdrop && !nearWhiteBackdrop && !neutralBackdrop) continue;

        const onContour = cardinal.some(([dx, dy]) => !at(x + dx, y + dy));
        if (!onContour) continue;
        const support = surrounding.filter(([dx, dy]) => at(x + dx, y + dy)).length;
        const maximumSupport = nearWhiteBackdrop ? 3 : fringeSupport;
        if (support <= maximumSupport) {
          next[y * GRID + x] = null;
          removed++;
        }
      }
    }
    result = next;
    if (!removed) break;
  }
  return result;
}

/** Fringe peeling can expose tiny disconnected antialias/shadow islands. */
function keepLargestMappedComponent(mapped) {
  const seen = new Uint8Array(mapped.length);
  let largest = [];
  for (let start = 0; start < mapped.length; start++) {
    if (!mapped[start] || seen[start]) continue;
    const queue = [start];
    const component = [];
    seen[start] = 1;
    while (queue.length) {
      const index = queue.pop();
      component.push(index);
      const x = index % GRID;
      const y = Math.floor(index / GRID);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
          const neighbor = ny * GRID + nx;
          if (!seen[neighbor] && mapped[neighbor]) {
            seen[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const kept = new Array(mapped.length).fill(null);
  for (const index of largest) kept[index] = mapped[index];
  return kept;
}

function encodeMosaic(mapped) {
  const palette = [...new Set(mapped.filter(Boolean))];
  if (palette.length > ALPHABET.length) throw new Error('Too many catalog colours to encode');
  const paletteIndex = new Map(palette.map((hex, index) => [hex, index]));
  const rows = Array.from({ length: GRID }, (_, y) =>
    Array.from({ length: GRID }, (_, x) => {
      const color = mapped[y * GRID + x];
      return color ? ALPHABET[paletteIndex.get(color)] : EMPTY;
    }).join(''),
  );
  const occupiedCells = mapped.filter(Boolean).length;
  const occupied = mapped
    .map((color, index) => (color ? index : -1))
    .filter((index) => index >= 0);
  const xs = occupied.map((index) => index % GRID);
  const ys = occupied.map((index) => Math.floor(index / GRID));
  const bounds = occupied.length
    ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    : { minX: 0, minY: 0, maxX: GRID - 1, maxY: GRID - 1 };
  return { palette, rows, occupiedCells, bounds };
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

function renderOutput(generated) {
  return `/* This file is generated by scripts/generate-home-showcases.cjs. */\n` +
    `export const HOME_MOSAICS = ${JSON.stringify(generated, null, 2)} as const;\n` +
    `export const HOME_MOSAIC_GRID = ${GRID};\n` +
    `export const HOME_MOSAIC_EMPTY = '${EMPTY}';\n` +
    `export const HOME_MOSAIC_ALPHABET = '${ALPHABET}';\n`;
}

function generateHomeShowcases({ write = true } = {}) {
  const generated = {};
  for (const source of SOURCES) {
    const input = path.join(ASSET_DIR, source.file);
    if (!fs.existsSync(input)) continue;
    const png = PNG.sync.read(fs.readFileSync(input));
    const image = resizeForMask(png);
    const mask = floodBackground(image, source.backgroundTolerance, source.floorLimit);
    const cells = sampleForeground(image, mask);
    const detailed = enhanceDetail(cells, source.detailBoost);
    const catalogMapped = catalogDither(detailed);
    generated[source.id] = {
      ...encodeMosaic(keepLargestMappedComponent(removeBackdropFringe(catalogMapped, source))),
      fallbackUri: inlineFallback(png),
    };
  }
  const output = renderOutput(generated);
  if (write) fs.writeFileSync(OUTPUT, output);
  return { generated, output };
}

if (require.main === module) {
  const { generated } = generateHomeShowcases();
  const summary = Object.entries(generated)
    .map(([id, value]) => `${id}=${value.occupiedCells}`)
    .join(', ');
  console.log(`Generated ${Object.keys(generated).length} subject-only homepage mosaics at ${GRID}x${GRID} (${summary}).`);
}

module.exports = {
  ALPHABET,
  EMPTY,
  GRID,
  SOURCES,
  generateHomeShowcases,
};
