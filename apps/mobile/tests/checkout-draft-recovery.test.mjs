import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

async function loadStore() {
  const typescript = await source('src/lib/checkoutDraftStore.ts');
  const javascript = ts.transpileModule(typescript, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function draftInput(overrides = {}) {
  return {
    build: {
      accent: '#3264e8',
      buildId: 'saved-build-7',
      fill: 'hollow',
      hasDepth: true,
      mode: 'volume',
      name: 'Exact fox',
      paletteMode: 'natural',
      product: 'sculpture',
      selectedVariant: 'detail',
      source3DMeshUrl: '/api/tripo/model?taskId=opaque',
      source3DRetakesRemaining: 1,
      source3DSubject: 'person',
      style: 'natural',
    },
    delivery: { countryCode: 'FR', rangeLabel: '6-9 business days' },
    model: {
      brickCount: 2,
      cells: [[0, 0, 0, 0], [1, 0, 0, 1, 1, 2]],
      palette: ['#3264e8', '#ffffff'],
      size: 1,
    },
    quote: {
      currency: 'EUR',
      currencySymbol: '€',
      kitPrice: 99,
      quotedAt: '2026-07-19T10:00:00.000Z',
      requiresServerReprice: true,
      shippingPrice: 12,
      totalPrice: 111,
    },
    ...overrides,
  };
}

test('same-device checkout recovery freezes the exact configuration behind an opaque URL id', async () => {
  globalThis.localStorage = fakeStorage();
  const store = await loadStore();
  const now = Date.parse('2026-07-19T10:00:00.000Z');
  const saved = store.saveCheckoutDraft(draftInput(), now);

  assert.ok(saved);
  assert.match(saved.id, /^pbd_[A-Za-z0-9_-]{22}$/);
  assert.equal(saved.build.fill, 'hollow');
  assert.equal(saved.build.selectedVariant, 'detail');
  assert.deepEqual(saved.model.cells, draftInput().model.cells);
  assert.equal(saved.quote.requiresServerReprice, true);
  assert.equal(JSON.stringify(saved).includes('data:image'), false, 'raw photos are not retained');

  const path = store.checkoutDraftPath(saved.id);
  assert.equal(path, `/checkout?draft=${saved.id}`);
  assert.equal(
    store.checkoutDraftIdFromLocation({ pathname: '/checkout/', search: `?draft=${saved.id}` }),
    saved.id,
  );
  assert.equal(store.checkoutDraftIdFromLocation({ pathname: '/account', search: `?draft=${saved.id}` }), null);
  assert.deepEqual(store.loadCheckoutDraft(saved.id, now), saved);

  store.removeCheckoutDraft(saved.id);
  assert.equal(store.loadCheckoutDraft(saved.id, now), null);
});

test('draft recovery fails closed for expired, malformed and unsafe local records', async () => {
  globalThis.localStorage = fakeStorage();
  const store = await loadStore();
  const now = Date.parse('2026-07-19T10:00:00.000Z');
  const saved = store.saveCheckoutDraft(draftInput(), now);
  assert.ok(saved);
  assert.equal(store.loadCheckoutDraft(saved.id, now + 31 * 24 * 60 * 60 * 1_000), null);
  assert.equal(store.loadCheckoutDraft('../../secrets', now), null);
  assert.equal(
    store.saveCheckoutDraft(draftInput({
      build: { ...draftInput().build, source3DMeshUrl: 'http://insecure.example/model.glb' },
    }), now),
    null,
  );
  assert.equal(
    store.saveCheckoutDraft(draftInput({
      model: { ...draftInput().model, cells: [[0, 0, 0, 999]] },
    }), now),
    null,
  );
});

test('the checkout route restores drafts and copy does not promise server or email recovery', async () => {
  const [app, checkout] = await Promise.all([
    source('App.tsx'),
    source('src/screens/CheckoutScreen.tsx'),
  ]);

  assert.match(app, /checkoutDraftFromLocation\(\)/);
  assert.match(app, /photoBuildFromCheckoutDraft/);
  assert.match(app, /checkoutDraftId=\{checkoutDraftId\}/);
  assert.match(app, /const handleCheckoutDraftSaved = useCallback/);
  assert.match(app, /onCheckoutDraftSaved=\{handleCheckoutDraftSaved\}/);
  assert.match(checkout, /saveCheckoutDraft\(\{/);
  assert.match(checkout, /snapshotOrderModel\(model, accent\)/);
  assert.match(checkout, /if \(savedDraftId\) removeCheckoutDraft\(savedDraftId\)/);
  assert.match(checkout, /This is device-only; no recovery email will be sent\./);
  assert.doesNotMatch(checkout, /Email me|Send recovery email|saved to your account/i);
});
