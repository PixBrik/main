import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const clientSourceUrl = new URL('../src/lib/guideShare.ts', import.meta.url);
const apiSourceUrl = new URL('../api/guides/share.ts', import.meta.url);
const SHARE_ID = 'AbCdEfGhIjKlMnOpQrStUv';

async function loadTypeScriptModule(sourceUrl, { env = {}, globals = {}, stubs = {} } = {}) {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    Blob,
    Buffer,
    Date: globals.Date ?? Date,
    ReadableStream,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    console,
    exports: module.exports,
    fetch: globals.fetch ?? fetch,
    module,
    process: { env },
    require: (id) => stubs[id] ?? {},
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
}

const modelSnapshot = {
  brickCount: 2,
  cells: [
    [0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0],
  ],
  layerHeight: 0.12,
  palette: ['#E96632'],
  size: 0.1,
};

const bom = {
  colorCount: 1,
  isEstimate: false,
  lines: [
    {
      colorId: 1,
      colorName: 'Coral',
      colorRgb: '#E96632',
      elementId: null,
      estimated: false,
      imageUrl: null,
      l: 1,
      lineTotalEur: 0,
      part: '3005',
      partName: 'Brick 1 x 1',
      quantity: 2,
      skuId: null,
      substituted: false,
      unitPriceEur: 0,
      w: 1,
    },
  ],
  placements: [
    { colorId: 1, i: 0, j: 0, k: 0, part: '3005', shape: 'brick', spanI: 1, spanK: 1 },
    { colorId: 1, i: 1, j: 0, k: 0, part: '3005', shape: 'brick', spanI: 1, spanK: 1 },
  ],
  totalEur: 0,
  totalParts: 2,
};

const commerceBom = {
  ...bom,
  isEstimate: true,
  lines: bom.lines.map((line) => ({
    ...line,
    elementId: 'element-1',
    estimated: true,
    imageUrl: 'https://cdn.example/part.png?token=private',
    lineTotalEur: 0.2,
    skuId: 'sku-1',
    substituted: true,
    unitPriceEur: 0.1,
  })),
  totalEur: 0.2,
};

function rawDraft(overrides = {}) {
  return {
    build: {
      accent: '#E96632',
      bom,
      model: modelSnapshot,
      name: 'Signal Fox',
      profile: 'efficient',
    },
    manual: { placementOrder: [1, 0], plannerVersion: 1 },
    schema: 'pixbrik.guide',
    version: 1,
    ...overrides,
  };
}

async function loadClient(buildable = true) {
  return loadTypeScriptModule(clientSourceUrl, {
    stubs: {
      './brickify': {
        brickify: () => bom,
        catalogPartFootprint: (part) => part === '3005' ? { l: 1, shape: 'brick', w: 1 } : null,
        isCatalogColorId: (colorId) => colorId === 1,
      },
      './instructions/assemblyPlan': {
        ASSEMBLY_PLAN_VERSION: 1,
        isAssemblyBuildable: () => buildable,
      },
      './orderStore': {
        loadOrderModel: (snapshot) => ({ snapshot }),
        snapshotOrderModel: () => modelSnapshot,
      },
    },
  });
}

function responseRecorder() {
  return {
    body: undefined,
    headers: new Map(),
    statusCode: 0,
    json(body) {
      this.body = body;
      return this;
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

test('order sanitizer publishes build/manual data and excludes private order/provider fields', async () => {
  const client = await loadClient();
  const fullOrder = {
    accent: '#e96632',
    bom: commerceBom,
    buildName: ' Signal Fox ',
    customerEmail: 'child@example.com',
    customerName: 'Private Person',
    model: modelSnapshot,
    profile: 'efficient',
    source3DMeshUrl: 'https://provider.invalid/private.glb',
    totalPrice: 999,
  };
  const draft = client.createGuideShareDraftFromOrder(fullOrder, {
    placementOrder: [1, 0],
    plannerVersion: 1,
  });
  const serialized = JSON.stringify(draft);

  assert.equal(draft.build.name, 'Signal Fox');
  assert.equal(draft.build.accent, '#E96632');
  assert.deepEqual(Array.from(draft.manual.placementOrder), [1, 0]);
  assert.doesNotMatch(serialized, /child@example|Private Person|private\.glb|totalPrice/);
  assert.doesNotMatch(serialized, /element-1|sku-1|cdn\.example|0\.2/);
  assert.equal(draft.build.bom.totalEur, 0);
  assert.throws(
    () => client.parseGuideShareDraft({ ...rawDraft(), customerEmail: 'leak@example.com' }),
    /unsupported field customerEmail/i,
  );
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      build: { ...rawDraft().build, source3DMeshUrl: 'https://provider.invalid/model.glb' },
    }),
    /unsupported field source3DMeshUrl/i,
  );
});

