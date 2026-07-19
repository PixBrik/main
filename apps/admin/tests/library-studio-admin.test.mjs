import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('backoffice owns Studio entry and reauthorizes every catalogue publish', async () => {
  const [page, session, publishRoute, library] = await Promise.all([
    readFile(new URL('../src/app/(admin)/models/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/library-studio-session.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/api/internal/library/publish/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/public-model-library.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /hasPermission\(principal, "models\.publish"\)/);
  assert.match(page, /Open secure Library Studio/);
  assert.match(session, /SESSION_TTL_SECONDS = 30 \* 60/);
  assert.match(session, /createHmac\("sha256"/);
  assert.match(publishRoute, /isAuthorizedBackendBridgeRequest\(request\)/);
  assert.match(publishRoute, /verifyLibraryStudioSession/);
  assert.match(library, /permission\.key = 'models\.publish'/);
  assert.match(library, /model_library\.studio_published/);
  assert.match(library, /status = 'retired'/);
  assert.match(library, /kind: "realistic-mesh"/);
});

test('buyer catalogue returns only enabled published versioned products', async () => {
  const library = await readFile(new URL('../src/lib/public-model-library.ts', import.meta.url), 'utf8');
  assert.match(library, /item\.status = 'published'/);
  assert.match(library, /version\.status = 'published'/);
  assert.match(library, /category\.enabled/);
  assert.match(library, /configuration_snapshot -> 'library'/);
});
