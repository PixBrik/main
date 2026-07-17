import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(currentDir, '..');
const generator = require('../scripts/generate-home-showcases.cjs');

function metrics(data) {
  let borderOccupancy = 0;
  let detailTransitions = 0;
  for (let y = 0; y < generator.GRID; y++) {
    for (let x = 0; x < generator.GRID; x++) {
      const value = data.rows[y][x];
      if (value === generator.EMPTY) continue;
      if (x === 0 || y === 0 || x === generator.GRID - 1 || y === generator.GRID - 1) {
        borderOccupancy++;
      }
      const right = x + 1 < generator.GRID ? data.rows[y][x + 1] : generator.EMPTY;
      const below = y + 1 < generator.GRID ? data.rows[y + 1][x] : generator.EMPTY;
      if (right !== generator.EMPTY && right !== value) detailTransitions++;
      if (below !== generator.EMPTY && below !== value) detailTransitions++;
    }
  }
  return {
    borderOccupancy,
    detailTransitions,
    occupiedCells: data.occupiedCells,
    paletteSize: data.palette.length,
  };
}

function occupiedComponentCount(data) {
  const seen = new Uint8Array(generator.GRID * generator.GRID);
  let components = 0;
  for (let start = 0; start < seen.length; start++) {
    const x = start % generator.GRID;
    const y = Math.floor(start / generator.GRID);
    if (seen[start] || data.rows[y][x] === generator.EMPTY) continue;
    components++;
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const index = queue.pop();
      const cellX = index % generator.GRID;
      const cellY = Math.floor(index / generator.GRID);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nextX = cellX + dx;
          const nextY = cellY + dy;
          if (nextX < 0 || nextY < 0 || nextX >= generator.GRID || nextY >= generator.GRID) continue;
          const next = nextY * generator.GRID + nextX;
          if (!seen[next] && data.rows[nextY][nextX] !== generator.EMPTY) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
  }
  return components;
}

function regionOccupancy(data, { minX, maxX, minY, maxY }) {
  let occupied = 0;
  let total = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      total++;
      if (data.rows[y][x] !== generator.EMPTY) occupied++;
    }
  }
  return occupied / total;
}

function regionColorCoverage(data, region, predicate) {
  let matching = 0;
  let total = 0;
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      total++;
      const encoded = data.rows[y][x];
      const paletteIndex = generator.ALPHABET.indexOf(encoded);
      if (paletteIndex < 0) continue;
      const packed = Number.parseInt(data.palette[paletteIndex].slice(1), 16);
      const rgb = [packed >> 16, (packed >> 8) & 255, packed & 255];
      if (predicate(rgb)) matching++;
    }
  }
  return matching / total;
}

test('homepage showcase regeneration is deterministic and checked in', () => {
  const first = generator.generateHomeShowcases({ write: false });
  const second = generator.generateHomeShowcases({ write: false });
  assert.equal(first.output, second.output);
  assert.equal(generator.GRID, 72);
  assert.equal(
    first.output,
    fs.readFileSync(path.join(mobileRoot, 'src/data/homeShowcases.generated.ts'), 'utf8'),
  );
});

test('all homepage samples are detailed, subject-only silhouettes', () => {
  const { generated } = generator.generateHomeShowcases({ write: false });
  const expected = {
    portrait: { borderOccupancy: 66, occupiedCells: 3088, paletteSize: 20 },
    pet: { borderOccupancy: 46, occupiedCells: 2672, paletteSize: 18 },
    car: { borderOccupancy: 0, occupiedCells: 1358, paletteSize: 11 },
  };

  for (const [id, data] of Object.entries(generated)) {
    assert.equal(data.rows.length, generator.GRID);
    assert.ok(data.rows.every((row) => row.length === generator.GRID));
    assert.ok(data.rows.some((row) => row.includes(generator.EMPTY)), `${id} must have transparent cells`);
    assert.equal(data.rows[0], generator.EMPTY.repeat(generator.GRID), `${id} top field must be empty`);
    assert.equal(occupiedComponentCount(data), 1, `${id} must not contain detached backdrop studs`);

    const sampleMetrics = metrics(data);
    assert.deepEqual(
      {
        borderOccupancy: sampleMetrics.borderOccupancy,
        occupiedCells: sampleMetrics.occupiedCells,
        paletteSize: sampleMetrics.paletteSize,
      },
      expected[id],
    );
    assert.ok(
      sampleMetrics.detailTransitions > data.occupiedCells * 0.8,
      `${id} should retain fine tonal and edge transitions`,
    );
  }
});

