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
    portrait: { borderOccupancy: 53, occupiedCells: 2592, paletteSize: 17 },
    pet: { borderOccupancy: 46, occupiedCells: 2672, paletteSize: 20 },
    car: { borderOccupancy: 0, occupiedCells: 1223, paletteSize: 17 },
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
      sampleMetrics.detailTransitions > data.occupiedCells,
      `${id} should retain fine tonal and edge transitions`,
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
