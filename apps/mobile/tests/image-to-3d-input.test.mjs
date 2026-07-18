import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const imageTo3DSourceUrl = new URL('../src/lib/photoEngine/imageTo3D.ts', import.meta.url);
const meshyHelpersSourceUrl = new URL('../api/_meshy.ts', import.meta.url);
const meshySubmitSourceUrl = new URL('../api/meshy/submit.ts', import.meta.url);
const tripoSubmitSourceUrl = new URL('../api/tripo/submit.ts', import.meta.url);
const providerModelSourceUrls = [
  new URL('../api/meshy/model.ts', import.meta.url),
  new URL('../api/tripo/model.ts', import.meta.url),
];

async function loadTypeScriptModule(sourceUrl, stubs = {}, globals = {}) {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    Blob: globals.Blob ?? Blob,
    Buffer: globals.Buffer ?? Buffer,
    console,
    exports: module.exports,
    fetch:
      globals.fetch ??
      (() => {
        throw new Error('network access is forbidden in this test');
      }),
    module,
    FormData: globals.FormData ?? FormData,
    process: globals.process ?? { env: {} },
    require: (id) =>
      stubs[id] ??
      (id === 'node:crypto'
        ? { createHash }
        : id === '../_generationSecurity'
          ? {
              GenerationSecurityError: class extends Error {},
              guardPaidGeneration: () => {},
              sendGenerationSecurityError: () => {},
            }
          : {}),
    setTimeout: globals.setTimeout ?? setTimeout,
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
}

function response(status, body) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function enabledRuntime(fetch) {
  return {
    fetch,
    process: { env: { EXPO_PUBLIC_TRIPO_ENABLED: '1' } },
    setTimeout: (callback) => {
      callback();
      return 0;
    },
  };
}

function segmentation(coverage, mask) {
  return {
    colors: mask.map(() => [120, 120, 120]),
    coverage,
    grid: Math.sqrt(mask.length) || 0,
    mask,
    region: { height: 1, width: 1, x: 0, y: 0 },
  };
}

test('full-frame panel masks are refreshed only for 3D input', async () => {
  let segmentCalls = 0;
  const recovered = segmentation(0.5, new Array(16).fill(false).map((_, index) => index < 8));
  const { needsSubjectMaskFor3D, prepareSegmentationFor3D } = await loadTypeScriptModule(imageTo3DSourceUrl, {
    './segment': {
      segmentRegion: async (uri, region, grid) => {
        segmentCalls++;
        assert.equal(uri, 'data:image/jpeg;base64,offline');
        assert.deepEqual(region, { height: 1, width: 1, x: 0, y: 0 });
        assert.equal(grid, 4);
        return recovered;
      },
    },
  });

  const panel = {
    ...segmentation(1, new Array(16).fill(true)),
    categoryLabel: 'person',
    preserveFeatures: false,
  };
  assert.equal(needsSubjectMaskFor3D(panel), true);
  assert.equal(needsSubjectMaskFor3D(segmentation(0.4, new Array(16).fill(true))), true);
  assert.equal(needsSubjectMaskFor3D(recovered), false);
  assert.equal(needsSubjectMaskFor3D(segmentation(0, [])), false);

  const isolated = await prepareSegmentationFor3D('data:image/jpeg;base64,offline', panel);
  assert.equal(segmentCalls, 1);
  assert.deepEqual(isolated.mask, recovered.mask);
  assert.equal(isolated.coverage, recovered.coverage);
  assert.equal(isolated.categoryLabel, 'person');
  assert.equal(isolated.preserveFeatures, false);

  const explicitPanel = { ...panel, maskSource: 'full-frame' };
  const keptScene = await prepareSegmentationFor3D(
    'data:image/jpeg;base64,offline',
    explicitPanel,
  );
  assert.equal(keptScene, explicitPanel);
  assert.equal(segmentCalls, 1, 'new keep-scene captures never invoke the legacy heuristic');

  const providerMask = { ...recovered, cutoutUri: 'blob:provider-cutout', maskSource: 'background-removal' };
  const keptProviderMask = await prepareSegmentationFor3D(
    'data:image/jpeg;base64,offline',
    providerMask,
  );
  assert.equal(keptProviderMask, providerMask);
  assert.equal(segmentCalls, 1, 'provider mattes are never replaced by the legacy heuristic');

  const unchanged = await prepareSegmentationFor3D('data:image/jpeg;base64,offline', recovered);
  assert.equal(unchanged, recovered);
  assert.equal(segmentCalls, 1);
});

