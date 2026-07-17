import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('web raw-mesh approval renders the provider GLB and supports pointer rotation', async () => {
  const web = await source('src/components/RawMeshView.web.tsx');

  assert.match(web, /GLTFLoader/);
  assert.match(web, /loadAsync\(modelUrl\)/);
  assert.match(web, /addEventListener\('pointerdown'/);
  assert.match(web, /addEventListener\('pointermove'/);
  assert.match(web, /targetYaw \+=/);
  assert.match(web, /targetPitch = THREE\.MathUtils\.clamp/);
  assert.match(web, /RESET VIEW/);
  assert.match(web, /onReadyRef\.current\?\.\(\)/);
  assert.match(web, /onErrorRef\.current\?\.\(message\)/);
  assert.match(web, /export const isInteractiveRawMeshViewSupported = true/);
});

test('raw-mesh viewer releases GPU and browser resources when replaced or unmounted', async () => {
  const web = await source('src/components/RawMeshView.web.tsx');

  assert.match(web, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(web, /observer\.disconnect\(\)/);
  assert.match(web, /disposeObject\(modelRoot\)/);
  assert.match(web, /renderer\.dispose\(\)/);
  assert.match(web, /renderer\.forceContextLoss\(\)/);
  assert.match(web, /stage\.dispose\(\)/);
});

test('native raw-mesh approval is safe and retains a generated still fallback', async () => {
  const native = await source('src/components/RawMeshView.tsx');

  assert.doesNotMatch(native, /from ['"]three|GLTFLoader/);
  assert.match(native, /fallbackImageUri/);
  assert.match(native, /resizeMode="contain"/);
  assert.match(native, /onReadyRef\.current\?\.\(\)/);
  assert.match(native, /Use PixBrik on the web to rotate this GLB interactively/);
  assert.match(native, /export const isInteractiveRawMeshViewSupported = false/);
});
