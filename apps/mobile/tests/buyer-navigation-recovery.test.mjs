import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('public pages and account/order manuals keep real browser history', async () => {
  const app = await source('App.tsx');

  assert.match(app, /PUBLIC_INFORMATION_SCREENS\.has\(pathCandidate\)/);
  assert.match(app, /if \(PUBLIC_INFORMATION_SCREENS\.has\(screen\)\) return `\/\$\{screen\}\$\{search\}`/);
  assert.match(app, /function locationMatchesScreen/);
  assert.match(app, /history\.length > 0[\s\S]*?window\.history\.back\(\)/);
  assert.match(app, /ADDRESSABLE_SCREENS\.has\(screen\) \|\| ADDRESSABLE_SCREENS\.has\(destination\)/);
  assert.match(app, /order guide at `\/` returning to its `\/account` browser entry/);
  assert.doesNotMatch(
    app,
    /if \(history\.length > 0\) \{\s*setHistory\(\(current\) => current\.slice\(0, -1\)\);\s*window\.history\.back\(\)/,
    'popstate must be the only code that trims the app history for browser Back',
  );

  assert.match(app, /navigate\('instructions', order\)/);
  assert.match(app, /orderForInstructions: OrderRecord \| null = selectedOrder/);
  assert.match(app, /destination === 'instructions' && !!orderForInstructions/);
  assert.match(
    app,
    /onOpenInstructions=\{\(order\) => \{[\s\S]*?setSharedGuideId\(null\);[\s\S]*?setSharedGuide\(null\);[\s\S]*?setSelectedOrder\(order\);[\s\S]*?navigate\('instructions', order\);/,
  );
  assert.doesNotMatch(
    app,
    /onOpenInstructions=\{\(order\) => \{[\s\S]*?setScreen\('instructions'\)/,
    'opening an order manual must not bypass browser-aware navigation',
  );
});

test('shared-guide exits clear route and state before another build can open a manual', async () => {
  const app = await source('App.tsx');

  assert.match(app, /const \[sharedGuideId, setSharedGuideId\] = useState/);
  assert.match(app, /const exitSharedGuide = \(\) => \{/);
  assert.match(app, /setSharedGuideId\(null\)/);
  assert.match(app, /setSharedGuide\(null\)/);
  assert.match(app, /setSharedGuideError\(''\)/);
  assert.match(app, /pixbrikScreen: 'home'/);
  assert.match(app, /onBack=\{exitSharedGuide\}/);
  assert.match(app, /destination === 'instructions' && !instructionsAvailableRef\.current/);
  assert.match(app, /const leavesSharedGuide =/);
  assert.match(app, /const leavesStoredOrderGuide =/);
  assert.match(app, /screen === 'instructions' &&[\s\S]*?!!selectedOrder/);
  assert.match(app, /if \(leavesSharedGuide \|\| leavesStoredOrderGuide\)/);
  assert.match(app, /Starting a new[\s\S]*buyer journey must retire that read-only context/);
  assert.match(app, /setHistory\(destination === 'home' \? \[\] : \['home'\]\)/);
});

test('frozen order and QR manuals do not expose dead live-workspace tabs', async () => {
  const instructions = await source('src/screens/InstructionsScreen.tsx');

  assert.match(instructions, /const standaloneGuide = !!\(orderId \|\| publishedGuideUrl\)/);
  assert.match(
    instructions,
    /\{!standaloneGuide \? <DemoDock active="instructions" onNavigate=\{onNavigate\} \/> : null\}/,
  );
  assert.match(
    instructions,
    /footer=\{standaloneGuide \? undefined : <DemoDock active="instructions" onNavigate=\{onNavigate\} \/>\}/,
  );
});

test('My Builds moves to the gallery and parts copy stays honest about prototype fulfilment', async () => {
  const [home, bom] = await Promise.all([
    source('src/screens/HomeScreen.tsx'),
    source('src/screens/BomScreen.tsx'),
  ]);

  assert.match(home, /const openBuildGallery = \(\) => \{/);
  assert.match(home, /scrollRef\.current\?\.scrollTo/);
  assert.match(home, /onPress=\{openBuildGallery\}/);
  assert.match(home, /Open build gallery with/);

  assert.match(bom, /catalog references and snapshot prices/);
  assert.match(bom, /does not take payment or start fulfilment/);
  assert.doesNotMatch(bom, /matched to real parts with real prices/);
});
