import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire, Module } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compileDir = await mkdtemp(path.join(tmpdir(), 'pixbrik-reinforced-hollow-'));
const brickifySource = path.join(appRoot, 'src', 'lib', 'brickify.ts');
const assemblySource = path.join(appRoot, 'src', 'lib', 'instructions', 'assemblyPlan.ts');
// A second entry below `src` keeps TypeScript's inferred root stable, matching
// the layout used by the other behavioural converter tests.
const orderSource = path.join(appRoot, 'src', 'lib', 'orderStore.ts');
const tsc = path.join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');

await execFileAsync(process.execPath, [
  tsc,
  brickifySource,
  assemblySource,
  orderSource,
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

process.env.NODE_PATH = path.join(appRoot, 'node_modules');
Module._initPaths();

const { brickify, catalogColorFor, hollowBuildModel } = require(path.join(compileDir, 'lib', 'brickify.js'));
const { createAssemblyPlan, isAssemblyBuildable } = require(path.join(compileDir, 'lib', 'instructions', 'assemblyPlan.js'));
const { createOrder } = require(path.join(compileDir, 'lib', 'orderStore.js'));
const { buildModelFromCells, getVoxelModel } = require(path.join(compileDir, 'lib', 'voxelFox.js'));
const { voxelBaseColor } = require(path.join(compileDir, 'lib', 'voxelRender.js'));

test.after(async () => {
  await rm(compileDir, { force: true, recursive: true });
});

const keyOf = (cell) => `${cell.i}|${cell.j}|${cell.k}`;

function boxCells(width, height, depth) {
  const cells = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      for (let k = 0; k < depth; k++) {
        cells.push({
          colorHex: '#A0A19F',
          cx: i + 0.5,
          cy: j + 0.5,
          cz: k + 0.5,
          i,
          j,
          k,
          zone: 'body',
        });
      }
    }
  }
  return cells;
}

function modelFrom(cells) {
  return buildModelFromCells(cells, 1, { preserveShapes: true });
}

function placementKeys(bom) {
  const result = new Set();
  for (const placement of bom.placements) {
    for (let di = 0; di < placement.spanI; di++) {
      for (let dk = 0; dk < placement.spanK; dk++) {
        result.add(`${placement.i + di}|${placement.j}|${placement.k + dk}`);
      }
    }
  }
  return result;
}

test('reinforced hollow keeps the exterior, bonded base and deterministic support lattice', () => {
  const cells = boxCells(12, 10, 12);
  const marked = cells.find((cell) => cell.i === 5 && cell.j === 9 && cell.k === 0);
  marked.colorHex = '#FF0000';
  marked.shape = 'slope';
  marked.facing = 1;
  const full = modelFrom(cells);
  const hollow = hollowBuildModel(full);
  const hollowAgain = hollowBuildModel(full);
  const sourceByKey = new Map(full.cells.map((cell) => [keyOf(cell), cell]));
  const hollowByKey = new Map(hollow.cells.map((cell) => [keyOf(cell), cell]));

  assert.ok(hollow.cells.length < full.cells.length, 'a solid volume must lose hidden core cells');
  assert.deepEqual(hollow.cells.map(keyOf), hollowAgain.cells.map(keyOf), 'output ordering must be deterministic');
  assert.ok(hollow.cells.every((cell) => sourceByKey.has(keyOf(cell))), 'supports must never leave the source volume');

  for (const exterior of full.shell) {
    const retained = hollowByKey.get(keyOf(exterior));
    assert.ok(retained, `exterior cell ${keyOf(exterior)} was removed`);
    assert.equal(retained.colorHex, exterior.colorHex, `colour changed at ${keyOf(exterior)}`);
    assert.equal(retained.shape, exterior.shape, `shape changed at ${keyOf(exterior)}`);
    assert.equal(retained.facing, exterior.facing, `facing changed at ${keyOf(exterior)}`);
  }

  for (const source of full.cells) {
    if (source.j <= 1) {
      assert.ok(hollowByKey.has(keyOf(source)), `base cell ${keyOf(source)} was removed`);
    }
  }

  // Sparse two-stud columns run continuously through the hidden core. The
  // off-column interior probe proves this is not a disguised solid build.
  for (let j = 0; j < 10; j++) {
    assert.ok(hollowByKey.has(`3|${j}|3`), `support column is broken at layer ${j}`);
  }
  assert.equal(hollowByKey.has('6|5|6'), false, 'off-column hidden core was not hollowed');

  const reversed = modelFrom(structuredClone(cells).reverse());
  assert.deepEqual(
    hollowBuildModel(reversed).cells.map(keyOf),
    hollow.cells.map(keyOf),
    'equivalent shuffled input must produce the same canonical kit',
  );
});

