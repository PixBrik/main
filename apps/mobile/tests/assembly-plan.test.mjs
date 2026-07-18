import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(appRoot, 'src', 'lib', 'instructions', 'assemblyPlan.ts');
const source = await readFile(filename, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
  loaded.exports,
  require,
  loaded,
  filename,
  path.dirname(filename),
);
const { ASSEMBLY_PLAN_VERSION, createAssemblyPlan, partColorKey, placementsThroughStep } = loaded.exports;

function line(part, colorId, overrides = {}) {
  return {
    colorId,
    colorName: `Color ${colorId}`,
    colorRgb: '#445566',
    elementId: null,
    estimated: false,
    imageUrl: null,
    l: 2,
    lineTotalEur: 0.2,
    part,
    partName: `Part ${part}`,
    quantity: 1,
    skuId: null,
    substituted: false,
    unitPriceEur: 0.2,
    w: 1,
    ...overrides,
  };
}

function placement(part, colorId, i, j, k, spanI = 1, spanK = 1, overrides = {}) {
  return {
    colorId,
    i,
    j,
    k,
    part,
    shape: 'brick',
    spanI,
    spanK,
    ...overrides,
  };
}

function bom(placements, lines, totalParts = placements.length) {
  return {
    colorCount: new Set(lines.map((entry) => entry.colorId)).size,
    isEstimate: false,
    lines,
    placements,
    totalEur: 1,
    totalParts,
  };
}

function semanticOrder(plan) {
  return plan.steps.map(({ placement: item }) =>
    [item.j, item.k, item.i, item.part, item.colorId, item.spanI, item.spanK].join('|'));
}

test('creates exactly one numbered action for every frozen catalog placement', () => {
  const placements = [
    placement('base-a', 1, 0, 0, 0, 2, 1),
    placement('top-a', 1, 0, 1, 0),
    placement('top-b', 2, 1, 1, 0),
  ];
  const lines = [line('base-a', 1), line('top-a', 1), line('top-b', 2)];
  const plan = createAssemblyPlan(bom(placements, lines));

  assert.equal(plan.version, ASSEMBLY_PLAN_VERSION);
  assert.equal(plan.totalSteps, placements.length);
  assert.equal(plan.totalPlacements, placements.length);
  assert.deepEqual(plan.steps.map((step) => step.number), [1, 2, 3]);
  assert.deepEqual(plan.steps.map((step) => step.index), [0, 1, 2]);
  assert.deepEqual(plan.steps.map((step) => step.cumulativePlacementCount), [1, 2, 3]);
  assert.equal(new Set(plan.steps.map((step) => step.sourcePlacementIndex)).size, placements.length);
  assert.deepEqual([...plan.placementOrder].sort((a, b) => a - b), [0, 1, 2]);
  for (const item of placements) {
    assert.equal(plan.steps.filter((step) => step.placement === item).length, 1);
  }
});

test('orders bottom-up, puts supported pieces before partial and unsupported peers, and records dependencies', () => {
  const base = placement('base', 1, 0, 0, 0, 2, 1);
  const unsupported = placement('unsupported', 1, -10, 1, 0);
  const partial = placement('partial', 1, 1, 1, 0, 2, 1);
  const supported = placement('supported', 1, 0, 1, 0);
  // Deliberately reverse the desired build order in the frozen array.
  const placements = [unsupported, partial, supported, base];
  const lines = placements.map((item) => line(item.part, item.colorId));
  const plan = createAssemblyPlan(bom(placements, lines));

  assert.deepEqual(plan.steps.map((step) => step.placement.part), [
    'base',
    'supported',
    'partial',
    'unsupported',
  ]);
  assert.equal(plan.steps[0].support.status, 'base');
  assert.equal(plan.steps[1].support.status, 'full');
  assert.equal(plan.steps[2].support.status, 'partial');
  assert.equal(plan.steps[2].support.supportedStuds, 1);
  assert.equal(plan.steps[2].support.footprintStuds, 2);
  assert.deepEqual(plan.steps[1].support.supportingStepIds, [plan.steps[0].id]);
  assert.equal(plan.steps[3].support.status, 'unsupported');
  assert.ok(plan.steps[2].warnings.some((entry) => entry.code === 'partial-support'));
  assert.ok(plan.steps[3].warnings.some((entry) => entry.code === 'unsupported-placement'));
});

test('builds a connected bridge first and then locks an overhang from underneath', () => {
  const base = placement('base', 1, 0, 0, 0);
  const pillar = placement('pillar', 1, 0, 1, 0);
  const bridge = placement('bridge', 1, 0, 2, 0, 2, 1);
  const overhang = placement('overhang', 1, 1, 1, 0);
  const placements = [overhang, bridge, pillar, base];
  const plan = createAssemblyPlan(bom(placements, placements.map((item) => line(item.part, item.colorId))));

  assert.deepEqual(plan.steps.map((step) => step.placement.part), [
    'base',
    'pillar',
    'bridge',
    'overhang',
  ]);
  const overhangStep = plan.steps[3];
  assert.equal(overhangStep.support.status, 'underside');
  assert.equal(overhangStep.support.supportedStuds, 1);
  assert.deepEqual(overhangStep.support.supportingStepIds, [plan.steps[2].id]);
  assert.ok(overhangStep.warnings.some((entry) => entry.code === 'underside-attachment'));
  assert.equal(plan.supportSummary.unsupported, 0);
});

