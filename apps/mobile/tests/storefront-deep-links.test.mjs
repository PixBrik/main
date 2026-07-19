import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFileSync(path.join(root, file), 'utf8');

function loadPureTypeScript(file) {
  const filename = path.join(root, file);
  const compiled = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', compiled)(module.exports, module);
  return module.exports;
}

const routes = loadPureTypeScript('src/lib/storefrontRoutes.ts');

test('lifecycle email paths resolve to deliberate storefront screens on a fresh load', () => {
  assert.equal(routes.storefrontScreenFromPathname('/create'), 'mode');
  assert.equal(routes.storefrontScreenFromPathname('/create/'), 'mode');
  assert.equal(routes.storefrontScreenFromPathname('/contact'), 'contact');
  assert.equal(routes.storefrontScreenFromPathname('/contact/'), 'contact');

  assert.equal(routes.storefrontScreenFromPathname('/'), null);
  assert.equal(routes.storefrontScreenFromPathname('/create/something-else'), null);
  assert.equal(routes.storefrontScreenFromPathname('/contact/something-else'), null);
});

test('canonical paths round-trip and remain exact', () => {
  assert.equal(routes.storefrontPathForScreen('mode'), '/create');
  assert.equal(routes.storefrontPathForScreen('contact'), '/contact');
  assert.equal(routes.storefrontPathForScreen('capture'), null);

  assert.equal(routes.storefrontPathMatchesScreen('mode', '/create'), true);
  assert.equal(routes.storefrontPathMatchesScreen('mode', '/create/'), true);
  assert.equal(routes.storefrontPathMatchesScreen('contact', '/contact'), true);
  assert.equal(routes.storefrontPathMatchesScreen('contact', '/create'), false);
});

test('app boot, reload and popstate all use the same deep-link resolver', () => {
  const app = source('App.tsx');

  assert.match(app, /const storefrontScreen = storefrontScreenFromLocation\(\);/);
  assert.match(app, /if \(storefrontScreen\) return storefrontScreen;/);
  assert.match(
    app,
    /storefrontScreenFromLocation\(\) \?\?[\s\S]*?accountScreenFromLocation\(\) \?\?[\s\S]*?legalScreenFromLocation\(\)/,
  );
  assert.match(app, /const storefrontPath = storefrontPathForScreen\(screen\);/);
  assert.match(app, /if \(storefrontPath\) return `\$\{storefrontPath\}\$\{search\}`;/);
  assert.match(app, /storefrontPathMatchesScreen\(screen, window\.location\.pathname\)/);
  assert.match(app, /\.\.\.STOREFRONT_DEEP_LINK_SCREENS/);
  assert.match(app, /case 'mode':/);
  assert.match(app, /case 'contact':/);
});
