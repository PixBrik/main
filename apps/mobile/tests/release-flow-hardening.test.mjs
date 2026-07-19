import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('live manuals pack the approved full model exactly once with the chosen fill', async () => {
  const [app, instructions] = await Promise.all([
    source('App.tsx'),
    source('src/screens/InstructionsScreen.tsx'),
  ]);

  assert.match(app, /buildFill=\{buildFill\}[\s\S]*?model=\{activeModel\}/);
  assert.doesNotMatch(app, /hollowBuildModel\(activeModel\)/);
  assert.match(instructions, /buildFill\?: BuildFill/);
  assert.match(instructions, /brickify\(model, accent, \{ hollow: buildFill === 'hollow' \}\)/);
});

test('browser Back and Forward restore the exact screen stack and cannot abandon paid work', async () => {
  const [app, frame, capture, capture360, result, library] = await Promise.all([
    source('App.tsx'),
    source('src/components/ScreenFrame.tsx'),
    source('src/screens/CaptureScreen.tsx'),
    source('src/screens/Capture360Screen.tsx'),
    source('src/screens/ResultScreen.tsx'),
    source('src/screens/LibraryScreen.tsx'),
  ]);

  assert.match(app, /pixbrikHistory: \[\.\.\.history, screen\]/);
  assert.match(app, /setHistory\(browserHistoryFromState\(entry\?\.pixbrikHistory\)\)/);
  assert.match(app, /isDemoScreen\(stateScreen\)/);
  assert.match(app, /if \(navigationLockedRef\.current\) \{[\s\S]*?window\.history\.forward\(\)/);
  assert.match(app, /addEventListener\('beforeunload', onBeforeUnload\)/);
  assert.match(frame, /navigationDisabled\?: boolean/);
  assert.match(capture, /navigationDisabled=\{navigationBusy\}/);
  assert.match(capture360, /const paidResultProtected = generationBusy \|\| pendingMeshUrl !== null/);
  assert.match(capture360, /navigationDisabled=\{paidResultProtected\}/);
  assert.match(result, /const paidResultProtected = true3DState === 'working' \|\| !!pending3DMeshUrl/);
  assert.match(result, /onNavigationLockChange\?\.\(paidResultProtected\)/);
  assert.match(result, /navigationDisabled=\{paidResultProtected\}/);
  assert.match(library, /navigationDisabled=\{generating\}/);
});

test('a replacement photo owns a fresh subject decision and smart upload requires rights', async () => {
  const capture = await source('src/screens/CaptureScreen.tsx');

  assert.match(
    capture,
    /subjectChoiceOriginRef\.current = null;\s*onSculptureSubjectKindChange\(null\);/,
  );
  assert.match(capture, /else if \(subjectChoiceOriginRef\.current !== 'user'\)/);
  assert.match(capture, /if \(nextMode === 'smart' && !rightsConfirmed\)/);
  assert.match(capture, /const isolationNeedsRights =/);
  assert.match(capture, /Confirm you own the photo before upload/);
});

test('flat and newly generated builds reset fill while gallery previews update in place', async () => {
  const [app, gallery] = await Promise.all([
    source('App.tsx'),
    source('src/lib/buildGallery.ts'),
  ]);

  assert.ok((app.match(/setBuildFill\('hollow'\)/g) ?? []).length >= 10);
  assert.match(app, /existingIdentity\?\.id[\s\S]*?updateBuild\(/);
  assert.match(gallery, /export function updateBuild\(/);
  assert.match(gallery, /current\.filter\(\(build\) => build\.id !== id\)/);
});

test('library custom controls cannot target hidden flowers or leak into another category', async () => {
  const library = await source('src/screens/LibraryScreen.tsx');

  assert.match(library, /if\(activeFlower>=flowerCount\)setActiveFlower\(flowerCount-1\)/);
  assert.match(library, /Math\.min\(activeFlower,flowerCount-1\)/);
  assert.match(library, /selectedId===MESSAGE_ENTRY\.id&&category!=='message'/);
});