test('client and API reject an unbuildable frozen manual before network or Blob writes', async () => {
  const client = await loadClient(false);
  let fetchCalls = 0;
  await assert.rejects(
    () => client.publishGuide(rawDraft(), {
      endpoint: '/api/guides/share',
      fetchImpl: async () => {
        fetchCalls++;
        return Response.json({}, { status: 201 });
      },
    }),
    /safe assembly connection/i,
  );
  assert.equal(fetchCalls, 0);

  let putCalls = 0;
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env: { BLOB_READ_WRITE_TOKEN: 'server-only-token' },
    stubs: {
      '../../src/lib/guideShare': client,
      '@vercel/blob': { get: async () => null, put: async () => { putCalls++; } },
      'node:crypto': { randomBytes: () => ({ toString: () => SHARE_ID }) },
    },
  });
  const response = responseRecorder();
  await api.default({
    body: rawDraft(),
    headers: { 'content-type': 'application/json', host: 'localhost:8081' },
    method: 'POST',
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(putCalls, 0);
});

test('production guide storage stays fail-closed until quotas and retention are enabled', async () => {
  const client = await loadClient();
  let putCalls = 0;
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env: {
      BLOB_READ_WRITE_TOKEN: 'server-only-token',
      NODE_ENV: 'production',
    },
    stubs: {
      '../../src/lib/guideShare': client,
      '@vercel/blob': { get: async () => null, put: async () => { putCalls++; } },
      'node:crypto': { randomBytes: () => ({ toString: () => SHARE_ID }) },
    },
  });
  const response = responseRecorder();
  await api.default({
    body: rawDraft(),
    headers: { 'content-type': 'application/json', host: 'www.pixbrik.com' },
    method: 'POST',
  }, response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /not enabled/i);
  assert.equal(putCalls, 0);
  assert.equal(api.guideSharingEnabled({ GUIDE_SHARE_ENABLED: '1', NODE_ENV: 'production' }), true);
});

test('strict parser rejects malformed geometry, BOM mismatch, duplicate order and expired snapshots', async () => {
  const client = await loadClient();
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      build: { ...rawDraft().build, model: { ...modelSnapshot, brickCount: 3 } },
    }),
    /brickCount.*supported range/i,
  );
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      build: { ...rawDraft().build, bom: { ...bom, totalParts: 3 } },
    }),
    /totalParts.*supported range/i,
  );
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      manual: { placementOrder: [0, 0], plannerVersion: 1 },
    }),
    /duplicate placement/i,
  );
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      build: {
        ...rawDraft().build,
        bom: {
          ...bom,
          placements: [bom.placements[0], { ...bom.placements[1], spanI: 64, spanK: 64 }],
        },
      },
    }),
    /catalog footprint/i,
  );
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      build: {
        ...rawDraft().build,
        bom: {
          ...bom,
          placements: [bom.placements[0], { ...bom.placements[1], i: 9 }],
        },
      },
    }),
    /outside the frozen model/i,
  );
  assert.throws(
    () => client.parseGuideShareDraft({
      ...rawDraft(),
      build: { ...rawDraft().build, bom: commerceBom },
    }),
    /commerce fields/i,
  );

  const published = client.createPublishedGuideSnapshot(rawDraft(), {
    now: new Date('2026-07-18T00:00:00.000Z'),
    ttlDays: 1,
  });
  assert.equal(published.expiresAt, '2026-07-19T00:00:00.000Z');
  assert.throws(
    () => client.parsePublishedGuideSnapshot(published, { now: new Date('2026-07-20T00:00:00.000Z') }),
    /expired/i,
  );
});

test('client publishes a short app link and loads it with strict validation in a clean context', async () => {
  const client = await loadClient();
  const published = client.createPublishedGuideSnapshot(rawDraft(), {
    now: new Date('2026-07-18T00:00:00.000Z'),
    ttlDays: 30,
  });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ init, url });
    if (init.method === 'POST') {
      return Response.json(
        { expiresAt: published.expiresAt, id: SHARE_ID, url: `https://pixbrik.example/g/${SHARE_ID}` },
        { status: 201 },
      );
    }
    return Response.json(published, { status: 200 });
  };

  const link = await client.publishGuide(rawDraft(), { endpoint: '/api/guides/share', fetchImpl });
  assert.deepEqual({ ...link }, {
    expiresAt: published.expiresAt,
    id: SHARE_ID,
    url: `https://pixbrik.example/g/${SHARE_ID}`,
  });
  const loaded = await client.loadPublishedGuide(link.url, {
    endpoint: '/api/guides/share',
    fetchImpl,
    now: new Date('2026-07-18T01:00:00.000Z'),
  });
  assert.equal(loaded.build.name, 'Signal Fox');
  assert.equal(calls[0].url, '/api/guides/share');
  assert.equal(calls[1].url, `/api/guides/share?id=${SHARE_ID}`);
  assert.equal(client.readGuideShareId(`/g/${SHARE_ID}`), SHARE_ID);
  assert.equal(client.readGuideShareId(`?guide=${SHARE_ID}`), SHARE_ID);
  assert.equal(client.readGuideShareId('/g/guessable'), null);
});