test('semantic foreground guards preserve clothing and car parts without keeping its floor shadow', () => {
  const { portrait, pet, car } = generator.generateHomeShowcases({ write: false }).generated;

  // These are manually selected against the source photographs, not derived
  // from generator output. They catch the exact failures that generic counts
  // missed: a bottom-connected white shirt and an over-eroded neutral car.
  const shirt = { minX: 27, maxX: 43, minY: 52, maxY: 71 };
  const centralShirt = { minX: 29, maxX: 41, minY: 52, maxY: 71 };
  const carRoofAndCabin = { minX: 27, maxX: 56, minY: 22, maxY: 32 };
  const carBody = { minX: 7, maxX: 64, minY: 36, maxY: 46 };
  const carMainWheel = { minX: 38, maxX: 52, minY: 39, maxY: 52 };
  const carRearWheel = { minX: 58, maxX: 66, minY: 35, maxY: 48 };
  const carFloorShadow = { minX: 0, maxX: 36, minY: 49, maxY: 71 };
  const belowCar = { minX: 0, maxX: 71, minY: 53, maxY: 71 };

  assert.ok(regionOccupancy(portrait, shirt) >= 0.95, 'portrait shirt must not become transparent');
  assert.ok(
    regionColorCoverage(portrait, centralShirt, ([red, green, blue]) =>
      red * 0.299 + green * 0.587 + blue * 0.114 > 165,
    ) >= 0.85,
    'portrait shirt must remain visibly light, not merely filled with jacket colour',
  );
  assert.ok(regionOccupancy(car, carRoofAndCabin) >= 0.88, 'car roof and glass must remain intact');
  assert.ok(regionOccupancy(car, carBody) >= 0.97, 'car body must remain structurally continuous');
  assert.ok(regionOccupancy(car, carMainWheel) >= 0.9, 'main wheel must remain intact');
  assert.ok(regionOccupancy(car, carRearWheel) >= 0.8, 'rear wheel must remain intact');
  assert.equal(regionOccupancy(car, carFloorShadow), 0, 'studio floor shadow must be transparent');
  assert.equal(regionOccupancy(car, belowCar), 0, 'nothing may float below the car silhouette');

  const falseNeutralCarColours = new Set([
    '#004A2D', // dark green
    '#A0BCAC', // sand green
    '#D9E4A7', // yellowish green
    '#00395E', // dark blue
    '#9675B4', // lavender
    '#BCA6D0', // light lavender
  ]);
  assert.ok(
    car.palette.every((hex) => !falseNeutralCarColours.has(hex)),
    'neutral car paint and glass must not dither into green, blue, or purple bricks',
  );
  for (const [id, data] of [['portrait', portrait], ['pet', pet]]) {
    assert.ok(
      data.palette.every((hex) => {
        const packed = Number.parseInt(hex.slice(1), 16);
        const [red, green, blue] = [packed >> 16, (packed >> 8) & 255, packed & 255];
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        return chroma <= 12 || (red >= green && red >= blue);
      }),
      `${id} must use a coherent warm/neutral palette without green, blue, or purple noise`,
    );
  }
});

test('every rendered sample colour comes from the solid catalog palette', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(mobileRoot, 'src/data/brickCatalog.json'), 'utf8'),
  );
  const valid = new Set(
    catalog.colors
      .filter((color) => !color.trans && !color.metallic)
      .map((color) => color.rgb.toUpperCase()),
  );
  const { generated } = generator.generateHomeShowcases({ write: false });
  for (const [id, data] of Object.entries(generated)) {
    for (const color of data.palette) {
      assert.ok(valid.has(color), `${id} uses non-catalog colour ${color}`);
    }
  }
});

