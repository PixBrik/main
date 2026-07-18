import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const sourceUrl = new URL('../api/_generationSecurity.ts', import.meta.url);

async function loadSecurity() {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    URL,
    Date,
    exports: module.exports,
    module,
    process: { env: {} },
    require: (id) => (id === 'node:crypto' ? { createHash } : {}),
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
}

test('paid generation fails closed in production until explicitly enabled', async () => {
  const { guardPaidGeneration } = await loadSecurity();
  assert.throws(
    () => guardPaidGeneration({ headers: {} }, { NODE_ENV: 'production' }, 1_000),
    (error) => error.status === 503 && error.code === 'generation_disabled',
  );
});

test('paid generation rejects foreign browser origins', async () => {
  const { guardPaidGeneration } = await loadSecurity();
  assert.throws(
    () =>
      guardPaidGeneration(
        { headers: { origin: 'https://attacker.example', 'x-forwarded-for': '192.0.2.1' } },
        { GENERATION_API_ENABLED: '1', NODE_ENV: 'production' },
        1_000,
      ),
    (error) => error.status === 403 && error.code === 'generation_origin_denied',
  );
});

test('paid generation enforces per-IP and global circuit breakers', async () => {
  const { clearGenerationSecurityForTests, guardPaidGeneration } = await loadSecurity();
  const env = {
    GENERATION_API_ENABLED: '1',
    GENERATION_DAILY_TASK_LIMIT: '2',
    GENERATION_IP_HOURLY_LIMIT: '1',
    NODE_ENV: 'production',
  };
  clearGenerationSecurityForTests();
  guardPaidGeneration({ headers: { 'x-forwarded-for': '192.0.2.1' } }, env, 1_000);
  assert.throws(
    () => guardPaidGeneration({ headers: { 'x-forwarded-for': '192.0.2.1' } }, env, 1_001),
    (error) => error.status === 429 && error.retryAfterSeconds > 0,
  );
  guardPaidGeneration({ headers: { 'x-forwarded-for': '192.0.2.2' } }, env, 1_002);
  assert.throws(
    () => guardPaidGeneration({ headers: { 'x-forwarded-for': '192.0.2.3' } }, env, 1_003),
    (error) => error.status === 429 && error.code === 'generation_rate_limited',
  );
});