test('API fails closed without Blob token and validates body size before upload', async () => {
  let putCalls = 0;
  const client = await loadClient();
  const api = await loadTypeScriptModule(apiSourceUrl, {
    stubs: {
      '../../src/lib/guideShare': client,
      '@vercel/blob': { get: async () => null, put: async () => { putCalls++; } },
      'node:crypto': { randomBytes: () => ({ toString: () => SHARE_ID }) },
    },
  });
  const baseReq = {
    body: rawDraft(),
    headers: { 'content-type': 'application/json', host: 'localhost:8081' },
    method: 'POST',
  };
  const missingToken = responseRecorder();
  await api.default(baseReq, missingToken);
  assert.equal(missingToken.statusCode, 503);
  assert.match(missingToken.body.error, /not configured/i);
  assert.equal(putCalls, 0);

  const oversizedApi = await loadTypeScriptModule(apiSourceUrl, {
    env: { BLOB_READ_WRITE_TOKEN: 'server-only-token' },
    stubs: {
      '../../src/lib/guideShare': client,
      '@vercel/blob': { get: async () => null, put: async () => { putCalls++; } },
      'node:crypto': { randomBytes: () => ({ toString: () => SHARE_ID }) },
    },
  });
  const oversized = responseRecorder();
  await oversizedApi.default(
    { ...baseReq, headers: { ...baseReq.headers, 'content-length': String(client.GUIDE_SHARE_MAX_BYTES + 1) } },
    oversized,
  );
  assert.equal(oversized.statusCode, 413);
  assert.equal(putCalls, 0);
});

test('API stores public unguessable JSON and resolves it for a clean browser', async () => {
  const client = await loadClient();
  let stored;
  const putCalls = [];
  const blob = {
    put: async (pathname, body, options) => {
      putCalls.push({ body, options, pathname });
      stored = body;
      return { pathname, url: `https://blob.invalid/${pathname}` };
    },
    get: async (pathname, options) => ({
      blob: { size: Buffer.byteLength(stored), pathname },
      headers: new Headers(),
      statusCode: 200,
      stream: new Blob([stored], { type: 'application/json' }).stream(),
      options,
    }),
  };
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env: {
      BLOB_READ_WRITE_TOKEN: 'server-only-token',
      GUIDE_SHARE_APP_URL: 'https://pixbrik.example',
      GUIDE_SHARE_TTL_DAYS: '30',
    },
    stubs: {
      '../../src/lib/guideShare': client,
      '@vercel/blob': blob,
      'node:crypto': { randomBytes: () => ({ toString: () => SHARE_ID }) },
    },
  });

  const postResponse = responseRecorder();
  await api.default(
    {
      body: rawDraft(),
      headers: { 'content-type': 'application/json', host: 'attacker.invalid' },
      method: 'POST',
    },
    postResponse,
  );
  assert.equal(postResponse.statusCode, 201);
  assert.equal(postResponse.body.id, SHARE_ID);
  assert.equal(postResponse.body.url, `https://pixbrik.example/g/${SHARE_ID}`);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].pathname, `guides/v1/${SHARE_ID}.json`);
  assert.equal(putCalls[0].options.access, 'public');
  assert.equal(putCalls[0].options.addRandomSuffix, false);
  assert.equal(putCalls[0].options.allowOverwrite, false);
  assert.equal(putCalls[0].options.token, 'server-only-token');
  assert.equal(JSON.parse(stored).schema, 'pixbrik.guide');
  assert.ok(JSON.parse(stored).expiresAt);

  const getResponse = responseRecorder();
  await api.default(
    { headers: {}, method: 'GET', query: { id: SHARE_ID } },
    getResponse,
  );
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.body.build.name, 'Signal Fox');
  assert.deepEqual(Array.from(getResponse.body.manual.placementOrder), [1, 0]);
  assert.equal(getResponse.headers.get('cache-control'), 'no-store');
});
