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
  assert.match(app, /if \(needsApprovedBuild && !activeBuild && !sampleUsed\)/);
  assert.match(app, /photoBuild=\{activeBuild\}/);
  assert.match(result, /downstreamDisabled=\{awaitingSculpture \|\| !quoteReady\}/);
  assert.match(dock, /disabled = downstreamDisabled && item\.screen !== 'result'/);
});

test('homepage build choices open their selected capture flow directly', async () => {
  const [app, capture] = await Promise.all([
    source('App.tsx'),
    source('src/screens/CaptureScreen.tsx'),
  ]);
  assert.doesNotMatch(app, /navigate\('mode'\)/);
  assert.match(app, /setCaptureTarget\('panel'\);[\s\S]{0,220}setCaptureMode\('photo'\);\s*navigate\('capture'\)/);
  assert.match(app, /setCaptureTarget\('sculpture'\);[\s\S]{0,220}setCaptureMode\('photo'\);\s*navigate\('capture'\)/);
  assert.match(app, /setCaptureMode\('orbit'\);\s*navigate\('capture'\)/);
  assert.match(capture, /WHAT ARE YOU BUILDING\?/);
  assert.match(capture, /Four real views · no mirrored face or guessed back/);
  assert.match(capture, /Continue to the 3D model/);
});

test('one-photo True 3D reviews only an isolated subject and cannot race person detection', async () => {
  const capture = await source('src/screens/CaptureScreen.tsx');
  assert.match(capture, /accessibilityLabel="True 3D subject review"/);
  assert.match(capture, /TRUE 3D INPUT · SUBJECT ONLY/);
  assert.match(capture, /targetProduct === 'sculpture' \|\| stage !== 'ready'/);
  assert.match(capture, /Smart isolate is required for True 3D/);
  assert.match(capture, /await detectionForPhoto\(sourceUri\)/);
  assert.match(capture, /Remounted unfinished captures need the same detection pass/);
  assert.match(capture, /sculptureDetectedPerson/);
  assert.match(capture, /Continue with 4 guided photos/);
});

test('uncertain True 3D detection requires an explicit subject choice and people fail closed', async () => {
  const [app, capture] = await Promise.all([
    source('App.tsx'),
    source('src/screens/CaptureScreen.tsx'),
  ]);
  assert.match(capture, /type DetectionResolution/);
  assert.match(capture, /setTimeout\(\(\) => resolve\(\{ status: 'unknown' \}\), 8000\)/);
  assert.match(capture, /sculptureSubjectKind === null/);
  assert.match(capture, /Choose Object or Person first/);
  assert.match(capture, /will not guess when subject detection is uncertain/);
  assert.match(capture, /const people = found\.filter\(isPersonDetection\)/);
  assert.match(capture, /if \(targetProduct === 'sculpture' && detected && isPersonDetection\(detected\)\)/);
  assert.match(capture, /onGuided3D\?\.\('person'\)/);
  assert.match(app, /captureSubjectKind === 'person'/);
});

test('guided-person Back returns to the explicit subject choice instead of skipping Home', async () => {
  const app = await source('App.tsx');
  const capture = await source('src/screens/CaptureScreen.tsx');
  assert.match(app, /capture360ReturnsToSubjectChoice/);
  assert.match(app, /setCapture360ReturnsToSubjectChoice\(true\);\s*setCaptureMode\('orbit'\)/);
  assert.match(
    app,
    /if \(capture360ReturnsToSubjectChoice\) \{[\s\S]*?setCapture360ReturnsToSubjectChoice\(false\);[\s\S]*?setCaptureMode\('photo'\);[\s\S]*?return;/,
  );
  assert.match(capture, /People use front, left, back and right photos/);
  assert.match(capture, /Choose Object for one isolated photo/);
});

test('guided person provenance survives generation and drives truthful result sizing', async () => {
  const app = await source('App.tsx');
  assert.match(app, /subject: SculptureSubjectKind/);
  assert.match(app, /subject: guidedCaptureSubject/);
  assert.match(app, /approved3D\?\.subject === 'person'/);
  assert.match(app, /setGuidedCaptureSubject\(approved3D\.subject\)/);
});

test('native True 3D cannot start a provider task and offers an honest route back', async () => {
  const [app, capture] = await Promise.all([
    source('App.tsx'),
    source('src/screens/CaptureScreen.tsx'),
  ]);
  assert.match(app, /if \(Platform\.OS !== 'web'\) \{/);
  assert.match(app, /No provider task was started/);
  assert.match(capture, /const native3DUnavailable = targetProduct === 'sculpture' && !webFlow/);
  assert.match(capture, /True 3D needs the web app · Go back/);
  assert.match(capture, /No photo will be uploaded here/);
});

test('saved builds preserve product provenance and legacy entries default safely', async () => {
  const [app, gallery] = await Promise.all([
    source('App.tsx'),
    source('src/lib/buildGallery.ts'),
  ]);
  assert.match(gallery, /provenance\?: SavedBuildProvenance/);
  assert.match(gallery, /metadata: SavedBuildMetadata/);
  assert.match(gallery, /source3DSubject\?: SavedBuildSubject/);
  assert.match(app, /provenance: 'flat-photo'/);
  assert.match(app, /provenance: 'provider-3d'/);
  assert.match(app, /saved\.provenance === 'provider-3d' \|\| saved\.provenance === 'library'/);
  assert.match(app, /restoredAsSculpture \? \(saved\.mode \?\? 'volume'\) : 'relief'/);
  assert.match(app, /const restoredSubject = saved\.source3DSubject \?\? 'object'/);
  assert.match(app, /source3DSubject: guidedCaptureSubject/);
  assert.match(app, /subject: restoredSubject/);
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
  assert.match(app, /humanSubject=\{\s*humanSubjectRequiresGuided3D \|\| approved3D\?\.subject === 'person'\s*\}/);
  assert.match(result, /AI guesses unseen sides/);
  assert.match(result, /Take 4 guided photos of this person/);
  assert.match(result, /This is an object — generate one-photo mesh/);
  assert.match(result, /Contains a person — use 4 real views instead/);
  assert.match(result, /pending3DMeshUrl/);
  assert.match(result, /modelUrl=\{pending3DMeshUrl\}/);
  assert.match(result, /pendingMeshReady/);
  assert.match(capture360, /previewRequestRef/);
  assert.match(capture360, /pendingMeshUrlRef\.current !== meshUrl/);
  assert.match(capture360, /onProviderTaskCreated/);
  assert.match(mode, /Four real views are required for people/);
  assert.match(capture360, /The back photo is essential for people/);
  assert.match(capture360, /RawMeshView/);
});