test('Meshy likeness request preserves the highest-precision textured mesh', async () => {
  const { buildMeshyRequestBody } = await loadTypeScriptModule(meshySubmitSourceUrl, {
    '../_meshy': { MESHY_BASE: 'https://offline.invalid', meshyHeaders: () => ({}) },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(buildMeshyRequestBody('data:image/jpeg;base64,offline'))),
    {
      ai_model: 'meshy-6',
      hd_texture: true,
      image_enhancement: false,
      image_url: 'data:image/jpeg;base64,offline',
      remove_lighting: true,
      should_remesh: false,
      should_texture: true,
      target_formats: ['glb'],
    },
  );
});

test('Meshy multiview sends four guided views in semantic orbit order', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ init, url });
    return response(200, { result: 'meshy-multiview-task' });
  };
  const { buildMeshyMultiviewRequestBody, default: handler } =
    await loadTypeScriptModule(
      meshySubmitSourceUrl,
      {
        '../_meshy': {
          MESHY_BASE: 'https://offline.invalid',
          meshyHeaders: () => ({ Authorization: 'Bearer offline' }),
        },
      },
      { fetch, process: { env: {} } },
    );
  const views = {
    back: 'data:image/png;base64,Ag==',
    front: 'data:image/png;base64,AA==',
    left: 'data:image/jpeg;base64,AQ==',
    right: 'data:image/jpeg;base64,Aw==',
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(buildMeshyMultiviewRequestBody(views))),
    {
      ai_model: 'meshy-6',
      hd_texture: true,
      image_enhancement: false,
      image_urls: [views.front, views.left, views.back, views.right],
      remove_lighting: true,
      should_remesh: false,
      should_texture: true,
      target_formats: ['glb'],
    },
  );

  let statusCode = 0;
  let responseBody;
  const res = {
    json(body) {
      responseBody = body;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
  };
  await handler({ body: { views }, method: 'POST' }, res);

  assert.equal(statusCode, 200);
  assert.deepEqual({ ...responseBody }, { taskId: 'meshy-multiview-task' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://offline.invalid/multi-image-to-3d');
  assert.deepEqual(JSON.parse(calls[0].init.body).image_urls, [
    views.front,
    views.left,
    views.back,
    views.right,
  ]);
});

test('Meshy rejects unsafe multiview inputs before spending credits', async () => {
  let fetchCalls = 0;
  const { default: handler } = await loadTypeScriptModule(
    meshySubmitSourceUrl,
    {
      '../_meshy': {
        MESHY_BASE: 'https://offline.invalid',
        meshyHeaders: () => ({ Authorization: 'Bearer offline' }),
      },
    },
    {
      fetch: async () => {
        fetchCalls++;
        throw new Error('network access is forbidden in this test');
      },
      process: { env: {} },
    },
  );
  let statusCode = 0;
  let responseBody;
  const res = {
    json(body) {
      responseBody = body;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
  };

  await handler(
    {
      body: {
        views: {
          front: 'data:image/png;base64,AA==',
          left: 'data:image/png;base64,AQ==',
          back: 'data:image/webp;base64,Ag==',
        },
      },
      method: 'POST',
    },
    res,
  );

  assert.equal(statusCode, 400);
  assert.match(responseBody.error, /invalid back, right/i);
  assert.equal(fetchCalls, 0);

  await handler(
    {
      body: { image: `data:image/png;base64,${'A'.repeat(3_600_000)}` },
      method: 'POST',
    },
    res,
  );
  assert.equal(statusCode, 413);
  assert.match(responseBody.error, /too large/i);
  assert.equal(fetchCalls, 0);
});

test('Meshy task lookup allow-lists and routes multi-image task kinds', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    return response(200, { id: 'task/id', status: 'SUCCEEDED' });
  };
  const { fetchMeshyTask, parseMeshyTaskKind } = await loadTypeScriptModule(
    meshyHelpersSourceUrl,
    {},
    { fetch, process: { env: { MESHY_API_KEY: 'offline' } } },
  );

  assert.equal(parseMeshyTaskKind(undefined), 'image-to-3d');
  assert.equal(parseMeshyTaskKind('multi-image-to-3d'), 'multi-image-to-3d');
  assert.equal(parseMeshyTaskKind('../text-to-3d'), null);
  await fetchMeshyTask('task/id', 'multi-image-to-3d');
  assert.deepEqual(calls, [
    'https://api.meshy.ai/openapi/v1/multi-image-to-3d/task%2Fid',
  ]);
});

