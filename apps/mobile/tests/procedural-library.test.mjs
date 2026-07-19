import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compileDir = await mkdtemp(path.join(tmpdir(), 'pixbrik-library-'));
const tsc = path.join(appRoot, 'node_modules', 'typescript', 'bin', 'tsc');

try {
  await execFileAsync(process.execPath, [
    tsc,
    path.join(appRoot, 'src', 'lib', 'proceduralLibrary.ts'),
    path.join(appRoot, 'src', 'data', 'carLibrary.ts'),
    '--ignoreConfig', '--outDir', compileDir, '--target', 'ES2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--resolveJsonModule', '--esModuleInterop', '--skipLibCheck',
    '--strict', '--noUncheckedIndexedAccess', '--ignoreDeprecations', '6.0', '--noEmitOnError', 'false',
  ]);
} catch (error) {
  // The production assessment facade legitimately contains import.meta so
  // Metro can split a browser worker. This focused Node test is CommonJS;
  // TypeScript still emits every file, and below we replace only that facade
  // with the exact shared assessment core (not a permissive fake).
  if (!String(error?.stdout).includes("The 'import.meta' meta-property is only allowed")) throw error;
}

const { LIBRARY_SEED } = require(path.join(compileDir, 'data', 'carLibrary.js'));
const assessmentFacadePath = path.join(compileDir, 'lib', 'kitAssessment.js');
const { computeBuildAssessment } = require(path.join(compileDir, 'lib', 'kitAssessmentCore.js'));
require.cache[assessmentFacadePath] = {
  exports: { assessBuildAsync: async (model, accent) => computeBuildAssessment(model, accent) },
  filename: assessmentFacadePath,
  id: assessmentFacadePath,
  loaded: true,
};
const {
  buildProceduralLibraryEntry,
  buildProceduralLibraryProfile,
  isLibraryEntryReleased,
  releasedProceduralLibraryProfiles,
} = require(path.join(compileDir, 'lib', 'proceduralLibrary.js'));
test.after(async () => rm(compileDir, { force: true, recursive: true }));

function componentCount(model) {
  const unseen = new Set(model.cells.map((cell) => `${cell.i}|${cell.j}|${cell.k}`));
  const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let count = 0;
  while (unseen.size) {
    count += 1;
    const seed = unseen.values().next().value;
    unseen.delete(seed);
    const queue = [seed];
    while (queue.length) {
      const [i,j,k] = queue.pop().split('|').map(Number);
      for (const [di,dj,dk] of directions) {
        const next = `${i+di}|${j+dj}|${k+dk}`;
        if (unseen.delete(next)) queue.push(next);
      }
    }
  }
  return count;
}

function geometrySignature(model) {
  const minI = Math.min(...model.cells.map((cell) => cell.i));
  const minJ = Math.min(...model.cells.map((cell) => cell.j));
  const minK = Math.min(...model.cells.map((cell) => cell.k));
  return model.cells
    .map((cell) => `${cell.i-minI},${cell.j-minJ},${cell.k-minK},${cell.zone}`)
    .sort().join(';');
}

test('curated library is large, normalized, unique and fully buildable', () => {
  assert.ok(LIBRARY_SEED.length >= 100);
  assert.equal(new Set(LIBRARY_SEED.map((entry) => entry.id)).size, LIBRARY_SEED.length);
  for (const entry of LIBRARY_SEED) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(entry.name, entry.name.trim());
    assert.ok(entry.proceduralKey || entry.meshUrl, `${entry.id} has no build source`);
  }
});

test('every procedural item is connected, distinct and gains real detail by profile', () => {
  const signatures = new Map();
  for (const entry of LIBRARY_SEED) {
    const options = {
      flowerColors: ['#D7263D','#F05A7E','#F4C430','#6C3DBA','#F4F1E8'],
      flowerCount: 5,
      holder: 'freestanding',
      message: entry.presetMessage,
    };
    const efficient = buildProceduralLibraryProfile(entry, entry.defaultColor, options, 'efficient');
    const balanced = buildProceduralLibraryProfile(entry, entry.defaultColor, options, 'balanced');
    const detailed = buildProceduralLibraryProfile(entry, entry.defaultColor, options, 'detailed');
    assert.ok(efficient.cells.length >= 8, `${entry.id} is too small to read`);
    assert.ok(balanced.cells.length > efficient.cells.length, `${entry.id} Classic adds no detail`);
    assert.ok(detailed.cells.length > balanced.cells.length, `${entry.id} Showcase adds no detail`);
    assert.equal(componentCount(efficient), 1, `${entry.id} Mini contains floating islands`);
    assert.equal(componentCount(balanced), 1, `${entry.id} Classic contains floating islands`);
    assert.equal(componentCount(detailed), 1, `${entry.id} Showcase contains floating islands`);
    const signature = geometrySignature(efficient);
    assert.equal(signatures.has(signature), false, `${entry.id} duplicates ${signatures.get(signature)}`);
    signatures.set(signature, entry.id);
  }
});

test('catalog visibility fails closed for profiles that have not passed physical certification', () => {
  const pending = LIBRARY_SEED.find((candidate) => candidate.id === 'sunflower-bloom');
  assert.ok(pending);
  assert.equal(isLibraryEntryReleased(pending), false);
  assert.deepEqual(releasedProceduralLibraryProfiles(pending), []);
  for (const entry of LIBRARY_SEED.filter(isLibraryEntryReleased)) {
    const profiles = releasedProceduralLibraryProfiles(entry);
    assert.ok(profiles.length > 0, `${entry.id} is visible without a certified size`);
    assert.equal(profiles.includes('detailed'), false, `${entry.id} advertises uncertified Showcase`);
  }
});

test('generation only advertises requested profiles with a buildable physical fill', async () => {
  const entry = LIBRARY_SEED.find((candidate) => candidate.id === 'classic-coupe') ?? LIBRARY_SEED[0];
  assert.ok(entry);
  for (const profile of releasedProceduralLibraryProfiles(entry)) {
    const progress = [];
    const build = await buildProceduralLibraryEntry(entry, entry.defaultColor, { size: profile }, (value) => {
      progress.push(value);
    });
    assert.deepEqual(build.availableProfiles, [profile]);
    const assessment = computeBuildAssessment(build.models[profile], entry.defaultColor);
    assert.equal(assessment.full.buildable || assessment.hollow.buildable, true);
    assert.equal(progress.at(-1), 1);
  }
});
