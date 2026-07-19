import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('purchase does not offer a coupon control before discounts are wired', async () => {
  const purchase = await readFile(path.join(root, 'src', 'screens', 'PurchaseScreen.tsx'), 'utf8');

  assert.doesNotMatch(purchase, /Coupon code|Coupon rules are placeholders/);
  assert.doesNotMatch(purchase, /onPress=\{\(\) => undefined\}/);
  assert.doesNotMatch(purchase, /live part stock/);
  assert.match(purchase, /current catalog snapshot/);
});

test('global buyer menu excludes context-only kit and internal lab routes', async () => {
  const menu = await readFile(path.join(root, 'src', 'components', 'TopMenu.tsx'), 'utf8');

  assert.doesNotMatch(menu, /label: 'MY KIT'/);
  assert.doesNotMatch(menu, /screen: 'purchase'/);
  assert.doesNotMatch(menu, /MODEL LAB/);
  assert.doesNotMatch(menu, /screen: 'lab'/);
});
