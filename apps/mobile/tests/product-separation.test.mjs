import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('an unapproved sculpture cannot enter the purchasing or build flow', async () => {
  const [app, dock, result] = await Promise.all([
    source('App.tsx'),
    source('src/components/DemoDock.tsx'),
    source('src/screens/ResultScreen.tsx'),
  ]);
  assert.match(app, /const activeBuild = buildProduct === 'panel' \? panelBuild : sculptureBuild/);
  assert.match(app, /if \(needsApprovedBuild && !activeBuild\)/);
  assert.match(app, /photoBuild=\{activeBuild\}/);
  assert.match(result, /downstreamDisabled=\{awaitingSculpture\}/);
  assert.match(dock, /disabled = downstreamDisabled && item\.screen !== 'result'/);
});

test('saved builds preserve product provenance and legacy entries default safely', async () => {
  const [app, gallery] = await Promise.all([
    source('App.tsx'),
    source('src/lib/buildGallery.ts'),
  ]);
  assert.match(gallery, /provenance\?: SavedBuildProvenance/);
  assert.match(gallery, /metadata: SavedBuildMetadata/);
  assert.match(app, /provenance: 'flat-photo'/);
  assert.match(app, /provenance: 'provider-3d'/);
  assert.match(app, /saved\.provenance === 'provider-3d' \|\| saved\.provenance === 'library'/);
  assert.match(app, /restoredAsSculpture \? \(saved\.mode \?\? 'volume'\) : 'relief'/);
});

test('photo and crop revisions discard stale async rendering results', async () => {
  const [app, capture] = await Promise.all([
    source('App.tsx'),
    source('src/screens/CaptureScreen.tsx'),
  ]);
  assert.match(app, /photoInputRevisionRef\.current !== sourceRevision/);
  assert.match(capture, /currentPhotoUriRef\.current !== sourceUri/);
  assert.match(capture, /buildRevisionRef\.current !== buildRevision/);
});

test('generation inputs enforce one aggregate serverless payload budget', async () => {
  const imageTo3D = await source('src/lib/photoEngine/imageTo3D.ts');
  assert.match(imageTo3D, /MAX_GENERATION_JSON_CHARS = 3_600_000/);
  assert.match(imageTo3D, /compactSingleWithinBudget/);
  assert.match(imageTo3D, /compactMultiviewWithinBudget/);
  assert.match(imageTo3D, /JSON\.stringify\(\{ views \}\)\.length <= MAX_GENERATION_JSON_CHARS/);
});

test('people route to four views while objects retain honest one-photo inference', async () => {
  const [app, imageTo3D, mode, result, capture360] = await Promise.all([
    source('App.tsx'),
    source('src/lib/photoEngine/imageTo3D.ts'),
    source('src/screens/ModeScreen.tsx'),
    source('src/screens/ResultScreen.tsx'),
    source('src/screens/Capture360Screen.tsx'),
  ]);
  assert.match(imageTo3D, /requiresGuidedMultiview/);
  assert.match(imageTo3D, /GuidedMultiviewRequiredError/);
  assert.match(app, /humanSubjectRequiresGuided3D/);
  assert.match(app, /humanSubject=\{humanSubjectRequiresGuided3D\}/);
  assert.match(result, /AI guesses unseen sides/);
  assert.match(result, /Take 4 guided photos of this person/);
  assert.match(result, /This is an object — generate one-photo mesh/);
  assert.match(result, /Contains a person — use 4 real views instead/);
  assert.match(result, /FRONT', 'RIGHT', 'BACK', 'LEFT/);
  assert.match(result, /resizeMode="contain"/);
  assert.match(mode, /Four real views are required for people/);
  assert.match(capture360, /prevent the AI from inventing or mirroring a face/);
});
