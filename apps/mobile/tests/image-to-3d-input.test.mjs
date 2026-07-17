import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const imageTo3DSourceUrl = new URL('../src/lib/photoEngine/imageTo3D.ts', import.meta.url);
const meshySubmitSourceUrl = new URL('../api/meshy/submit.ts', import.meta.url);

async function loadTypeScriptModule(sourceUrl, stubs = {}) {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    exports: module.exports,
    fetch: () => {
      throw new Error('network access is forbidden in this test');
    },
    module,
    process: { env: {} },
    require: (id) => stubs[id] ?? {},
    setTimeout,
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
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

  const unchanged = await prepareSegmentationFor3D('data:image/jpeg;base64,offline', recovered);
  assert.equal(unchanged, recovered);
  assert.equal(segmentCalls, 1);
});

test('Meshy likeness request enables remesh and disables creative enhancement', async () => {
  const { buildMeshyRequestBody } = await loadTypeScriptModule(meshySubmitSourceUrl, {
    '../_meshy': { MESHY_BASE: 'https://offline.invalid', meshyHeaders: () => ({}) },
  });

  assert.deepEqual(
    { ...buildMeshyRequestBody('data:image/jpeg;base64,offline') },
    {
      ai_model: 'meshy-6',
      image_enhancement: false,
      image_url: 'data:image/jpeg;base64,offline',
      should_remesh: true,
      should_texture: true,
      target_polycount: 10000,
      topology: 'triangle',
    },
  );
});