test('Tripo multiview uses all four STS uploads and quality-first generation settings', async () => {
  const calls = [];
  let uploadNumber = 0;
  const fetch = async (url, init) => {
    calls.push({ init, url });
    if (url === 'https://offline.invalid/upload/sts') {
      uploadNumber++;
      return { json: async () => ({ code: 0, data: { image_token: `view-${uploadNumber}` } }) };
    }
    if (url === 'https://offline.invalid/task') {
      return { json: async () => ({ code: 0, data: { task_id: 'tripo-task' } }) };
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const { default: handler } = await loadTypeScriptModule(
    tripoSubmitSourceUrl,
    {
      '../_tripo': {
        TRIPO_BASE: 'https://offline.invalid',
        authHeaders: () => ({ Authorization: 'Bearer offline' }),
      },
    },
    { fetch, process: { env: {} } },
  );
  let statusCode = 0;
  let responseBody;
  const response = {
    json(body) {
      responseBody = body;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
  };
  const photo = 'data:image/png;base64,AA==';

  await handler(
    {
      body: {
        modelVersion: 'v3.1-20260211',
        views: { back: photo, front: photo, left: photo, right: photo },
      },
      method: 'POST',
    },
    response,
  );

  assert.equal(statusCode, 200);
  assert.deepEqual({ ...responseBody }, { taskId: 'tripo-task' });
  assert.equal(calls.filter((call) => call.url.endsWith('/upload/sts')).length, 4);
  const taskCall = calls.find((call) => call.url.endsWith('/task'));
  const taskBody = JSON.parse(taskCall.init.body);
  assert.equal(taskBody.type, 'multiview_to_model');
  assert.equal(taskBody.model_version, 'v3.1-20260211');
  assert.equal(taskBody.geometry_quality, 'detailed');
  assert.equal(taskBody.face_limit, 100000);
  assert.equal(taskBody.texture_alignment, 'original_image');
  assert.equal(taskBody.texture_quality, 'detailed');
  assert.deepEqual(
    taskBody.files.map((file) => file.file_token),
    ['view-1', 'view-2', 'view-3', 'view-4'],
  );
});

test('Tripo multiview rejects an incomplete orbit before any upload', async () => {
  let fetchCalls = 0;
  const { default: handler } = await loadTypeScriptModule(
    tripoSubmitSourceUrl,
    {
      '../_tripo': {
        TRIPO_BASE: 'https://offline.invalid',
        authHeaders: () => ({ Authorization: 'Bearer offline' }),
      },
    },
    {
      fetch: async () => {
        fetchCalls++;
        throw new Error('network access is forbidden in this test');
      },
      process: { env: {} },
    },
  );
  let statusCode = 0;
  let responseBody;
  const response = {
    json(body) {
      responseBody = body;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
  };

  await handler(
    {
      body: {
        views: {
          front: 'data:image/png;base64,AA==',
          left: 'data:image/png;base64,AA==',
        },
      },
      method: 'POST',
    },
    response,
  );

  assert.equal(statusCode, 400);
  assert.match(responseBody.error, /all four views/i);
  assert.equal(fetchCalls, 0);
});

test('one-photo generation falls back only after a confirmed pre-task Meshy rejection', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ body: init?.body, url });
    if (url === '/api/meshy/submit') {
      return response(500, { error: 'MESHY_API_KEY is not configured on the server' });
    }
    if (url === '/api/tripo/submit') {
      return response(200, { taskId: 'tripo-task' });
    }
    if (url === '/api/tripo/status?taskId=tripo-task') {
      return response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateMeshFromPhoto } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );

  const meshUrl = await generateMeshFromPhoto('data:image/jpeg;base64,offline', null);
  assert.equal(meshUrl, '/api/tripo/model?taskId=tripo-task');
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/api/meshy/submit', '/api/tripo/submit', '/api/tripo/status?taskId=tripo-task'],
  );
});

