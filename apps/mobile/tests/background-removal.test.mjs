import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    require: (id) => stubs[id] ?? (id === 'node:crypto' ? { createHash } : {}),
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
  assert.equal(new Map(providerRequestSettings('removebg', 'portrait').fields).get('type'), 'person');
  assert.equal(new Map(providerRequestSettings('removebg', 'animal').fields).get('type'), 'animal');
  assert.equal(new Map(providerRequestSettings('removebg', 'vehicle').fields).get('type'), 'transportation');
  assert.equal(new Map(providerRequestSettings('removebg', 'object').fields).has('type'), false);
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
    env: {
      BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'https://pixbrik.com',
      BACKGROUND_REMOVAL_API_ENABLED: '1',
      BACKGROUND_REMOVAL_PROVIDER: 'photoroom',
      NODE_ENV: 'production',
      PHOTOROOM_API_KEY: 'server-secret',
    },
    fetchImpl: async (url, options) => {
      request = { options, url };
      return new Response(output, { headers: { 'Content-Type': 'image/png' }, status: 200 });
    },
  });
  const boundary = 'pixbrik-handler-boundary';
  const req = {
    body: multipartBody(fakePng(800, 600), boundary),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      origin: 'https://pixbrik.com',
      'x-pixbrik-subject-hint': 'portrait',
    },
    method: 'POST',
  };
  const res = responseRecorder();
  await api.default(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.has('x-background-removal-provider'), false);
  assert.deepEqual(Buffer.from(res.body), output);
  assert.equal(request.url, 'https://sdk.photoroom.com/v1/segment');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['x-api-key'], 'server-secret');
  assert.equal(request.options.body.get('channels'), 'rgba');
  assert.equal(request.options.body.get('size'), 'medium');
  assert.equal(api.BACKGROUND_REMOVAL_TIMEOUT_MS, 15_000);
});

test('production is default-off and denies foreign or malformed origins before reading a body', async () => {
  let fetchCalls = 0;
  const disabled = await loadTypeScriptModule(apiSourceUrl, {
    env: { NODE_ENV: 'production', PHOTOROOM_API_KEY: 'must-not-be-read' },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    },
  });
  const disabledResponse = responseRecorder();
  await disabled.default({
    get body() {
      throw new Error('disabled request body must not be read');
    },
    headers: {},
    method: 'POST',
  }, disabledResponse);
  assert.equal(disabledResponse.statusCode, 503);
  assert.equal(disabledResponse.body.code, 'background_removal_disabled');
  assert.equal(disabledResponse.headers.get('cache-control'), 'no-store');
  assert.equal(disabledResponse.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(fetchCalls, 0);
  assert.throws(
    () => disabled.guardBackgroundRemovalRequest({ headers: {} }, { VERCEL_ENV: 'production' }),
    (error) => error.code === 'background_removal_disabled',
  );
  assert.throws(
    () => disabled.guardBackgroundRemovalRequest(
      { headers: {} },
      { BACKGROUND_REMOVAL_API_ENABLED: '1', NODE_ENV: 'production' },
    ),
    (error) => error.code === 'background_removal_misconfigured',
  );

  for (const origins of ['https://pixbrik.com/path', 'https://pixbrik.com,,https://www.pixbrik.com']) {
    const malformed = await loadTypeScriptModule(apiSourceUrl, {
      env: {
        BACKGROUND_REMOVAL_ALLOWED_ORIGINS: origins,
        BACKGROUND_REMOVAL_API_ENABLED: '1',
        NODE_ENV: 'production',
        PHOTOROOM_API_KEY: 'must-not-be-read',
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('must not fetch');
      },
    });
    const response = responseRecorder();
    await malformed.default({
      get body() {
        throw new Error('misconfigured request body must not be read');
      },
      headers: {},
      method: 'POST',
    }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'background_removal_misconfigured');
  }

  const denied = await loadTypeScriptModule(apiSourceUrl, {
    env: {
      BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'https://pixbrik.com',
      BACKGROUND_REMOVAL_API_ENABLED: '1',
      NODE_ENV: 'production',
      PHOTOROOM_API_KEY: 'must-not-be-read',
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    },
  });
  const deniedResponse = responseRecorder();
  await denied.default({
    get body() {
      throw new Error('denied request body must not be read');
    },
    headers: { origin: 'https://attacker.invalid' },
    method: 'POST',
  }, deniedResponse);
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.code, 'background_removal_origin_denied');
  assert.equal(fetchCalls, 0);
});

