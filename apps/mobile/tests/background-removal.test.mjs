import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const apiSourceUrl = new URL('../api/background/remove.ts', import.meta.url);
const clientSourceUrl = new URL('../src/lib/photoEngine/backgroundRemoval.ts', import.meta.url);
const captureSourceUrl = new URL('../src/screens/CaptureScreen.tsx', import.meta.url);

async function loadTypeScriptModule(sourceUrl, { env = {}, fetchImpl, stubs = {} } = {}) {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    AbortController,
    ArrayBuffer,
    Blob,
    Buffer,
    FormData,
    Response,
    URL,
    Uint8Array,
    Uint8ClampedArray,
    clearTimeout,
    console,
    crypto: globalThis.crypto,
    exports: module.exports,
    fetch:
      fetchImpl ??
      (() => {
        throw new Error('network access is forbidden in this test');
      }),
    module,
    process: { env },
    require: (id) => stubs[id] ?? {},
    setTimeout,
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
}

function fakePng(width, height) {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

function multipartBody(png, boundary = 'pixbrik-test-boundary') {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\noffline\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="crop.png"\r\n` +
        'Content-Type: image/png\r\n\r\n',
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function responseRecorder() {
  return {
    body: undefined,
    headers: new Map(),
    statusCode: 0,
    json(body) {
      this.body = body;
    },
    send(body) {
      this.body = body;
    },
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

test('provider selection honors preference and uses only configured server keys', async () => {
  const { providerRequestSettings, selectBackgroundRemovalProvider } = await loadTypeScriptModule(apiSourceUrl);

  assert.deepEqual(
    { ...selectBackgroundRemovalProvider({ BACKGROUND_REMOVAL_PROVIDER: 'removebg', REMOVE_BG_API_KEY: 'rb' }) },
    { key: 'rb', provider: 'removebg' },
  );
  assert.deepEqual(
    {
      ...selectBackgroundRemovalProvider({
        BACKGROUND_REMOVAL_PROVIDER: 'removebg',
        PHOTOROOM_API_KEY: 'pr',
      }),
    },
    { key: 'pr', provider: 'photoroom' },
  );
  assert.deepEqual(
    { ...selectBackgroundRemovalProvider({ REMOVE_BG_API_KEY: 'rb' }) },
    { key: 'rb', provider: 'removebg' },
  );
  assert.throws(() => selectBackgroundRemovalProvider({}), /not configured/i);

  const photoRoom = providerRequestSettings('photoroom');
  assert.equal(photoRoom.endpoint, 'https://sdk.photoroom.com/v1/segment');
  assert.equal(new Map(photoRoom.fields).get('channels'), 'rgba');
  assert.equal(new Map(photoRoom.fields).get('size'), 'medium');
  assert.equal(new Map(photoRoom.fields).get('crop'), 'false');
  const removeBg = providerRequestSettings('removebg');
  assert.equal(removeBg.endpoint, 'https://api.remove.bg/v1.0/removebg');
  assert.equal(new Map(removeBg.fields).get('size'), 'auto');
});

test('multipart extraction preserves PNG bytes and rejects oversized dimensions', async () => {
  const { extractMultipartPng, validatePngInput } = await loadTypeScriptModule(apiSourceUrl);
  const png = fakePng(1024, 640);
  const boundary = 'pixbrik-test-boundary';
  const extracted = extractMultipartPng(
    multipartBody(png, boundary),
    `multipart/form-data; boundary="${boundary}"`,
  );
  assert.deepEqual(Buffer.from(extracted), png);
  assert.deepEqual({ ...validatePngInput(extracted) }, { height: 640, width: 1024 });
  assert.throws(() => validatePngInput(fakePng(1025, 640)), /at most 1024/i);
  assert.throws(() => validatePngInput(Buffer.from('not a png')), /valid PNG/i);
});

test('proxy sends provider multipart settings and returns no-store PNG without live network', async () => {
  const output = fakePng(320, 320);
  let request;
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env: { BACKGROUND_REMOVAL_PROVIDER: 'photoroom', PHOTOROOM_API_KEY: 'server-secret' },
    fetchImpl: async (url, options) => {
      request = { options, url };
      return new Response(output, { headers: { 'Content-Type': 'image/png' }, status: 200 });
    },
  });
  const boundary = 'pixbrik-handler-boundary';
  const req = {
    body: multipartBody(fakePng(800, 600), boundary),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    method: 'POST',
  };
  const res = responseRecorder();
  await api.default(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-background-removal-provider'), 'photoroom');
  assert.deepEqual(Buffer.from(res.body), output);
  assert.equal(request.url, 'https://sdk.photoroom.com/v1/segment');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['x-api-key'], 'server-secret');
  assert.equal(request.options.body.get('channels'), 'rgba');
  assert.equal(request.options.body.get('size'), 'medium');
  assert.equal(api.BACKGROUND_REMOVAL_TIMEOUT_MS, 15_000);
});

test('alpha grid keeps disconnected subjects and real holes', async () => {
  const { alphaToGridMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const rgba = new Uint8ClampedArray(3 * 3 * 4);
  for (const cell of [0, 2, 6, 8]) rgba[cell * 4 + 3] = 255;

  assert.deepEqual(
    Array.from(alphaToGridMask(rgba, 3, 3, 3, 0.5)),
    [true, false, true, false, false, false, true, false, true],
  );
});

test('alpha grid area-averages thin coverage before thresholding', async () => {
  const { alphaToGridMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const rgba = new Uint8ClampedArray(2 * 2 * 4);
  rgba[3] = 255;
  assert.deepEqual(Array.from(alphaToGridMask(rgba, 2, 2, 1, 0.22)), [true]);
  assert.deepEqual(Array.from(alphaToGridMask(rgba, 2, 2, 1, 0.26)), [false]);
});

test('public feature flag is explicit and defaults off', async () => {
  const off = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const on = await loadTypeScriptModule(clientSourceUrl, {
    env: { EXPO_PUBLIC_BACKGROUND_REMOVAL_ENABLED: '1' },
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  assert.equal(off.isBackgroundRemovalEnabled(), false);
  assert.equal(on.isBackgroundRemovalEnabled(), true);
});

test('capture flow discloses upload and never substitutes heuristic segmentation', async () => {
  const source = await readFile(captureSourceUrl, 'utf8');
  assert.match(source, /Uploads only this framed crop for processing/);
  assert.match(source, /smartIsolateRegion\(sourceUri, region\)/);
  assert.match(source, /SMART ISOLATE/);
  assert.match(source, /uploaded only after you tap the preview button/);
  assert.match(source, /buildRevisionRef\.current !== buildRevision/);
  assert.match(source, /setSmartError\(backgroundRemovalErrorMessage\(error\)\)/);
  assert.doesNotMatch(source, /segmentRegion/);
});