test('is deterministic for the same placement set regardless of input order', () => {
  const placements = [
    placement('right', 2, 2, 0, 1),
    placement('upper', 1, 0, 1, 0),
    placement('left', 1, 0, 0, 0),
    placement('middle', 1, 1, 0, 0),
  ];
  const lines = [line('right', 2), line('upper', 1), line('left', 1), line('middle', 1)];
  const forward = createAssemblyPlan(bom(placements, lines));
  const shuffled = createAssemblyPlan(bom([placements[2], placements[0], placements[3], placements[1]], lines));

  assert.deepEqual(semanticOrder(shuffled), semanticOrder(forward));
});

test('replays an exact frozen placement order for published guides', () => {
  const placements = [
    placement('first-source', 1, 0, 0, 0),
    placement('second-source', 1, 1, 0, 0),
    placement('third-source', 1, 2, 0, 0),
  ];
  const lines = placements.map((item) => line(item.part, item.colorId));
  const frozen = createAssemblyPlan(bom(placements, lines), { placementOrder: [2, 0, 1] });

  assert.deepEqual(frozen.steps.map((step) => step.placement.part), [
    'third-source',
    'first-source',
    'second-source',
  ]);
  assert.deepEqual(frozen.placementOrder, [2, 0, 1]);
  assert.throws(
    () => createAssemblyPlan(bom(placements, lines), { placementOrder: [0, 0, 2] }),
    /permutation/i,
  );
});

test('exposes direct part/color metadata and deterministic child-sized stages', () => {
  const placements = Array.from({ length: 5 }, (_, index) =>
    placement(`part-${index}`, index + 1, index, 0, 0));
  const lines = placements.map((item) => line(item.part, item.colorId));
  const plan = createAssemblyPlan(bom(placements, lines), { maxStepsPerChapter: 2 });

  assert.deepEqual(plan.chapters.map((chapter) => chapter.stepCount), [2, 2, 1]);
  assert.deepEqual(plan.chapters.map((chapter) => chapter.bagNumber), [1, 2, 3]);
  assert.deepEqual(plan.steps.map((step) => step.chapterNumber), [1, 1, 2, 2, 3]);
  assert.deepEqual(plan.steps.map((step) => step.bagNumber), [1, 1, 2, 2, 3]);
  assert.deepEqual(plan.steps.map((step) => step.chapterLabel), ['Stage 1', 'Stage 1', 'Stage 2', 'Stage 2', 'Stage 3']);
  for (const step of plan.steps) {
    assert.equal(step.partKey, partColorKey(step.placement.part, step.placement.colorId));
    assert.equal(step.partLine, lines.find((entry) => entry.part === step.placement.part));
  }
});

test('returns the exact cumulative catalog placement prefix for UI and PDF renders', () => {
  const placements = [
    placement('later', 1, 0, 1, 0),
    placement('base', 1, 0, 0, 0),
    placement('finish', 1, 0, 2, 0),
  ];
  const plan = createAssemblyPlan(bom(placements, placements.map((item) => line(item.part, item.colorId))));

  assert.deepEqual(placementsThroughStep(plan, -1), []);
  assert.deepEqual(placementsThroughStep(plan, 0), [plan.steps[0].placement]);
  assert.deepEqual(placementsThroughStep(plan, 1), [plan.steps[0].placement, plan.steps[1].placement]);
  assert.deepEqual(placementsThroughStep(plan, 99), plan.steps.map((step) => step.placement));
});

test('keeps malformed or unmatched frozen placements and exposes structured warnings', () => {
  const base = placement('base', 1, 0, 0, 0);
  const missingLine = placement('unknown', 9, 0, 1, 0);
  const invalid = placement('bad-span', 1, 4, 2, 0, 0, 1);
  const overlapping = placement('overlap', 1, 0, 0, 0);
  const placements = [base, missingLine, invalid, overlapping];
  const plan = createAssemblyPlan(bom(placements, [line('base', 1), line('bad-span', 1), line('overlap', 1)], 99));

  assert.equal(plan.totalSteps, placements.length);
  assert.ok(plan.steps.every((step) => placements.includes(step.placement)));
  assert.ok(plan.warnings.some((entry) => entry.code === 'part-count-mismatch'));
  assert.ok(plan.warnings.some((entry) => entry.code === 'missing-part-line'));
  assert.ok(plan.warnings.some((entry) => entry.code === 'invalid-footprint'));
  assert.ok(plan.warnings.some((entry) => entry.code === 'overlapping-placement'));
});

test('an empty frozen packing produces a valid empty plan', () => {
  const plan = createAssemblyPlan(bom([], [], 0));

  assert.equal(plan.totalSteps, 0);
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.chapters, []);
  assert.deepEqual(plan.placementOrder, []);
  assert.deepEqual(plan.supportSummary, { base: 0, full: 0, partial: 0, underside: 0, unsupported: 0 });
  assert.deepEqual(plan.warnings, []);
});
