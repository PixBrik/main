import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('result proposals release-gate the selected profile first without synchronous render work', async () => {
  const result = await readFile(path.join(root, 'src', 'screens', 'ResultScreen.tsx'), 'utf8');

  assert.match(result, /import \{ assessBuildAsync,/);
  assert.doesNotMatch(result, /\bassessBuild\(/);
  assert.match(
    result,
    /const selectedFirst = \[\s*\.\.\.availableVariants\.filter\(\(variant\) => variant\.id === selectedVariant\),\s*\.\.\.availableVariants\.filter\(\(variant\) => variant\.id !== selectedVariant\),\s*\]/,
  );
  assert.match(result, /await assessBuildAsync\(model, variantAccent\)/);
  assert.match(result, /setProfileCards\(Object\.fromEntries\(availableVariants\.map/);
  assert.match(result, /return card \? \{ \.\.\.current, \[variant\.id\]: \{ \.\.\.card, png \} \} : current/);
  assert.match(result, /assessmentState: 'pending'/);
  assert.match(result, /current\.assessmentState !== 'ready'/);
  assert.match(result, /const unavailable = assessmentPending/);
});

test('web assessment uses Metro worker URL form and the exact shared release gate', async () => {
  const [orchestrator, worker, core] = await Promise.all([
    readFile(path.join(root, 'src', 'lib', 'kitAssessment.ts'), 'utf8'),
    readFile(path.join(root, 'src', 'lib', 'kitAssessment.worker.ts'), 'utf8'),
    readFile(path.join(root, 'src', 'lib', 'kitAssessmentCore.ts'), 'utf8'),
  ]);

  assert.match(orchestrator, /new Worker\(new URL\('\.\/kitAssessment\.worker\.ts', import\.meta\.url\)\)/);
  assert.match(orchestrator, /pendingAssessmentCache/);
  assert.match(orchestrator, /ASSESSMENT_WORKER_TIMEOUT_MS = 30_000/);
  assert.match(orchestrator, /stopAssessmentWorker\('Exact catalog validation took too long/);
  // Worker first for a smooth UI thread; ANY worker failure (stale chunk 404
  // after a deploy, blocked workers, a crash) falls back to the identical
  // in-thread release gate instead of failing the buyer's build.
  assert.match(orchestrator, /const viaWorker = assessInWorker\(model, accent\);/);
  assert.match(orchestrator, /viaWorker \? viaWorker\.catch\(\(\) => assessAfterPaint\(model, accent\)\) : assessAfterPaint\(model, accent\)/);
  assert.match(worker, /computeBuildAssessment\(model, accent\)/);
  assert.match(core, /assessSide\(brickify\(model, accent\)\)/);
  assert.match(core, /assessSide\(brickify\(model, accent, \{ hollow: true \}\)\)/);
  assert.match(core, /plan\.supportSummary\.unsupported === 0/);
  assert.match(core, /warning\.severity === 'error'/);
});
