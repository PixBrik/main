import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire, Module } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compileDir = await mkdtemp(path.join(tmpdir(), 'pixbrik-mesh-fidelity-'));
const source = path.join(appRoot, 'src', 'lib', 'photoEngine', 'meshVoxelize.web.ts');
const orderSource = path.join(appRoot, 'src', 'lib', 'orderStore.ts');
const tsc = path.join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');

await execFileAsync(process.execPath, [
  tsc,
  source,
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

// Compiled test modules live in the OS temp directory. Let their CommonJS
// imports resolve the app's installed Three.js packages.
process.env.NODE_PATH = path.join(appRoot, 'node_modules');
Module._initPaths();

const { voxelizeGlb } = require(path.join(
  compileDir,
  'lib',
  'photoEngine',
  'meshVoxelize.web.js',
));
const { colorizeMeshCells, MESH_BW_RAMP, recolorMeshModel } = require(path.join(
  compileDir,
  'lib',
  'photoEngine',
  'meshFidelity.js',
));
const { BRICK_HEIGHT_RATIO, buildModelFromCells } = require(path.join(compileDir, 'lib', 'voxelFox.js'));
const { SCULPTURE_STUD_SPAN, STUD_PITCH_CM } = require(path.join(compileDir, 'lib', 'kitSizing.js'));
const { brickify } = require(path.join(compileDir, 'lib', 'brickify.js'));
const { loadOrderModel, snapshotOrderModel } = require(path.join(
  compileDir,
  'lib',
  'orderStore.js',
));

test.after(async () => {
  await rm(compileDir, { force: true, recursive: true });
});

function pad4(value) {
  return (value + 3) & ~3;
}

function box(min, max, positions, indices) {
  const start = positions.length / 3;
  positions.push(
    min[0], min[1], min[2],
    max[0], min[1], min[2],
    max[0], max[1], min[2],
    min[0], max[1], min[2],
    min[0], min[1], max[2],
    max[0], min[1], max[2],
    max[0], max[1], max[2],
    min[0], max[1], max[2],
  );
  const faces = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
  ];
  indices.push(...faces.map((index) => index + start));
}

/** Closed asymmetric fixture: a body plus a two-voxel-class thin side arm. */
function asymmetricGlb() {
  const positions = [];
  const indices = [];
  box([-1, 0, -0.6], [1, 2, 0.6], positions, indices);
  box([0.8, 1.48, -0.12], [2.8, 1.72, 0.12], positions, indices);

  const positionBytes = new Uint8Array(new Float32Array(positions).buffer);
  const positionLength = pad4(positionBytes.byteLength);
  const indexBytes = new Uint8Array(new Uint16Array(indices).buffer);
  const binLength = pad4(positionLength + indexBytes.byteLength);
  const binary = new Uint8Array(binLength);
  binary.set(positionBytes, 0);
  binary.set(indexBytes, positionLength);

  const json = {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        max: [2.8, 2, 0.6],
        min: [-1, 0, -0.6],
        type: 'VEC3',
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    asset: { version: '2.0' },
    bufferViews: [
      { buffer: 0, byteLength: positionBytes.byteLength, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: indexBytes.byteLength, byteOffset: positionLength, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.62, 0.22, 0.1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(encoded.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binLength;
  const result = new ArrayBuffer(totalLength);
  const view = new DataView(result);
  const bytes = new Uint8Array(result);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(encoded, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  bytes.set(binary, binHeader + 8);
  return result;
}

function geometry(model) {
  return model.cells.map((cell) => `${cell.i}|${cell.j}|${cell.k}`);
}

function bounds(model) {
  return model.cells.reduce(
    (result, cell) => ({
      maxI: Math.max(result.maxI, cell.i),
      maxJ: Math.max(result.maxJ, cell.j),
      maxK: Math.max(result.maxK, cell.k),
      minI: Math.min(result.minI, cell.i),
      minJ: Math.min(result.minJ, cell.j),
      minK: Math.min(result.minK, cell.k),
    }),
    { maxI: -Infinity, maxJ: -Infinity, maxK: -Infinity, minI: Infinity, minJ: Infinity, minK: Infinity },
  );
}

function connectedCellCount(model) {
  const present = new Set(geometry(model));
  const first = present.values().next().value;
  const seen = new Set(first ? [first] : []);
  const queue = first ? [first] : [];
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (queue.length) {
    const current = queue.shift();
    const [i, j, k] = current.split('|').map(Number);
    for (const [di, dj, dk] of directions) {
      const next = `${i + di}|${j + dj}|${k + dk}`;
      if (present.has(next) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

test('triangle-box conversion preserves asymmetric proportions and the thin attached arm at every profile', { timeout: 45_000 }, async () => {
  const models = await voxelizeGlb(asymmetricGlb(), undefined, { colorStyle: 'natural' });
  for (const profile of ['efficient', 'balanced', 'detailed']) {
    const model = models[profile];
    const extent = bounds(model);
    const width = extent.maxI - extent.minI + 1;
    const height = extent.maxJ - extent.minJ + 1;
    const depth = extent.maxK - extent.minK + 1;
    const verticalPitch = (model.layerHeight ?? model.size) / model.size;
    const physicalLongestStuds = Math.max(width, depth, height * verticalPitch);
    assert.ok(
      Math.abs(physicalLongestStuds - SCULPTURE_STUD_SPAN[profile]) <= 1.25,
      `${profile}: physical size follows its real stud target`,
    );
    assert.ok(
      physicalLongestStuds * STUD_PITCH_CM <= 40,
      `${profile}: proposal is gift-sized rather than the old 32–70 cm range`,
    );
    assert.equal(verticalPitch, BRICK_HEIGHT_RATIO, `${profile}: standard brick pitch`);
    assert.ok(
      Math.abs((height * verticalPitch) / width - 2 / 3.8) < 0.07,
      `${profile}: physical height ratio`,
    );
    assert.ok(Math.abs(depth / width - 1.2 / 3.8) < 0.06, `${profile}: depth ratio`);
    assert.equal(connectedCellCount(model), model.cells.length, `${profile}: attached arm disconnected`);

    const tip = model.cells.filter((cell) => cell.i >= extent.maxI - 1);
    assert.ok(tip.length >= 4, `${profile}: thin asymmetric tip was erased`);
    assert.ok(new Set(tip.map((cell) => cell.j)).size < height / 3, `${profile}: arm inflated into body`);
  }
});

test('natural palette ignores hidden-volume colours and does not promote a one-cell camouflage outlier', () => {
  const surface = [];
  for (let index = 0; index < 150; index++) {
    surface.push({
      colorHex: index === 149 ? '#708348' : index < 100 ? '#C98263' : '#542B20',
      cx: index % 15,
      cy: Math.floor(index / 15),
      cz: 0,
      i: index % 15,
      j: Math.floor(index / 15),
      k: 0,
      zone: 'body',
    });
  }
  const interior = Array.from({ length: 1200 }, (_, index) => ({
    colorHex: index % 2 ? '#555631' : '#7C9150',
    cx: index,
    cy: 0,
    cz: 1,
    i: index,
    j: 0,
    k: 1,
    zone: 'body',
  }));
  const repeatSurface = structuredClone(surface);
  const repeatInterior = structuredClone(interior);

  colorizeMeshCells(surface, interior, 'natural');
  colorizeMeshCells(repeatSurface, repeatInterior, 'natural');

  assert.deepEqual(repeatSurface, surface);
  assert.deepEqual(repeatInterior, interior);
  assert.equal(new Set(interior.map((cell) => cell.colorHex)).size, 1, 'hidden volume leaked arbitrary colours');
  const military = new Set(['#555631', '#7C9150', '#A0BCAC', '#D9E4A7']);
  assert.ok(surface.every((cell) => !military.has(cell.colorHex)), 'single olive texel became a visible palette zone');
});

test('B&W preview preserves identical geometry and shell metadata across all converted profiles', { timeout: 45_000 }, async () => {
  const natural = await voxelizeGlb(asymmetricGlb(), undefined, { colorStyle: 'natural' });
  for (const profile of ['efficient', 'balanced', 'detailed']) {
    const source = natural[profile];
    const before = structuredClone(source);
    const bw = recolorMeshModel(source, 'bw');
    assert.deepEqual(geometry(bw), geometry(source), `${profile}: occupied cells changed`);
    assert.equal(bw.brickCount, source.brickCount);
    assert.equal(bw.exposedFaceCount, source.exposedFaceCount);
    assert.deepEqual(
      bw.shell.map(({ i, j, k, exposed, shape, facing }) => ({ exposed, facing, i, j, k, shape })),
      source.shell.map(({ i, j, k, exposed, shape, facing }) => ({ exposed, facing, i, j, k, shape })),
    );
    assert.ok(bw.cells.every((cell) => MESH_BW_RAMP.includes(cell.colorHex)));
    assert.deepEqual(source, before, `${profile}: natural source was mutated`);
  }
});

test('library colour and demo assets cannot reintroduce geometry erosion or background props', async () => {
  const [imageTo3D, library, voxelizer] = await Promise.all([
    readFile(path.join(appRoot, 'src/lib/photoEngine/imageTo3D.ts'), 'utf8'),
    readFile(path.join(appRoot, 'src/data/carLibrary.ts'), 'utf8'),
    readFile(path.join(appRoot, 'src/lib/photoEngine/meshVoxelize.web.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(imageTo3D, /buildModelFromCells\(cells, model\.size, \{ slopes: true \}\)/);
  assert.match(imageTo3D, /return \{ \.\.\.model, cells, shell \}/);
  assert.match(imageTo3D, /quantizeToCatalog\(/);
  assert.doesNotMatch(library, /Models\/ToyCar/);
  assert.match(library, /Models\/CarConcept\/glTF-Binary\/CarConcept\.glb/);
  assert.match(voxelizer, /prep\.bounds\.intersectsBox\(voxelBox\)/);
});

test('order snapshot round-trip preserves approved shape metadata and physical pitch', () => {
  const sourceModel = buildModelFromCells(
    [
      { colorHex: '#A0A19F', cx: 0, cy: 0.3, cz: 0, facing: 1, i: 0, j: 0, k: 0, shape: 'slope', zone: 'body' },
      { colorHex: '#A0A19F', cx: 0, cy: 0.3, cz: -0.5, i: 0, j: 0, k: -1, zone: 'body' },
    ],
    0.5,
    { layerHeight: 0.6, preserveShapes: true },
  );
  const restored = loadOrderModel(snapshotOrderModel(sourceModel));

  assert.equal(restored.layerHeight, 0.6);
  assert.deepEqual(geometry(restored), geometry(sourceModel));
  assert.deepEqual(
    restored.cells.map(({ i, j, k, shape, facing }) => ({ facing, i, j, k, shape })),
    sourceModel.cells.map(({ i, j, k, shape, facing }) => ({ facing, i, j, k, shape })),
  );
});

test('order snapshot resolves zoned cells with the selected accent instead of corrupting them to orange', () => {
  const sourceModel = buildModelFromCells(
    [{ cx: 0, cy: 0.25, cz: 0, i: 0, j: 0, k: 0, zone: 'accent' }],
    0.5,
    { preserveShapes: true },
  );
  const snapshot = snapshotOrderModel(sourceModel, '#4F46E5');
  const restored = loadOrderModel(snapshot);

  assert.deepEqual(snapshot.palette, ['#4F46E5']);
  assert.equal(restored.cells[0].colorHex, '#4F46E5');
});

test('catalog slope placement preserves its full two-stud footprint and facing', () => {
  const model = buildModelFromCells(
    [
      { colorHex: '#A0A19F', cx: 0, cy: 0.3, cz: 0, facing: 1, i: 0, j: 0, k: 0, shape: 'slope', zone: 'body' },
      { colorHex: '#A0A19F', cx: 0, cy: 0.3, cz: -0.5, i: 0, j: 0, k: -1, zone: 'body' },
    ],
    0.5,
    { layerHeight: 0.6, preserveShapes: true },
  );
  const placement = brickify(model, '#A0A19F').placements.find((candidate) => candidate.shape === 'slope');

  assert.ok(placement);
  assert.equal(placement.facing, 1);
  assert.equal(placement.spanI, 1);
  assert.equal(placement.spanK, 2);
  assert.equal(placement.k, -1);
});
