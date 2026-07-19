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
    fringeSupport: 6,
    neutralFringeLuma: 115,
    neutralFringeChroma: 65,
    backgroundFringeDelta: 80,
    warmSubjectPalette: true,
    // A pale garment can be almost identical to a studio backdrop. Once the
    // jacket establishes both sides of the torso, preserve the supported
    // interior instead of treating colour alone as proof of background.
    supportedInterior: { startY: 0.65, maximumGap: 0.3, minimumAnchor: 0.018 },
  },
  {
    id: 'pet',
    file: 'pet-source.png',
    backgroundTolerance: 19,
    detailBoost: 0.38,
    warmSubjectPalette: true,
  },
  {
    id: 'car',
    file: 'car-source.png',
    backgroundTolerance: 22,
    detailBoost: 0.48,
    // The generated studio photograph has a soft floor shadow below the tyres.
    // It is presentation lighting, not part of the physical object.
    floorLimit: 0.77,
    floorShadow: {
      startY: 0.67,
      // Keep the tyres' true lower contour; the studio sweep continues below
      // them, so the global cutoff can sit safely beneath the wheels.
      hardCutY: 0.77,
      maximumDelta: 50,
      maximumChroma: 28,
      minimumPaleLuma: 130,
      // The two wheel regions are semantic foreground, even where polished
      // rims approach the neutral studio sweep in colour.
      protectedRegions: [
        { minX: 0.52, maxX: 0.72, minY: 0.53, maxY: 0.76 },
        { minX: 0.8, maxX: 0.96, minY: 0.48, maxY: 0.72 },
      ],
      // In the 964 reference the front lip ends on row 47. Rows 48 onward in
      // the left half are the studio-floor shadow, while the wheel continues
      // independently to the right of this boundary.
      dropRegions: [
        { minX: 0, maxX: 0.52, minY: 48 / 72, maxY: 1 },
      ],
    },
    // One conservative pass may drop only pale neutral antialias cells. The
    // former eight-pass rule is what destroyed the black bodywork.
    fringePasses: 1,
    fringeSupport: 3,
    neutralFringeLuma: 180,
    neutralFringeChroma: 16,
    // Black paint, grey glass and chrome are semantically neutral object
    // colours. Keep them in the neutral catalog family so error diffusion
    // cannot turn a classic black car into green/purple camouflage.
    neutralObjectPalette: true,
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

const neutralCatalogColors = catalogColors.filter(({ rgb }) => {
  const chroma = Math.max(...rgb) - Math.min(...rgb);
  return chroma <= 12;
});
const warmSubjectCatalogColors = catalogColors.filter(({ rgb: [red, green, blue] }) => {
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  return chroma <= 12 || (red >= green && red >= blue);
});

function nearestCatalog(rgb, semanticRgb = rgb, options = {}) {
  const semanticChroma = Math.max(...semanticRgb) - Math.min(...semanticRgb);
  const candidates = options.warmSubjectPalette
    ? warmSubjectCatalogColors
    : options.neutralObjectPalette && semanticChroma <= 50
      ? neutralCatalogColors
      : catalogColors;
  let best = catalogColors[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
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
  const scale = Math.min(size / png.width, size / png.height);
  const fittedWidth = png.width * scale;
  const fittedHeight = png.height * scale;
  const offsetX = (size - fittedWidth) / 2;
  const offsetY = (size - fittedHeight) / 2;
  for (let targetY = 0; targetY < size; targetY++) {
    for (let targetX = 0; targetX < size; targetX++) {
      const target = (targetY * size + targetX) * 3;
      if (
        targetX + 1 <= offsetX || targetX >= offsetX + fittedWidth ||
        targetY + 1 <= offsetY || targetY >= offsetY + fittedHeight
      ) {
        pixels[target] = 255;
        pixels[target + 1] = 255;
        pixels[target + 2] = 255;
        continue;
      }
      const x0 = Math.max(0, Math.floor((targetX - offsetX) / scale));
      const x1 = Math.min(png.width, Math.max(x0 + 1, Math.floor((targetX + 1 - offsetX) / scale)));
      const y0 = Math.max(0, Math.floor((targetY - offsetY) / scale));
      const y1 = Math.min(png.height, Math.max(y0 + 1, Math.floor((targetY + 1 - offsetY) / scale)));
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

/**
 * Restore a background-coloured region only when foreground structure on the
 * same row proves that it belongs inside the subject. This is deliberately a
 * contextual decision: colour segmentation alone cannot distinguish a white
 * shirt connected to the bottom crop from a white studio sweep.
 */
function restoreSupportedInterior(mask, size, options) {
  if (!options) return { mask, protectedMask: new Uint8Array(mask.length) };

  const result = new Uint8Array(mask);
  const protectedMask = new Uint8Array(mask.length);
  const startY = Math.floor(options.startY * size);
  const maximumGap = Math.floor(options.maximumGap * size);
  const minimumAnchor = Math.max(2, Math.floor(options.minimumAnchor * size));

  for (let y = startY; y < size; y++) {
    const rowStart = y * size;
    let x = 0;
    while (x < size) {
      if (result[rowStart + x]) {
        x++;
        continue;
      }
      const gapStart = x;
      while (x < size && !result[rowStart + x]) x++;
      const gapEnd = x - 1;
      if (gapStart === 0 || x === size || gapEnd - gapStart + 1 > maximumGap) continue;

      let leftAnchor = 0;
      for (let anchorX = gapStart - 1; anchorX >= 0 && result[rowStart + anchorX]; anchorX--) {
        leftAnchor++;
      }
      let rightAnchor = 0;
      for (let anchorX = x; anchorX < size && result[rowStart + anchorX]; anchorX++) {
        rightAnchor++;
      }
      if (leftAnchor < minimumAnchor || rightAnchor < minimumAnchor) continue;

      for (let fillX = gapStart; fillX <= gapEnd; fillX++) {
        const index = rowStart + fillX;
        result[index] = 1;
        protectedMask[index] = 1;
      }
    }
  }
  return { mask: result, protectedMask };
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

/** A grid-level confidence layer measured against the learned studio sweep. */
function sampleBackgroundDelta(image) {
  const model = rowBackgroundModel(image);
  const deltas = new Float32Array(GRID * GRID);
  for (let gridY = 0; gridY < GRID; gridY++) {
    for (let gridX = 0; gridX < GRID; gridX++) {
      let total = 0;
      for (let dy = 0; dy < MASK_SCALE; dy++) {
        for (let dx = 0; dx < MASK_SCALE; dx++) {
          const x = gridX * MASK_SCALE + dx;
          const y = gridY * MASK_SCALE + dy;
          total += perceptualDelta(
            pixelAt(image, x, y),
            expectedBackground(model, x, y, image.size),
          );
        }
      }
      deltas[gridY * GRID + gridX] = total / (MASK_SCALE * MASK_SCALE);
    }
  }
  return deltas;
}

/**
 * Remove a soft studio-floor shadow without reopening the destructive neutral
 * contour rule. Shadow ownership requires three independent signals: it is
 * below the object, close to the learned backdrop, and low-chroma. Explicit
 * wheel regions remain protected because chrome can also be neutral.
 */
function removeFloorShadow(cells, backgroundDeltas, options) {
  if (!options) return cells;
  const startY = Math.floor(options.startY * GRID);
  const protectedRegions = options.protectedRegions ?? [];
  const dropRegions = options.dropRegions ?? [];
  return cells.map((rgb, index) => {
    if (!rgb) return null;
    const x = index % GRID;
    const y = Math.floor(index / GRID);
    if (y < startY) return rgb;
    const normalizedX = (x + 0.5) / GRID;
    const normalizedY = (y + 0.5) / GRID;
    const shadowOnly = dropRegions.some((region) =>
      normalizedX >= region.minX
      && normalizedX <= region.maxX
      && normalizedY >= region.minY
      && normalizedY <= region.maxY,
    );
    if (shadowOnly) return null;
    if (normalizedY >= options.hardCutY) return null;
    const protectedPart = protectedRegions.some((region) =>
      normalizedX >= region.minX
      && normalizedX <= region.maxX
      && normalizedY >= region.minY
      && normalizedY <= region.maxY,
    );
    if (protectedPart) return rgb;
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    const luma = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    if (luma >= options.minimumPaleLuma && chroma <= options.maximumChroma) return null;
    if (
      backgroundDeltas[index] <= options.maximumDelta
      && chroma <= options.maximumChroma
    ) {
      return null;
    }
    return rgb;
  });
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

function catalogDither(cells, options = {}) {
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
      // Candidate colour families are selected from the un-diffused source
      // colour. Diffusion error must never change the semantic class of a cell.
      const nearest = nearestCatalog(rgb, cells[index], options);
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

function removeBackdropFringe(
  mapped,
  options = {},
  protectedCells = new Uint8Array(mapped.length),
  backgroundDeltas = new Float32Array(mapped.length),
) {
  let result = [...mapped];
  const passes = options.fringePasses ?? 1;
  const fringeSupport = options.fringeSupport ?? 4;
  const hasNeutralRule = Number.isFinite(options.neutralFringeLuma)
    && Number.isFinite(options.neutralFringeChroma);
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
        if (protectedCells[y * GRID + x]) continue;
        const [red, green, blue] = hexToRgb(hex);
        const luma = red * 0.299 + green * 0.587 + blue * 0.114;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        const warmBackdrop = luma > 180 && red > green && green > blue && red - blue > 16;
        const nearWhiteBackdrop = luma > 242 && chroma < 16;
        const neutralBackdrop = hasNeutralRule
          && luma > options.neutralFringeLuma
          && chroma < options.neutralFringeChroma;
        if (!warmBackdrop && !nearWhiteBackdrop && !neutralBackdrop) continue;
        if (Number.isFinite(options.backgroundFringeDelta)
          && backgroundDeltas[y * GRID + x] > options.backgroundFringeDelta) continue;

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

function sampleProtectedCells(protectedMask, size) {
  const cells = new Uint8Array(GRID * GRID);
  for (let gridY = 0; gridY < GRID; gridY++) {
    for (let gridX = 0; gridX < GRID; gridX++) {
      let protectedPixels = 0;
      for (let dy = 0; dy < MASK_SCALE; dy++) {
        for (let dx = 0; dx < MASK_SCALE; dx++) {
          const x = gridX * MASK_SCALE + dx;
          const y = gridY * MASK_SCALE + dy;
          protectedPixels += protectedMask[y * size + x];
        }
      }
      if (protectedPixels) cells[gridY * GRID + gridX] = 1;
    }
  }
  return cells;
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
  const scale = Math.min(size / png.width, size / png.height);
  const fittedWidth = png.width * scale;
  const fittedHeight = png.height * scale;
  const offsetX = (size - fittedWidth) / 2;
  const offsetY = (size - fittedHeight) / 2;
  for (let targetY = 0; targetY < size; targetY++) {
    for (let targetX = 0; targetX < size; targetX++) {
      const targetOffset = (targetY * size + targetX) * 4;
      if (
        targetX + 0.5 < offsetX || targetX + 0.5 >= offsetX + fittedWidth ||
        targetY + 0.5 < offsetY || targetY + 0.5 >= offsetY + fittedHeight
      ) {
        preview.data[targetOffset] = 255;
        preview.data[targetOffset + 1] = 255;
        preview.data[targetOffset + 2] = 255;
        preview.data[targetOffset + 3] = 255;
        continue;
      }
      const sourceX = Math.min(png.width - 1, Math.max(0, Math.floor((targetX + 0.5 - offsetX) / scale)));
      const sourceY = Math.min(png.height - 1, Math.max(0, Math.floor((targetY + 0.5 - offsetY) / scale)));
      const sourceOffset = (sourceY * png.width + sourceX) * 4;
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
    const floodedMask = floodBackground(image, source.backgroundTolerance, source.floorLimit);
    const restored = restoreSupportedInterior(floodedMask, image.size, source.supportedInterior);
    const cells = sampleForeground(image, restored.mask);
    const protectedCells = sampleProtectedCells(restored.protectedMask, image.size);
    const backgroundDeltas = sampleBackgroundDelta(image);
    const foregroundCells = removeFloorShadow(cells, backgroundDeltas, source.floorShadow);
    const detailed = enhanceDetail(foregroundCells, source.detailBoost);
    const catalogMapped = catalogDither(detailed, source);
    generated[source.id] = {
      ...encodeMosaic(keepLargestMappedComponent(
        removeBackdropFringe(catalogMapped, source, protectedCells, backgroundDeltas),
      )),
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
