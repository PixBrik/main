import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = path.join(appRoot, 'scripts', 'benchmark-brick-rendering.mjs');

test('generated portrait, pet, and car stay faithful and catalog-valid across all 27 panel options', { timeout: 120_000 }, async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'pixbrik-render-quality-test-'));
  try {
    await execFileAsync(process.execPath, [benchmark, '--output', output], {
      cwd: appRoot,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 120_000,
    });
    const metrics = JSON.parse(await readFile(path.join(output, 'metrics.json'), 'utf8'));
    assert.equal(metrics.length, 27);

    for (const metric of metrics) {
      assert.equal(metric.invalidPartColorLines, 0, `${metric.subject}/${metric.style}/${metric.profile}`);
      assert.equal(metric.stockShortageParts, 0, `${metric.subject}/${metric.style}/${metric.profile}`);
      assert.equal(metric.substitutedParts, 0, `${metric.subject}/${metric.style}/${metric.profile}`);
      assert.equal(metric.substitutionLines, 0, `${metric.subject}/${metric.style}/${metric.profile}`);
      assert.equal(metric.placementCells, metric.visibleCells * 2);
      assert.ok(metric.width / metric.height >= 0.8 && metric.width / metric.height <= 0.86);
      assert.ok(metric.lumaCorrelation >= 0.9, `${metric.subject}/${metric.style}/${metric.profile}`);
      assert.ok(metric.edgeCorrelation >= 0.75, `${metric.subject}/${metric.style}/${metric.profile}`);
      assert.ok(metric.packedParts > 0 && metric.packedParts <= metric.placementCells);
      assert.match(metric.outputHash, /^[0-9a-f]{64}$/);
    }

    for (const subject of ['portrait', 'pet', 'car']) {
      for (const profile of ['efficient', 'balanced', 'detailed']) {
        const natural = metrics.find(
          (metric) => metric.subject === subject && metric.profile === profile && metric.style === 'natural',
        );
        const classic = metrics.find(
          (metric) => metric.subject === subject && metric.profile === profile && metric.style === 'classic',
        );
        assert.ok(natural.lumaCorrelation > classic.lumaCorrelation);
      }
      const balanced = metrics.find(
        (metric) => metric.subject === subject && metric.profile === 'balanced' && metric.style === 'natural',
      );
      const detailed = metrics.find(
        (metric) => metric.subject === subject && metric.profile === 'detailed' && metric.style === 'natural',
      );
      assert.ok(detailed.visibleCells > balanced.visibleCells * 1.5);
    }
  } finally {
    await rm(output, { force: true, recursive: true });
  }
});
