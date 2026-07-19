import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const capture360Url = new URL('../src/lib/capture360Store.ts', import.meta.url);
const captureUrl = new URL('../src/lib/captureStore.ts', import.meta.url);
const accountUrl = new URL('../src/screens/AccountScreen.tsx', import.meta.url);
const appUrl = new URL('../App.tsx', import.meta.url);

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

async function loadStore(sourceUrl, localStorage) {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    Date,
    Float32Array,
    JSON,
    localStorage,
    module,
    exports: module.exports,
    require: () => ({}),
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
}

test('guided source photos expire after 24 hours and malformed legacy records are deleted', async () => {
  const localStorage = memoryStorage();
  const capture360 = await loadStore(capture360Url, localStorage);
  const shots = { back: 'back', front: 'front', left: 'left', right: 'right' };

  capture360.save360Capture(shots);
  assert.deepEqual({ ...capture360.load360Capture() }, shots);

  localStorage.setItem('pixbrik.capture360.normalized.v1', '{}');
  localStorage.setItem('pixbrik.capture360.v1', JSON.stringify({
    savedAt: Date.now() - capture360.RAW_CAPTURE_TTL_MS - 1,
    shots,
  }));
  assert.equal(capture360.load360Capture(), null);
  assert.equal(localStorage.getItem('pixbrik.capture360.v1'), null);
  assert.equal(localStorage.getItem('pixbrik.capture360.normalized.v1'), null);
});

test('single-photo recovery expires and can be explicitly deleted', async () => {
  const localStorage = memoryStorage();
  const capture = await loadStore(captureUrl, localStorage);
  const payload = {
    at: new Date().toISOString(),
    photoDataUrl: 'data:image/jpeg;base64,AA==',
    segmentation: {
      colors: [[100, 100, 100]],
      coverage: 1,
      depth: null,
      face: null,
      grid: 1,
      mask: [1],
      region: { height: 1, width: 1, x: 0, y: 0 },
    },
  };

  localStorage.setItem('pixbrik.lastCapture.v1', JSON.stringify(payload));
  assert.equal(capture.hasLastCapture(), true);
  assert.equal(capture.loadLastCapture().photoUri, payload.photoDataUrl);
  capture.clearLastCapture();
  assert.equal(capture.hasLastCapture(), false);

  localStorage.setItem('pixbrik.lastCapture.v1', JSON.stringify({
    ...payload,
    at: new Date(Date.now() - capture.RAW_CAPTURE_TTL_MS - 1).toISOString(),
  }));
  assert.equal(capture.loadLastCapture(), null);
  assert.equal(localStorage.getItem('pixbrik.lastCapture.v1'), null);
});

test('account exposes deletion and starting over clears every persisted source photo', async () => {
  const [account, app] = await Promise.all([
    readFile(accountUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(account, /Raw capture photos are kept only in this browser/);
  assert.match(account, /DELETE CAPTURED PHOTOS/);
  assert.match(account, /clear360Capture\(\);[\s\S]*?clearLastCapture\(\)/);
  assert.match(app, /const restart = \(\) => \{[\s\S]*?clear360Capture\(\);[\s\S]*?clearLastCapture\(\)/);
});
