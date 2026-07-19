import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFileSync(path.join(root, file), 'utf8');

test('library generation failures stay visible and can be retried', () => {
  const app = source('App.tsx');
  const library = source('src/screens/LibraryScreen.tsx');

  assert.match(app, /const \[libraryGenerationError, setLibraryGenerationError\] = useState\(''\)/);
  assert.match(app, /catch \(error\)[\s\S]*?setLibraryGenerationError\(/);
  assert.match(app, /generationError=\{libraryGenerationError\}/);
  assert.match(app, /onClearGenerationError=\{\(\) => setLibraryGenerationError\(''\)\}/);

  assert.match(library, /accessibilityRole="alert"/);
  assert.match(library, /accessibilityLiveRegion="assertive"/);
  assert.match(library, /accessibilityLabel="Try building again"/);
  assert.match(library, /const requestBuild=\(\)=>\{[\s\S]*?onClearGenerationError\(\);[\s\S]*?void onGenerate\(selected,buildColor,customOptions\)/);
  assert.match(library, /const select=\(entry:LibraryEntry\)=>\{\s*onClearGenerationError\(\)/);
});

test('the complete idea catalogue stays visible while uncertified kits remain fail-closed', () => {
  const library = source('src/screens/LibraryScreen.tsx');

  assert.match(library, /useState<LibraryEntry\[\]>\(\(\)=>listLibrary\(\)\)/);
  assert.doesNotMatch(library, /listLibrary\(\)\.filter\(isLibraryEntryReleased\)/);
  assert.match(library, /const canBuild=!!selected&&releasedSizes\.length>0/);
  assert.match(library, /Preview · certification pending/);
  assert.match(library, /Ordering unlocks after its physical brick packing/);
});
