import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('demo checkout persists a complete order instead of only toggling confirmation UI', async () => {
  const [checkout, store] = await Promise.all([
    source('src/screens/CheckoutScreen.tsx'),
    source('src/lib/orderStore.ts'),
  ]);

  assert.match(checkout, /const order = createOrder\(\{/);
  assert.match(checkout, /const orderedModel = buildFill === 'hollow' \? hollowBuildModel\(model\) : model/);
  assert.match(checkout, /buildId: saved\?\.id \?\? null/);
  assert.match(checkout, /onOrderPlaced\(placed\)/);
  assert.doesNotMatch(checkout, /onPress=\{\(\) => setPlaced\(true\)\}/);

  assert.match(store, /const STORAGE_KEY = 'pixbrik\.orders\.v1'/);
  assert.match(store, /if \(!isAssemblyBuildable\(bom\)\) return null/);
  assert.match(store, /model: snapshotOrderModel\(input\.model, input\.accent\)/);
  assert.match(store, /placements: bom\.placements\.map/);
  assert.match(store, /partLines: bom\.lines\.map/);
  assert.match(store, /parts: bom\.totalParts/);
  assert.match(store, /status: 'reserved-demo'/);
  assert.match(store, /JSON\.stringify\(\[order, \.\.\.listOrders\(\)\]/);
});

test('unbuildable previews cannot become orders or child-facing manuals', async () => {
  const [bomScreen, instructions, pdf, share, store] = await Promise.all([
    source('src/screens/BomScreen.tsx'),
    source('src/screens/InstructionsScreen.tsx'),
    source('src/lib/instructionsPdf.ts'),
    source('src/lib/guideShare.ts'),
    source('src/lib/orderStore.ts'),
  ]);

  assert.match(bomScreen, /assemblyPlan\?\.supportSummary\.unsupported/);
  assert.match(bomScreen, /will not create an order or a child-facing manual/);
  assert.match(store, /isAssemblyBuildable\(bom\)/);
  assert.match(instructions, /plan\.supportSummary\.unsupported > 0/);
  assert.match(pdf, /plan\.supportSummary\.unsupported > 0/);
  assert.match(share, /isAssemblyBuildable\(build\.bom, \{ placementOrder: manual\.placementOrder \}\)/);
});

test('account exposes persisted order details and the exact order guide', async () => {
  const [account, app, menu, instructions, pdf, three] = await Promise.all([
    source('src/screens/AccountScreen.tsx'),
    source('App.tsx'),
    source('src/components/TopMenu.tsx'),
    source('src/screens/InstructionsScreen.tsx'),
    source('src/lib/instructionsPdf.ts'),
    source('src/components/ThreeBrickView.web.tsx'),
  ]);

  assert.match(menu, /navigate\('account'\)/);
  assert.match(app, /case 'account'/);
  assert.match(account, /listOrders/);
  assert.match(account, /order\.buildName/);
  assert.match(account, /order\.profile/);
  assert.match(account, /order\.paletteMode/);
  assert.match(account, /order\.parts\.toLocaleString/);
  assert.match(account, /Open this build's instructions/);
  assert.match(account, /My builds \(\$\{buildCount\}\)/);

  assert.match(app, /model=\{loadOrderModel\(selectedOrder\.model\)\}/);
  assert.match(app, /bomOverride=\{selectedOrder\.bom\}/);
  assert.match(app, /orderId=\{selectedOrder\.id\}/);
  assert.match(
    app,
    /onOpenInstructions=\{\(order\) => \{[\s\S]*setSelectedOrder\(order\);[\s\S]*setScreen\('instructions'\);/,
    'opening a stored order must not depend on selectedOrder state updating synchronously',
  );
  assert.doesNotMatch(instructions, /from '\.\.\/data\/mockData'/);
  assert.match(instructions, /brickify\(model, accent\)/);
  assert.match(instructions, /createAssemblyPlan\(bom, placementOrder \? \{ placementOrder \} : \{\}\)/);
  assert.match(instructions, /stepsByLayer/);
  assert.match(instructions, /candidate\.number <= step\.number/);
  assert.match(instructions, /generateInstructionsPdf\(\{/);
  assert.match(instructions, /paperSize,/);
  assert.match(instructions, /packedPlan=\{previewBom\}/);
  assert.match(instructions, /highlightPlacement=\{step\.placement\}/);
  assert.match(pdf, /const bom = bomOverride \?\? brickify\(model, accent\)/);
  assert.match(pdf, /const plan = createAssemblyPlan\(bom\)/);
  assert.match(pdf, /addManifestPages\(doc, bom\)/);
  assert.match(pdf, /addStepPages\(doc, plan/);
  assert.doesNotMatch(pdf, /stepLines\.slice\(0,/);
  assert.doesNotMatch(pdf, /const stepBom = brickify/);
  assert.match(three, /packed\.placements/);
  assert.match(three, /CATALOG KIT PREVIEW/);
});

test('ordered model snapshot survives gallery trimming and rebuilds instructions independently', async () => {
  const store = await source('src/lib/orderStore.ts');

  assert.match(store, /export interface OrderModelSnapshot/);
  assert.match(store, /export function snapshotOrderModel/);
  assert.match(store, /export function loadOrderModel/);
  assert.match(store, /buildModelFromCells/);
  assert.match(store, /buildId: string \| null/);
  assert.match(store, /model: OrderModelSnapshot/);
});

test('hollow checkout preserves approved exterior shapes so quote and saved order agree', async () => {
  const [brickify, voxelFox] = await Promise.all([
    source('src/lib/brickify.ts'),
    source('src/lib/voxelFox.ts'),
  ]);

  assert.match(brickify, /preserveShapes: true/);
  assert.match(voxelFox, /preserveShapes\?: boolean/);
  assert.match(voxelFox, /if \(!options\.preserveShapes\) \{/);
  assert.match(voxelFox, /if \(!options\.preserveShapes && options\.slopes !== false\)/);
});
