import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyStudioSessionToken } from '../api/_studioSession.ts';

const secret = 'S'.repeat(48);
const actor = '11111111-1111-4111-8111-111111111111';

function token(claims) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
  return `${payload}.${signature}`;
}

test('Library Studio sessions are signed, actor-bound, short-lived and tamper-evident', () => {
  const now = 1_800_000_000;
  const valid = token({ exp: now + 1_800, iat: now, nonce: 'n'.repeat(24), sub: actor, v: 1 });
  assert.equal(
    verifyStudioSessionToken(valid, { PIXBRIK_BACKEND_SHARED_SECRET: secret }, now)?.sub,
    actor,
  );
  assert.equal(verifyStudioSessionToken(`${valid.slice(0, -1)}x`, { PIXBRIK_BACKEND_SHARED_SECRET: secret }, now), null);
  assert.equal(verifyStudioSessionToken(valid, { PIXBRIK_BACKEND_SHARED_SECRET: secret }, now + 1_801), null);
  const overlong = token({ exp: now + 1_801, iat: now, nonce: 'n'.repeat(24), sub: actor, v: 1 });
  assert.equal(verifyStudioSessionToken(overlong, { PIXBRIK_BACKEND_SHARED_SECRET: secret }, now), null);
});

test('paid text generation and publishing require the backoffice Studio session', async () => {
  const [submit, publish, lab, store] = await Promise.all([
    readFile(new URL('../api/meshy/text-submit.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/library/publish.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/screens/LabScreen.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/libraryStore.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(submit, /requireStudioSession\(req\)/);
  assert.match(publish, /requireStudioSession\(req\)/);
  assert.match(publish, /publishBackendLibraryMaster/);
  assert.match(lab, /Open Library Studio from the authenticated backoffice/);
  assert.match(store, /CURATED_PROCEDURAL/);
  assert.match(store, /\/api\/library\/catalog/);
  assert.doesNotMatch(store, /\.\.\.LIBRARY_SEED/);
});