test('one-photo generation never double-submits after an ambiguous Meshy failure', async () => {
  for (const ambiguousFailure of [
    async () => response(502, { error: 'Meshy upstream timed out' }),
    async () => {
      throw new Error('connection reset after upload');
    },
    async () => response(200, {}),
  ]) {
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (url === '/api/meshy/submit') return ambiguousFailure();
      throw new Error(`fallback must not run: ${url}`);
    };
    const { generateMeshFromPhoto } = await loadTypeScriptModule(
      imageTo3DSourceUrl,
      {},
      enabledRuntime(fetch),
    );

    await assert.rejects(
      generateMeshFromPhoto('data:image/jpeg;base64,offline', null),
      /Meshy|task creation is uncertain/,
    );
    assert.deepEqual(calls, ['/api/meshy/submit']);
  }
});

test('known human subjects require four views before any one-photo provider request', async () => {
  let fetchCalls = 0;
  const { buildFromPhoto, generateMeshFromPhoto, requiresGuidedMultiview } =
    await loadTypeScriptModule(
      imageTo3DSourceUrl,
      {},
      enabledRuntime(async () => {
        fetchCalls++;
        throw new Error('a human one-photo request must never reach the network');
      }),
    );
  const portrait = { categoryLabel: 'PORTRAIT', face: null };
  const person = { categoryLabel: 'person', face: null };

  assert.equal(requiresGuidedMultiview(portrait), true);
  assert.equal(requiresGuidedMultiview(person), true);
  assert.equal(requiresGuidedMultiview({ categoryLabel: 'OBJECT', face: {} }), true);
  await assert.rejects(
    generateMeshFromPhoto('data:image/jpeg;base64,human', portrait),
    /four guided photos/i,
  );
  await assert.rejects(
    buildFromPhoto('data:image/jpeg;base64,human', person),
    /four guided photos/i,
  );
  assert.equal(fetchCalls, 0);
});

test('ordinary objects retain one-photo inference with four views optional', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/meshy/submit') return response(200, { taskId: 'object-task' });
    if (url === '/api/meshy/status?taskId=object-task') {
      return response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateMeshFromPhoto, requiresGuidedMultiview } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );
  const object = {
    categoryLabel: 'OBJECT',
    cutoutUri: 'data:image/png;base64,object',
    face: null,
    maskSource: 'background-removal',
  };

  assert.equal(requiresGuidedMultiview(object), false);
  const meshUrl = await generateMeshFromPhoto(
    'data:image/jpeg;base64,object-source',
    object,
  );
  assert.equal(meshUrl, '/api/meshy/model?taskId=object-task');
  assert.deepEqual(calls, [
    '/api/meshy/submit',
    '/api/meshy/status?taskId=object-task',
  ]);
});

test('retry resumes a submitted task after transient polling failure without another charge', async () => {
  let statusChecks = 0;
  let submitCalls = 0;
  let paidTaskCallbacks = 0;
  const fetch = async (url) => {
    if (url === '/api/meshy/submit') {
      submitCalls++;
      return response(200, { taskId: 'resume-me' });
    }
    if (url === '/api/meshy/status?taskId=resume-me') {
      statusChecks++;
      return statusChecks <= 90
        ? response(503, { error: 'temporary status outage' })
        : response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateMeshFromPhoto } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );

  await assert.rejects(
    generateMeshFromPhoto('data:image/jpeg;base64,resumable', null, {
      onProviderTaskCreated: () => paidTaskCallbacks++,
    }),
    /Retry resumes this existing task/,
  );
  const meshUrl = await generateMeshFromPhoto('data:image/jpeg;base64,resumable', null, {
    onProviderTaskCreated: () => paidTaskCallbacks++,
  });
  assert.equal(meshUrl, '/api/meshy/model?taskId=resume-me');
  assert.equal(submitCalls, 1);
  assert.equal(paidTaskCallbacks, 1, 'resuming one paid task must not consume a retake');
});

test('multiview mesh generation requires and submits all four views before conversion', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ body: init?.body, url });
    if (url === '/api/tripo/submit') return response(200, { taskId: 'four-view-task' });
    if (url === '/api/tripo/status?taskId=four-view-task') {
      return response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateMeshFromMultiview, missingMultiviewShots } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );
  const incomplete = { front: 'front', left: 'left' };
  assert.deepEqual([...missingMultiviewShots(incomplete)], ['back', 'right']);
  await assert.rejects(generateMeshFromMultiview(incomplete), /missing back, right/);
  assert.equal(calls.length, 0);

  const shots = { back: 'back', front: 'front', left: 'left', right: 'right' };
  const meshUrl = await generateMeshFromMultiview(shots);
  assert.equal(meshUrl, '/api/tripo/model?taskId=four-view-task');
  const submitted = JSON.parse(calls[0].body);
  assert.deepEqual({ ...submitted.views }, shots);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/api/tripo/submit', '/api/tripo/status?taskId=four-view-task'],
  );
});

