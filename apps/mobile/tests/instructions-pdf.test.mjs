import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire, Module } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compileDir = await mkdtemp(path.join(tmpdir(), 'pixbrik-pdf-guide-'));
const source = path.join(appRoot, 'src', 'lib', 'instructionsPdf.ts');
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

process.env.NODE_PATH = path.join(appRoot, 'node_modules');
Module._initPaths();
const { generateInstructionsPdf } = require(path.join(compileDir, 'lib', 'instructionsPdf.js'));

test.after(async () => {
  delete globalThis.__FOTOBRIK_PDF_CAPTURE__;
  delete globalThis.__FOTOBRIK_PDF_LAST__;
  delete globalThis.__FOTOBRIK_PDF_META__;
  await rm(compileDir, { force: true, recursive: true });
});

function fixture(count) {
  const placements = [];
  const lines = [];
  for (let index = 0; index < count; index++) {
    const part = `part-${index}`;
    placements.push({
      colorId: index + 1,
      i: index % 10,
      j: Math.floor(index / 10),
      k: 0,
      part,
      shape: 'brick',
      spanI: 1,
      spanK: 1,
    });
    lines.push({
      colorId: index + 1,
      colorName: `Colour ${index + 1}`,
      colorRgb: `#${(0x334455 + index * 101).toString(16).slice(-6).padStart(6, '0')}`,
      elementId: null,
      estimated: false,
      imageUrl: null,
      l: 1,
      lineTotalEur: 0.1,
      part,
      partName: `Catalog piece ${index + 1}`,
      quantity: 1,
      skuId: null,
      substituted: false,
      unitPriceEur: 0.1,
      w: 1,
    });
  }
  return {
    bom: {
      colorCount: count,
      isEstimate: false,
      lines,
      placements,
      totalEur: count * 0.1,
      totalParts: count,
    },
    model: { brickCount: 0, cells: [], shell: [], size: 1 },
  };
}

function mediaBox(dataUri) {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const binary = Buffer.from(base64, 'base64').toString('latin1');
  const match = binary.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(match, 'PDF must declare a MediaBox');
  return { height: Number(match[2]), width: Number(match[1]) };
}

for (const [paperSize, expected] of [
  ['a4', { width: 595.28, height: 841.89 }],
  ['letter', { width: 612, height: 792 }],
]) {
  test(`${paperSize} export has the correct paper box and the complete one-piece plan`, async () => {
    const { bom, model } = fixture(7);
    globalThis.__FOTOBRIK_PDF_CAPTURE__ = true;
    const result = await generateInstructionsPdf({
      accent: '#4F46E5',
      action: 'capture',
      bomOverride: bom,
      buildName: 'Kid test build',
      model,
      paperSize,
    });
    const box = mediaBox(globalThis.__FOTOBRIK_PDF_LAST__);
    assert.ok(Math.abs(box.width - expected.width) < 0.1);
    assert.ok(Math.abs(box.height - expected.height) < 0.1);
    assert.equal(result.steps, 7);
    assert.equal(result.plan.steps.length, bom.placements.length);
    assert.equal(new Set(result.plan.placementOrder).size, bom.placements.length);
    assert.equal(globalThis.__FOTOBRIK_PDF_META__.paperSize, paperSize);
  });
}

test('long parts manifests and every microstep paginate instead of truncating', async () => {
  const { bom, model } = fixture(80);
  const result = await generateInstructionsPdf({
    accent: '#4F46E5',
    action: 'capture',
    bomOverride: bom,
    buildName: 'Long inventory',
    model,
    paperSize: 'a4',
  });

  assert.equal(result.totalParts, 80);
  assert.equal(result.steps, 80);
  assert.ok(result.pages >= 25, 'cover + quick start + manifest pages + 20 four-step pages');
  assert.deepEqual([...result.plan.placementOrder].sort((a, b) => a - b), Array.from({ length: 80 }, (_, index) => index));
});

test('PDF export rejects a floating catalog placement before producing output', async () => {
  const { bom, model } = fixture(1);
  bom.placements.push({
    ...bom.placements[0],
    i: 4,
    j: 2,
  });
  bom.lines[0].quantity = 2;
  bom.totalParts = 2;
  delete globalThis.__FOTOBRIK_PDF_LAST__;
  delete globalThis.__FOTOBRIK_PDF_META__;

  await assert.rejects(
    () => generateInstructionsPdf({
      accent: '#4F46E5',
      action: 'capture',
      bomOverride: bom,
      buildName: 'Unsafe floating build',
      model,
      paperSize: 'a4',
    }),
    /safer parts plan/i,
  );
  assert.equal(globalThis.__FOTOBRIK_PDF_LAST__, undefined);
  assert.equal(globalThis.__FOTOBRIK_PDF_META__, undefined);
});