test('configured origins canonicalize safely while originless production requests fail closed', async () => {
  const output = fakePng(128, 128);
  let fetchCalls = 0;
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env: {
      BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'https://PIXBRIK.com:443/,http://localhost:8081',
      BACKGROUND_REMOVAL_API_ENABLED: '1',
      NODE_ENV: 'production',
      REMOVE_BG_API_KEY: 'server-key',
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(output, { status: 200 });
    },
  });
  assert.deepEqual(
    Array.from(api.allowedBackgroundRemovalOrigins({
      BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'https://PIXBRIK.com:443/',
      NODE_ENV: 'production',
    })),
    ['https://pixbrik.com'],
  );
  assert.throws(
    () => api.allowedBackgroundRemovalOrigins({
      BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'http://pixbrik.com',
      NODE_ENV: 'production',
    }),
    (error) => error.code === 'background_removal_misconfigured',
  );

  const boundary = 'origin-required';
  const response = responseRecorder();
  await api.default({
    body: multipartBody(fakePng(512, 512), boundary),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'x-forwarded-for': '192.0.2.40',
    },
    method: 'POST',
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'background_removal_origin_required');
  assert.equal(fetchCalls, 0);
});

test('hashed per-IP and global daily provider breakers enforce exact boundaries', async () => {
  const api = await loadTypeScriptModule(apiSourceUrl);
  const now = Date.parse('2026-07-18T12:00:00.000Z');
  const perIpEnv = {
    BACKGROUND_REMOVAL_DAILY_PROVIDER_LIMIT: '10',
    BACKGROUND_REMOVAL_IP_HOURLY_LIMIT: '2',
  };
  const firstIp = { headers: { 'x-forwarded-for': '192.0.2.50, 10.0.0.1' } };
  assert.notEqual(api.backgroundRemovalRateKey(firstIp), '192.0.2.50');
  assert.match(api.backgroundRemovalRateKey(firstIp), /^[0-9a-f]{24}$/);
  api.clearBackgroundRemovalSecurityForTests();
  api.consumeBackgroundRemovalQuota(firstIp, perIpEnv, now);
  api.consumeBackgroundRemovalQuota(firstIp, perIpEnv, now + 1);
  assert.throws(
    () => api.consumeBackgroundRemovalQuota(firstIp, perIpEnv, now + 2),
    (error) =>
      error.status === 429 &&
      error.code === 'background_removal_rate_limited' &&
      error.retryAfterSeconds > 0,
  );
  // The exact reset boundary starts a fresh hourly bucket.
  api.consumeBackgroundRemovalQuota(firstIp, perIpEnv, now + api.BACKGROUND_REMOVAL_RATE_WINDOW_MS);

  api.clearBackgroundRemovalSecurityForTests();
  const dailyEnv = {
    BACKGROUND_REMOVAL_DAILY_PROVIDER_LIMIT: '2',
    BACKGROUND_REMOVAL_IP_HOURLY_LIMIT: '10',
  };
  api.consumeBackgroundRemovalQuota({ headers: { 'x-real-ip': '192.0.2.60' } }, dailyEnv, now);
  api.consumeBackgroundRemovalQuota({ headers: { 'x-real-ip': '192.0.2.61' } }, dailyEnv, now + 1);
  assert.throws(
    () => api.consumeBackgroundRemovalQuota({ headers: { 'x-real-ip': '192.0.2.62' } }, dailyEnv, now + 2),
    (error) => error.status === 429 && error.code === 'background_removal_daily_limit',
  );
  api.consumeBackgroundRemovalQuota(
    { headers: { 'x-real-ip': '192.0.2.62' } },
    dailyEnv,
    Date.parse('2026-07-19T00:00:00.000Z'),
  );

  for (const badValue of ['0', '-1', '1.5', 'NaN', '1000001']) {
    api.clearBackgroundRemovalSecurityForTests();
    assert.throws(
      () => api.consumeBackgroundRemovalQuota(firstIp, {
        BACKGROUND_REMOVAL_DAILY_PROVIDER_LIMIT: badValue,
      }, now),
      (error) => error.status === 503 && error.code === 'background_removal_misconfigured',
    );
  }
});