test('multiview provider abstraction routes four views through Meshy when selected', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ body: init?.body, url });
    if (url === '/api/meshy/submit') {
      return response(200, { taskId: 'meshy-four-view-task' });
    }
    if (
      url ===
      '/api/meshy/status?taskId=meshy-four-view-task&taskKind=multi-image-to-3d'
    ) {
      return response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateMeshFromMultiview } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );
  const shots = { back: 'back', front: 'front', left: 'left', right: 'right' };

  const meshUrl = await generateMeshFromMultiview(shots, { engine: 'meshy' });

  assert.equal(
    meshUrl,
    '/api/meshy/model?taskId=meshy-four-view-task&taskKind=multi-image-to-3d',
  );
  assert.deepEqual(JSON.parse(calls[0].body), { views: shots });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/api/meshy/submit',
      '/api/meshy/status?taskId=meshy-four-view-task&taskKind=multi-image-to-3d',
    ],
  );
});

test('smart multiview falls back only after a definitive pre-task Meshy rejection', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/meshy/submit') {
      return response(500, { error: 'MESHY_API_KEY is not configured on the server' });
    }
    if (url === '/api/tripo/submit') {
      return response(200, { taskId: 'tripo-fallback-task' });
    }
    if (url === '/api/tripo/status?taskId=tripo-fallback-task') {
      return response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateBestMeshFromMultiview } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );
  const shots = { back: 'back', front: 'front', left: 'left', right: 'right' };

  const meshUrl = await generateBestMeshFromMultiview(shots);

  assert.equal(meshUrl, '/api/tripo/model?taskId=tripo-fallback-task');
  assert.deepEqual(calls, [
    '/api/meshy/submit',
    '/api/tripo/submit',
    '/api/tripo/status?taskId=tripo-fallback-task',
  ]);
});

test('smart multiview never double-submits after an ambiguous Meshy failure', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/meshy/submit') {
      return response(502, { error: 'Meshy upstream timed out' });
    }
    throw new Error(`fallback must not run: ${url}`);
  };
  const { generateBestMeshFromMultiview } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );

  await assert.rejects(
    generateBestMeshFromMultiview({
      back: 'back',
      front: 'front',
      left: 'left',
      right: 'right',
    }),
    /Meshy upstream timed out/,
  );
  assert.deepEqual(calls, ['/api/meshy/submit']);
});

test('smart multiview preserves an explicit provider choice for the lab', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/tripo/submit') return response(200, { taskId: 'explicit-tripo' });
    if (url === '/api/tripo/status?taskId=explicit-tripo') {
      return response(200, { hasModel: true, progress: 100, status: 'success' });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateBestMeshFromMultiview } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );

  const meshUrl = await generateBestMeshFromMultiview(
    { back: 'back', front: 'front', left: 'left', right: 'right' },
    { engine: 'tripo' },
  );

  assert.equal(meshUrl, '/api/tripo/model?taskId=explicit-tripo');
  assert.deepEqual(calls, [
    '/api/tripo/submit',
    '/api/tripo/status?taskId=explicit-tripo',
  ]);
});

test('provider task failures preserve their useful status error', async () => {
  const fetch = async (url) => {
    if (url === '/api/tripo/submit') return response(200, { taskId: 'failed-task' });
    if (url === '/api/tripo/status?taskId=failed-task') {
      return response(200, {
        error: 'input views did not describe one consistent object',
        hasModel: false,
        status: 'failed',
      });
    }
    throw new Error(`unexpected offline request: ${url}`);
  };
  const { generateMeshFromMultiview } = await loadTypeScriptModule(
    imageTo3DSourceUrl,
    {},
    enabledRuntime(fetch),
  );

  await assert.rejects(
    generateMeshFromMultiview({ back: 'back', front: 'front', left: 'left', right: 'right' }),
    /Tripo generation failed: input views did not describe one consistent object/,
  );
});

test('provider model proxies keep generated GLBs out of public caches', async () => {
  for (const sourceUrl of providerModelSourceUrls) {
    const source = await readFile(sourceUrl, 'utf8');
    assert.match(source, /Cache-Control', 'private, no-store, max-age=0'/);
    assert.doesNotMatch(source, /Cache-Control', 'public/);
  }
});
