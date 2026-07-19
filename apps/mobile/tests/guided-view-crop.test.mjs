import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cropPath = path.join(root, 'src', 'lib', 'guidedViewCrop.ts');
const cropSource = await readFile(cropPath, 'utf8');
const compiled = ts.transpileModule(cropSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: cropPath,
}).outputText;
const cropModule = { exports: {} };
new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
  cropModule.exports,
  () => ({}),
  cropModule,
  cropPath,
  path.dirname(cropPath),
);
const { guidedSquareCrop, selectGuidedSubject } = cropModule.exports;

test('an undetected subject receives a centered maximum square crop', () => {
  assert.deepEqual(guidedSquareCrop(1600, 900, null), {
    kind: 'center',
    size: 900,
    x: 350,
    y: 0,
  });
});

test('a detected person is framed as a bounded head-and-shoulders square', () => {
  const detection = {
    height: 0.9,
    label: 'person',
    score: 0.94,
    width: 0.5,
    x: 0.25,
    y: 0.05,
  };
  const crop = guidedSquareCrop(1200, 1800, detection);

  assert.deepEqual(crop, { kind: 'person', size: 840, x: 180, y: 75 });
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.size <= 1200 && crop.y + crop.size <= 1800);
  assert.ok(crop.y + crop.size < (detection.y + detection.height) * 1800);
});

test('an object keeps its full contour with padding even beside an image edge', () => {
  const crop = guidedSquareCrop(1600, 900, {
    height: 0.3,
    label: 'car',
    score: 0.91,
    width: 0.2,
    x: 0.85,
    y: 0.3,
  });

  assert.deepEqual(crop, { kind: 'object', size: 416, x: 1184, y: 197 });
  assert.ok(crop.x + crop.size <= 1600 && crop.y + crop.size <= 900);
});

test('subject selection prioritizes a person, otherwise visual area and confidence', () => {
  const car = { height: 0.6, label: 'car', score: 0.98, width: 0.8, x: 0.1, y: 0.2 };
  const person = { height: 0.5, label: 'person', score: 0.78, width: 0.25, x: 0.4, y: 0.1 };
  const dog = { height: 0.5, label: 'dog', score: 0.8, width: 0.5, x: 0.2, y: 0.2 };

  assert.equal(selectGuidedSubject([car, person]), person);
  assert.equal(selectGuidedSubject([dog, car]), car);
});

test('capture normalizes all saved real views before a paid multiview task', async () => {
  const capture = await readFile(path.join(root, 'src', 'screens', 'Capture360Screen.tsx'), 'utf8');

  assert.match(capture, /const prepared = await normalizeGuidedPhoto\(preparedShots\[view\.id\]!\)/);
  assert.match(capture, /generateBestMeshFromMultiview\(preparedShots/);
  assert.match(capture, /REAL PHOTO .* HEAD \+ SHOULDERS SQUARE/);
  assert.match(capture, /no 3D provider task has started/i);
  assert.doesNotMatch(capture, /removeBackground\(/);
});