test('invalid input cannot select a provider, fetch, or consume provider-call allowance', async () => {
  const output = fakePng(64, 64);
  let fetchCalls = 0;
  const env = {
    BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'https://pixbrik.com',
    BACKGROUND_REMOVAL_API_ENABLED: '1',
    BACKGROUND_REMOVAL_DAILY_PROVIDER_LIMIT: '10',
    BACKGROUND_REMOVAL_IP_HOURLY_LIMIT: '1',
    BACKGROUND_REMOVAL_PROVIDER: 'not-a-provider',
    NODE_ENV: 'production',
    PHOTOROOM_API_KEY: 'server-key',
  };
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(output, { status: 200 });
    },
  });
  const ip = '192.0.2.70';
  const invalidBoundary = 'invalid-before-provider';
  const invalid = responseRecorder();
  await api.default({
    body: multipartBody(Buffer.from('not a PNG'), invalidBoundary),
    headers: {
      'content-type': `multipart/form-data; boundary=${invalidBoundary}`,
      origin: 'https://pixbrik.com',
      'x-forwarded-for': ip,
    },
    method: 'POST',
  }, invalid);
  assert.equal(invalid.statusCode, 415);
  assert.equal(invalid.body.code, 'background_removal_media_type');
  assert.equal(fetchCalls, 0);

  // Changing the same environment object makes provider configuration valid.
  // The first valid upload must still receive the one-call allowance, proving
  // the invalid upload never consumed it or selected the invalid provider.
  env.BACKGROUND_REMOVAL_PROVIDER = 'photoroom';
  const validBoundary = 'valid-after-invalid';
  const validRequest = {
    body: multipartBody(fakePng(256, 256), validBoundary),
    headers: {
      'content-type': `multipart/form-data; boundary=${validBoundary}`,
      origin: 'https://pixbrik.com',
      'x-forwarded-for': ip,
    },
    method: 'POST',
  };
  const valid = responseRecorder();
  await api.default(validRequest, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(fetchCalls, 1);

  const limited = responseRecorder();
  await api.default(validRequest, limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.code, 'background_removal_rate_limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(fetchCalls, 1);
});

