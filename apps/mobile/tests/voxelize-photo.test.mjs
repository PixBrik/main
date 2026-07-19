import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compileDir = await mkdtemp(path.join(tmpdir(), 'pixbrik-voxelize-photo-'));
const source = path.join(appRoot, 'src', 'lib', 'photoEngine', 'voxelizePhoto.ts');
const tsc = path.join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');

await execFileAsync(process.execPath, [
  tsc,
  source,
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

const { quantizeNaturalPanelColor, voxelizeSegmentation } = require(path.join(
  compileDir,
  'lib',
  'photoEngine',
  'voxelizePhoto.js',
));
const catalog = require(path.join(appRoot, 'src', 'data', 'brickCatalog.json'));

const neutralCatalogColors = new Set([
  '#000000',
  '#646767',
  '#a0a19f',
  '#D9D9D6',
  '#999999',
  '#fffffa',
  '#ffffff',
].map((hex) => hex.toLowerCase()));
const greenOrOliveCatalogColors = new Set(
  catalog.colors
    .filter((color) =>
      /green|aqua/i.test(color.name) || ['Tarmac'].includes(color.name),
    )
    .map((color) => color.rgb.toLowerCase()),
);
const catalogColors = new Set(catalog.colors.map((color) => color.rgb.toLowerCase()));

test.after(async () => {
  await rm(compileDir, { force: true, recursive: true });
});

function fullFrameSegmentation(grid, colorAt) {
  const colors = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) colors.push(colorAt(x, y));
  }
  return {
    colors,
    coverage: 1,
    grid,
    mask: new Array(grid * grid).fill(true),
    region: { height: 1, width: 1, x: 0, y: 0 },
  };
}

function frontCell(model, x, sourceY, height) {
  return model.cells.find((cell) => cell.i === x && cell.j === height - 1 - sourceY && cell.k === 0);
}

function hexLuma(hex) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

test('natural panel catalog matching keeps neutral and warm source families coherent', () => {
  const neutralSources = [
    [28, 31, 24], // dark car paint with a slight green cast
    [118, 121, 115], // neutral mid-tone under mixed light
    [244, 238, 226], // warm-lit white clothing
  ];
  for (const source of neutralSources) {
    const matched = quantizeNaturalPanelColor(...source);
    assert.ok(catalogColors.has(matched.toLowerCase()), matched);
    assert.ok(neutralCatalogColors.has(matched.toLowerCase()), `${source.join(',')} -> ${matched}`);
  }

  const warmSources = [
    [205, 154, 122], // skin
    [174, 112, 76], // skin in shadow
    [113, 72, 48], // warm hair / wood
  ];
  for (const source of warmSources) {
    const matched = quantizeNaturalPanelColor(...source);
    assert.ok(catalogColors.has(matched.toLowerCase()), matched);
    assert.ok(!greenOrOliveCatalogColors.has(matched.toLowerCase()), `${source.join(',')} -> ${matched}`);
  }
});

test('natural relief applies family constraints without losing high-contrast details', () => {
  const grid = 12;
  const segmentation = fullFrameSegmentation(grid, (x, y) => {
    if (x < 4) return [28, 31, 24];
    if (x < 8) return y === 2 && x === 5 ? [9, 10, 8] : [205, 154, 122];
    return [244, 238, 226];
  });

  const model = voxelizeSegmentation(segmentation, 'detailed', 'relief', 'natural');
  const darkCar = frontCell(model, 1, 6, grid)?.colorHex;
  const skin = frontCell(model, 6, 6, grid)?.colorHex;
  const whiteShirt = frontCell(model, 10, 6, grid)?.colorHex;
  const darkFeature = frontCell(model, 5, 2, grid)?.colorHex;

  assert.ok(neutralCatalogColors.has(darkCar?.toLowerCase()), darkCar);
  assert.ok(neutralCatalogColors.has(whiteShirt?.toLowerCase()), whiteShirt);
  assert.ok(!greenOrOliveCatalogColors.has(skin?.toLowerCase()), skin);
  assert.ok(catalogColors.has(skin?.toLowerCase()), skin);
  assert.ok(neutralCatalogColors.has(darkFeature?.toLowerCase()), darkFeature);
  assert.ok(hexLuma(whiteShirt) - hexLuma(darkCar) > 100, `${darkCar} -> ${whiteShirt}`);
});