test('isolated pale studio colours are removed from subject contours', () => {
  const { generated } = generator.generateHomeShowcases({ write: false });
  const cardinal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const surrounding = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (const [id, data] of Object.entries(generated)) {
    const at = (x, y) => {
      if (x < 0 || y < 0 || x >= generator.GRID || y >= generator.GRID) return generator.EMPTY;
      return data.rows[y][x];
    };
    for (let y = 0; y < generator.GRID; y++) {
      for (let x = 0; x < generator.GRID; x++) {
        const encoded = at(x, y);
        const paletteIndex = generator.ALPHABET.indexOf(encoded);
        if (paletteIndex < 0) continue;
        const hex = data.palette[paletteIndex];
        const packed = Number.parseInt(hex.slice(1), 16);
        const red = packed >> 16;
        const green = (packed >> 8) & 255;
        const blue = packed & 255;
        const luma = red * 0.299 + green * 0.587 + blue * 0.114;
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        const warmBackdrop = luma > 180 && red > green && green > blue && red - blue > 16;
        const nearWhiteBackdrop = luma > 242 && chroma < 16;
        if (!warmBackdrop && !nearWhiteBackdrop) continue;

        const onContour = cardinal.some(([dx, dy]) => at(x + dx, y + dy) === generator.EMPTY);
        const support = surrounding.filter(
          ([dx, dy]) => at(x + dx, y + dy) !== generator.EMPTY,
        ).length;
        assert.ok(
          !onContour || support > 2,
          `${id} retains pale backdrop fringe at ${x},${y}`,
        );
      }
    }
  }
});

test('stud texture is clipped to foreground instead of covering the full square', () => {
  const component = fs.readFileSync(
    path.join(mobileRoot, 'src/components/BuildPath.tsx'),
    'utf8',
  );
  assert.match(component, /<Path d=\{silhouette\} fill=\{`url\(#\$\{patternId\}\)`\} \/>/);
  assert.doesNotMatch(
    component,
    /<Rect fill=\{`url\(#\$\{patternId\}\)`\} height=\{HOME_MOSAIC_GRID\}/,
  );
  assert.doesNotMatch(component, /<Rect fill="#FFFFFA" height=\{HOME_MOSAIC_GRID\}/);
  assert.match(component, /preserveAspectRatio="xMidYMid meet" viewBox=\{viewBox\}/);
  assert.doesNotMatch(component, /shadowSilhouette|shadowSubject|translate\(0\.32/);

  const brickStage = component.match(/brickStage:\s*\{([\s\S]*?)\n  \},/);
  assert.ok(brickStage, 'brickStage style should exist');
  assert.doesNotMatch(brickStage[1], /backgroundColor/);
  assert.doesNotMatch(brickStage[1], /#F4EEDC|colors\.white/);
  const comparisonCard = component.match(/comparisonCard:\s*\{([\s\S]*?)\n  \},/);
  assert.ok(comparisonCard, 'comparisonCard style should exist');
  assert.doesNotMatch(comparisonCard[1], /backgroundColor|borderColor|borderWidth/);
});

test('flat and true 3D are first-class homepage choices on desktop and mobile', () => {
  const buildPath = fs.readFileSync(
    path.join(mobileRoot, 'src/components/BuildPath.tsx'),
    'utf8',
  );
  const home = fs.readFileSync(path.join(mobileRoot, 'src/screens/HomeScreen.tsx'), 'utf8');

  assert.match(buildPath, /FLAT PANEL · ONE PHOTO/);
  assert.match(buildPath, /TRUE 3D · ALL SIDES/);
  assert.match(buildPath, /Objects: one photo, with hidden sides completed by AI/);
  assert.match(buildPath, /People: four guided views, so the back comes from a real photo/);
  assert.match(buildPath, /onPress=\{onStart3D \?\? onStart\}/);
  assert.doesNotMatch(buildPath, /WANT FULL 3D\?/);

  assert.match(home, /onStart3D\?: \(\) => void/);
  assert.match(home, /<BuildPath onStart=\{onStart\} onStart3D=\{onStart3D\} \/>/);
  assert.match(home, /<Text[^>]*>FLAT\{'\\n'\}PANEL<\/Text>|>FLAT PANEL<\/Text>/);
  assert.match(home, /<Text[^>]*>TRUE\{'\\n'\}3D<\/Text>/);
});