test('upstream failures are generic no-store JSON and static ordering keeps paid work last', async () => {
  const boundary = 'upstream-error';
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env: {
      BACKGROUND_REMOVAL_ALLOWED_ORIGINS: 'https://pixbrik.com',
      BACKGROUND_REMOVAL_API_ENABLED: '1',
      NODE_ENV: 'production',
      PHOTOROOM_API_KEY: 'server-secret-never-return',
    },
    fetchImpl: async () => new Response('provider says key server-secret-never-return is invalid', { status: 401 }),
  });
  const response = responseRecorder();
  await api.default({
    body: multipartBody(fakePng(256, 256), boundary),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      origin: 'https://pixbrik.com',
      'x-forwarded-for': '192.0.2.80',
    },
    method: 'POST',
  }, response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.body.code, 'background_removal_provider_failed');
  assert.doesNotMatch(JSON.stringify(response.body), /server-secret|401|photoroom/i);

  const source = await readFile(apiSourceUrl, 'utf8');
  const orderedMarkers = [
    'guardBackgroundRemovalRequest(req);',
    'const body = await readRequestBody(req);',
    'validatePngInput(png);',
    'consumeBackgroundRemovalQuota(req);',
    'selectBackgroundRemovalProvider();',
    'await fetch(settings.endpoint',
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = source.indexOf(marker);
    assert.ok(index > previous, `${marker} must follow all earlier request guards`);
    previous = index;
  }
  assert.doesNotMatch(source, /await upstream\.(?:text|json)\(/);
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

test('alpha grid preserves a genuinely opaque thin feature without accepting a one-pixel speck', async () => {
  const { alphaToGridMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const thin = new Uint8ClampedArray(4 * 4 * 4);
  thin[3] = 255;
  assert.deepEqual(Array.from(alphaToGridMask(thin, 4, 4, 1)), [true]);

  const speck = new Uint8ClampedArray(5 * 5 * 4);
  speck[3] = 255;
  assert.deepEqual(Array.from(alphaToGridMask(speck, 5, 5, 1)), [false]);
});

function rectangularMask(grid, left, top, right, bottom) {
  return new Array(grid * grid).fill(false).map((_, index) => {
    const x = index % grid;
    const y = Math.floor(index / grid);
    return x >= left && x <= right && y >= top && y <= bottom;
  });
}

test('integrity gate accepts a complete portrait matte', async () => {
  const { assessIsolationMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const mask = rectangularMask(20, 4, 1, 15, 18);
  const result = assessIsolationMask(mask, 20, { subjectHint: 'portrait' });
  assert.equal(result.verdict, 'accept');
  assert.equal(result.reason, undefined);
});

test('integrity gate rejects a transparent-shirt cleft through a person', async () => {
  const { assessIsolationMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const grid = 24;
  const mask = rectangularMask(grid, 3, 1, 20, 22);
  // Simulate a provider treating a light shirt as part of the light backdrop.
  for (let y = 10; y <= 17; y++) {
    for (let x = 10; x <= 13; x++) mask[y * grid + x] = false;
  }
  const result = assessIsolationMask(mask, grid, { subjectHint: 'person' });
  assert.equal(result.verdict, 'reject');
  assert.equal(result.reason, 'subject-core-gap');
});

test('portrait gate does not confuse the space between legs with missing clothing', async () => {
  const { assessIsolationMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const grid = 24;
  const mask = rectangularMask(grid, 7, 1, 16, 22);
  for (let y = 17; y <= 22; y++) {
    for (let x = 11; x <= 12; x++) mask[y * grid + x] = false;
  }
  assert.notEqual(assessIsolationMask(mask, grid, { subjectHint: 'person' }).reason, 'subject-core-gap');
});

test('integrity gate rejects a detected object returned with half its expected extent', async () => {
  const { assessIsolationMask } = await loadTypeScriptModule(clientSourceUrl, {
    stubs: { './segment': { SEGMENT_GRID: 68 } },
  });
  const mask = rectangularMask(20, 3, 8, 16, 12);
  const result = assessIsolationMask(mask, 20, {
    expectedBounds: { height: 0.7, width: 0.7, x: 0.15, y: 0.15 },
    subjectHint: 'vehicle',
  });
  assert.equal(result.verdict, 'reject');
  assert.equal(result.reason, 'incomplete-expected-extent');
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
  assert.match(source, /smartIsolateRegion\(sourceUri, region, undefined,/);
  assert.match(source, /SMART ISOLATE/);
  assert.match(source, /uploaded only after you tap the preview button/);
  assert.match(source, /buildRevisionRef\.current !== buildRevision/);
  assert.match(source, /setSmartError\(backgroundRemovalErrorMessage\(error\)\)/);
  assert.match(source, /Exact isolated cutout preview/);
  assert.match(source, /ISOLATED CUTOUT · CHECK CLOTHING \+ EDGES/);
  assert.match(source, /expectedBounds/);
  assert.doesNotMatch(source, /segmentRegion/);
});
