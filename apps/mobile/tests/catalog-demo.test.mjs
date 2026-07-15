import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('../src/data/catalog-demo.json', import.meta.url);

async function readFixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('demo catalog keeps stable part keys and positive quantities', async () => {
  const catalog = await readFixture();
  const keys = new Set();

  assert.ok(catalog.parts.length >= 6);
  for (const part of catalog.parts) {
    const key = `${part.id}:${part.color}`;
    assert.equal(keys.has(key), false, `duplicate part key ${key}`);
    keys.add(key);
    assert.ok(part.quantity > 0);
    assert.match(part.hex, /^#[0-9A-F]{6}$/i);
  }
});

test('demo journey has variants, purchasing countries, stores, and ordered steps', async () => {
  const catalog = await readFixture();

  assert.ok(catalog.variants.length >= 3);
  assert.ok(
    catalog.variants.every(
      (variant) => variant.dimensions && variant.estimatedTime && variant.difficulty,
    ),
  );
  assert.match(catalog.project.catalogVersion, /^FB-DEMO-/);
  assert.ok(catalog.project.assumption.length > 0);
  assert.ok(catalog.countries.some((country) => country.code === 'FR'));
  assert.ok(catalog.stores.every((store) => store.verification.length > 0));
  assert.deepEqual(
    catalog.instructions.map((step) => step.number),
    [1, 2, 3, 4],
  );
});