test('hollow quoting packs the identical reinforced cells and uses fewer parts on a volume', () => {
  const full = modelFrom(boxCells(20, 20, 20));
  const hollowModel = hollowBuildModel(full);
  const fullBom = brickify(full, '#A0A19F');
  const hollowBom = brickify(full, '#A0A19F', { hollow: true });

  assert.deepEqual(
    [...placementKeys(hollowBom)].sort(),
    hollowModel.cells.map(keyOf).sort(),
    'hollow preview/order cells and hollow BOM placements diverged',
  );
  assert.ok(
    hollowBom.totalParts < fullBom.totalParts,
    `reinforced hollow should reduce part count (${hollowBom.totalParts} !< ${fullBom.totalParts})`,
  );
  for (const [label, packed] of [['solid', fullBom], ['hollow', hollowBom]]) {
    const plan = createAssemblyPlan(packed);
    assert.equal(plan.supportSummary.unsupported, 0, `${label} guide contains a floating action`);
    assert.equal(plan.warnings.some((entry) => entry.severity === 'error'), false);
    assert.equal(isAssemblyBuildable(packed), true, `${label} volume should pass the release gate`);
  }
});

test('one-cell-thick and already-shell models stay intact with negligible hollow saving', () => {
  const thin = modelFrom(boxCells(11, 7, 1));
  const hollow = hollowBuildModel(thin);
  const fullBom = brickify(thin, '#A0A19F');
  const hollowBom = brickify(thin, '#A0A19F', { hollow: true });

  assert.deepEqual(hollow.cells.map(keyOf), thin.cells.map(keyOf));
  assert.equal(hollowBom.totalParts, fullBom.totalParts);
  assert.deepEqual([...placementKeys(hollowBom)].sort(), thin.cells.map(keyOf).sort());
});

test('standard sculpture packings are connected or explicitly fail the release gate', () => {
  const disconnected = {};
  const examples = {};
  let firstNeighbourhood = null;
  for (const profile of ['efficient', 'balanced', 'detailed']) {
    const model = getVoxelModel(profile);
    for (const [fill, packed] of [
      ['solid', brickify(model, '#E4B000')],
      ['hollow', brickify(model, '#E4B000', { hollow: true })],
    ]) {
      const plan = createAssemblyPlan(packed);
      disconnected[`${profile}-${fill}`] = plan.supportSummary.unsupported;
      assert.equal(
        isAssemblyBuildable(packed),
        plan.supportSummary.unsupported === 0 && !plan.warnings.some((warning) => warning.severity === 'error'),
        `${profile}-${fill} release gate disagrees with its exact frozen assembly plan`,
      );
      examples[`${profile}-${fill}`] = plan.steps
        .filter((step) => step.support.status === 'unsupported')
        .slice(0, 8)
        .map((step) => [step.placement.i, step.placement.j, step.placement.k, step.placement.spanI, step.placement.spanK]);
      if (!firstNeighbourhood && profile === 'efficient' && fill === 'solid') {
        const first = plan.steps.find((step) => step.support.status === 'unsupported')?.placement;
        if (first) {
          const cells = new Map(model.cells.map((cell) => [keyOf(cell), cell]));
          firstNeighbourhood = model.cells
            .filter((cell) => cell.j === first.j && Math.abs(cell.i - first.i) <= 3 && Math.abs(cell.k - first.k) <= 3)
            .map((cell) => ({
              at: [cell.i, cell.j, cell.k],
              color: cell.colorHex,
              packedColor: catalogColorFor(cell.colorHex ?? voxelBaseColor({ ...cell, exposed: [] }, '#E4B000')).id,
              colorIndex: cell.colorIndex,
              zone: cell.zone,
              exposed: cell.exposed,
              above: cells.has(`${cell.i}|${cell.j + 1}|${cell.k}`),
              below: cells.has(`${cell.i}|${cell.j - 1}|${cell.k}`),
            }));
        }
      }
    }
  }
  assert.ok(
    Object.values(disconnected).some((count) => count > 0),
    `fixture must exercise the fail-closed path: ${JSON.stringify(disconnected)}; examples: ${JSON.stringify(examples)}; first: ${JSON.stringify(firstNeighbourhood)}`,
  );
});

test('order persistence performs no write for an unsupported packing', () => {
  let writes = 0;
  globalThis.localStorage = {
    clear() {},
    getItem() { return null; },
    key() { return null; },
    length: 0,
    removeItem() {},
    setItem() { writes++; },
  };
  try {
    const model = modelFrom([
      { colorHex: '#A0A19F', i: 0, j: 0, k: 0 },
      { colorHex: '#A0A19F', i: 4, j: 2, k: 0 },
    ]);
    const order = createOrder({
      accent: '#A0A19F',
      buildId: null,
      buildName: 'Floating fixture',
      countryCode: 'FR',
      currency: 'EUR',
      currencySymbol: '€',
      deliveryRange: 'test only',
      fill: 'solid',
      guest: true,
      kitPrice: 1,
      model,
      paletteMode: 'natural',
      product: 'sculpture',
      profile: 'efficient',
      selectedVariant: 'efficient',
      shippingPrice: 0,
      style: 'natural',
      totalPrice: 1,
    });
    assert.equal(order, null);
    assert.equal(writes, 0);
  } finally {
    delete globalThis.localStorage;
  }
});