test('classic relief preserves captured resolution, catalog tones, and determinism', () => {
  const grid = 12;
  const segmentation = fullFrameSegmentation(grid, (x, y) => {
    if (y === 3 && (x === 3 || x === 8)) return [8, 8, 8];
    const value = Math.round(((x + y) / (2 * (grid - 1))) * 255);
    return [value, value, value];
  });

  const first = voxelizeSegmentation(segmentation, 'detailed', 'relief', 'classic');
  const second = voxelizeSegmentation(segmentation, 'detailed', 'relief', 'classic');
  const allowed = new Set(['#000000', '#646767', '#A0A19F', '#D9D9D6', '#FFFFFF']);

  assert.deepEqual(second, first);
  assert.equal(first.brickCount, grid * grid * 2);
  assert.equal(first.size, 6.3 / grid);
  assert.ok(first.cells.every((cell) => allowed.has(cell.colorHex)));
  assert.ok(new Set(first.cells.map((cell) => cell.colorHex)).size >= 4);
  assert.equal(frontCell(first, 3, 3, grid)?.colorHex, '#000000');
  assert.equal(frontCell(first, 8, 3, grid)?.colorHex, '#000000');
});

test('natural relief keeps compact dark facial features distinct', () => {
  const grid = 9;
  const segmentation = fullFrameSegmentation(grid, (x, y) =>
    y === 2 && (x === 2 || x === 6) ? [12, 12, 12] : [205, 154, 122],
  );

  const model = voxelizeSegmentation(segmentation, 'detailed', 'relief', 'natural');
  const leftEye = frontCell(model, 2, 2, grid);
  const rightEye = frontCell(model, 6, 2, grid);
  const cheek = frontCell(model, 3, 2, grid);

  assert.equal(leftEye?.colorHex, '#000000');
  assert.equal(rightEye?.colorHex, '#000000');
  assert.notEqual(cheek?.colorHex, '#000000');
});

test('a full-frame natural panel keeps the buyer\'s border colours', () => {
  const grid = 9;
  const segmentation = fullFrameSegmentation(grid, (x, y) =>
    x === 0 || y === 0 || x === grid - 1 || y === grid - 1
      ? [24, 74, 190]
      : [218, 76, 44],
  );

  const model = voxelizeSegmentation(segmentation, 'detailed', 'relief', 'natural');
  const border = frontCell(model, 0, 0, grid);
  const interior = frontCell(model, 1, 1, grid);

  assert.notEqual(border?.colorHex, interior?.colorHex);
});

test('a full-frame volume measures depth from the outside border', () => {
  const grid = 8;
  const segmentation = fullFrameSegmentation(grid, () => [180, 120, 80]);
  const model = voxelizeSegmentation(segmentation, 'detailed', 'volume', 'natural');
  const cornerDepth = model.cells.filter((cell) => cell.i === 0 && cell.j === grid - 1).length;
  const centreDepth = model.cells.filter((cell) => cell.i === 3 && cell.j === 4).length;

  assert.equal(cornerDepth, 2);
  assert.ok(centreDepth > cornerDepth);
});

test('a portrait crop keeps its physical aspect ratio in the brick grid', () => {
  const grid = 12;
  const segmentation = {
    ...fullFrameSegmentation(grid, () => [180, 120, 80]),
    aspectRatio: 0.75,
  };
  const model = voxelizeSegmentation(segmentation, 'detailed', 'relief', 'natural');
  const columns = new Set(model.cells.map((cell) => cell.i));
  const rows = new Set(model.cells.map((cell) => cell.j));

  assert.equal(columns.size, 9);
  assert.equal(rows.size, 12);
  assert.equal(model.brickCount, 9 * 12 * 2);
});
