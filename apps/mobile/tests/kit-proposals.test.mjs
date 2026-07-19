import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sizingPath = path.join(root, 'src', 'lib', 'kitSizing.ts');
const sizingSource = await readFile(sizingPath, 'utf8');
const compiled = ts.transpileModule(sizingSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sizingPath,
}).outputText;
const sizingModule = { exports: {} };
new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
  sizingModule.exports,
  () => ({}),
  sizingModule,
  sizingPath,
  path.dirname(sizingPath),
);
const { SCULPTURE_STUD_SPAN, SCULPTURE_SIZE_OPTIONS, STUD_PITCH_CM } = sizingModule.exports;

test('true 3D proposals are distinct gift-sized physical spans', () => {
  const spans = ['efficient', 'balanced', 'detailed'].map((profile) => SCULPTURE_STUD_SPAN[profile]);
  assert.deepEqual(spans, [20, 32, 48]);
  assert.ok(spans[0] < spans[1] && spans[1] < spans[2]);
  assert.deepEqual(
    ['efficient', 'balanced', 'detailed'].map((profile) => SCULPTURE_SIZE_OPTIONS[profile].name),
    ['Mini', 'Classic', 'Showcase'],
  );
  assert.deepEqual(
    spans.map((span) => Number((span * STUD_PITCH_CM).toFixed(1))),
    [16, 25.6, 38.4],
  );
});

test('proposal screen compares size and reinforced-hollow versus solid before checkout', async () => {
  const [app, result, purchase, checkout, assessment] = await Promise.all([
    readFile(path.join(root, 'App.tsx'), 'utf8'),
    readFile(path.join(root, 'src', 'screens', 'ResultScreen.tsx'), 'utf8'),
    readFile(path.join(root, 'src', 'screens', 'PurchaseScreen.tsx'), 'utf8'),
    readFile(path.join(root, 'src', 'screens', 'CheckoutScreen.tsx'), 'utf8'),
    readFile(path.join(root, 'src', 'lib', 'kitAssessment.ts'), 'utf8'),
  ]);

  assert.match(app, /buildFill=\{buildFill\}/);
  assert.match(app, /onBuildFillChange=\{setBuildFill\}/);
  assert.match(result, /CHOOSE THE INSIDE/);
  assert.match(result, /REINFORCED HOLLOW/);
  assert.match(result, /SOLID CORE/);
  assert.match(result, /selectedCard\?\.\[buildFill\]/);
  assert.match(result, /card\?\.\[effectiveFill\]/);
  assert.match(result, /card\.dimensions/);
  assert.match(result, /Calculating exact dimensions, parts, and price/);
  assert.match(result, /hollowSavesPieces/);
  assert.match(result, /hollow=\{buildFill === 'hollow'\}/);
  assert.match(
    result,
    /humanSubject && activeProduct === 'sculpture' && profile === 'efficient'/,
    'person detection must remove the low-fidelity Mini sculpture option',
  );
  assert.match(result, /onSelectVariant\(availableVariants\[0\]!\.id\)/);
  assert.match(result, /disabled=\{awaitingSculpture \|\| !quoteReady\}/);
  assert.match(result, /Calculating exact catalog kit/);
  assert.match(result, /selectedEstimate\?\.parts \?\? photoStats\?\.pieces/);
  assert.match(result, /const dimensionsMetric = selectedCard\?\.dimensions/);
  assert.match(result, /SOURCE \/ One front photo · no hidden surfaces are generated/);
  assert.doesNotMatch(result, /ASSUMPTION \/ \{demoProject\.assumption\}/);
  assert.match(result, /const quoteReady = !!selectedEstimate\?\.buildable/);
  assert.match(result, /current\[otherFill\]\?\.buildable/);
  assert.match(result, /disabled=\{unavailable\}/);
  assert.match(purchase, /two base layers plus internal ribs and/);
  assert.match(purchase, /disabled=\{!option\.buildable\}/);
  assert.match(purchase, /!side\.buildable && otherSide\?\.buildable/);
  assert.match(checkout, /if \(!selectedSide\?\.buildable\)/);
  assert.match(assessment, /computeBuildAssessment/);
});
