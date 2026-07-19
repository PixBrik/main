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
  assert.match(checkout, /model,/);
  assert.match(checkout, /buildId,/);
  assert.doesNotMatch(checkout, /saveBuild\(/);
  assert.match(checkout, /onOrderPlaced\(placed\)/);
  assert.doesNotMatch(checkout, /onPress=\{\(\) => setPlaced\(true\)\}/);

  assert.match(store, /const STORAGE_KEY = 'pixbrik\.orders\.v1'/);
  assert.match(store, /const hollow = input\.fill === 'hollow'/);
  assert.match(store, /brickify\(input\.model, input\.accent, \{ hollow \}\)/);
  assert.match(store, /const orderedModel = hollow \? hollowBuildModel\(input\.model\) : input\.model/);
  assert.match(store, /if \(!isAssemblyBuildable\(bom\)\) return null/);
  assert.match(store, /model: snapshotOrderModel\(orderedModel, input\.accent\)/);
  assert.match(store, /placements: bom\.placements\.map/);
  assert.match(store, /partLines: bom\.lines\.map/);
  assert.match(store, /parts: bom\.totalParts/);
  assert.match(store, /status: 'reserved-demo'/);
  assert.match(store, /JSON\.stringify\(\[order, \.\.\.listOrders\(\)\]/);
});

test('build naming follows the exact active gallery record into checkout without creating a duplicate', async () => {
  const [app, field, checkout] = await Promise.all([
    source('App.tsx'),
    source('src/components/BuildNameField.tsx'),
    source('src/screens/CheckoutScreen.tsx'),
  ]);

  assert.match(app, /const \[activeSavedBuildId, setActiveSavedBuildId\] = useState<string \| null>\(null\)/);
  assert.match(app, /const \[buildName, setBuildName\] = useState\('PixBrik build'\)/);
  assert.match(app, /activateSavedBuild\('panel', \{ id: saved\?\.id \?\? null, name: savedName \}\)/);
  assert.match(app, /activateSavedBuild\('sculpture', \{ id: saved\?\.id \?\? null, name: savedName \}\)/);
  assert.match(app, /activeSavedBuildId=\{activeSavedBuildId\}/);
  assert.match(app, /onBuildNameChange=\{changeActiveBuildName\}/);
  assert.match(app, /buildId=\{activeSavedBuildId\}/);
  assert.match(app, /buildName=\{buildName\}/);

  assert.match(field, /buildId: string \| null/);
  assert.match(field, /name: string/);
  assert.match(field, /onNameChange: \(name: string\) => void/);
  assert.match(field, /!!buildId/);
  assert.match(field, /if \(!buildId\)/);
  assert.match(field, /this session and any demo order only/);
  assert.match(field, /buildId \? \(saved \? 'Saved ✓' : 'Save name'\) : 'Use name'/);
  assert.match(field, /renameBuild\(buildId, trimmedName\)/);
  assert.doesNotMatch(field, /latestBuild/);

  assert.match(checkout, /buildId: string \| null/);
  assert.match(checkout, /buildId,/);
  assert.match(checkout, /model,/);
  assert.doesNotMatch(checkout, /saveBuild/);
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
  assert.match(account, /Build gallery \(\$\{buildCount\}\)/);

  assert.match(app, /model=\{loadOrderModel\(selectedOrder\.model\)\}/);
  assert.match(app, /bomOverride=\{selectedOrder\.bom\}/);
  assert.match(app, /orderId=\{selectedOrder\.id\}/);
  assert.match(
    app,
    /onOpenInstructions=\{\(order\) => \{[\s\S]*setSelectedOrder\(order\);[\s\S]*navigate\('instructions', order\);/,
    'opening a stored order must pass the order synchronously through browser-aware navigation',
  );
  assert.doesNotMatch(instructions, /from '\.\.\/data\/mockData'/);
  assert.match(instructions, /brickify\(model, accent, \{ hollow: buildFill === 'hollow' \}\)/);
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
