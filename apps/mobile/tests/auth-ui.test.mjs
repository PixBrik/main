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

test('Clerk is optional behind one stable PixBrik auth boundary', () => {
  const auth = source('src/lib/pixbrikAuth.tsx');
  const app = source('App.tsx');
  const pkg = JSON.parse(source('package.json'));

  assert.match(auth, /EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY\?\.trim\(\)/);
  assert.match(auth, /if \(!publishableKey\)/);
  assert.match(auth, /configured: false/);
  assert.match(auth, /loaded: true/);
  assert.match(auth, /export function usePixBrikAuth/);
  assert.match(auth, /configured: boolean/);
  assert.match(auth, /isSignedIn: boolean/);
  assert.match(auth, /signOut: \(\) => Promise<void>/);
  assert.match(auth, /tokenCache=\{tokenCache\}/);
  assert.match(app, /<PixBrikAuthProvider>/);
  assert.match(app, /function accountScreenFromLocation/);
  assert.match(app, /ADDRESSABLE_SCREENS/);
  assert.match(app, /locationForScreen\(destination\)/);
  assert.equal(typeof pkg.dependencies['@clerk/expo'], 'string');
  assert.equal(typeof pkg.dependencies['expo-secure-store'], 'string');
});

test('anonymous and authenticated top-menu states are honest', () => {
  const menu = source('src/components/TopMenu.tsx');
  assert.match(menu, /usePixBrikAuth\(\)/);
  assert.match(menu, /'SIGN IN'/);
  assert.match(menu, /!auth\.configured \? 'ACCOUNT'/);
  assert.match(menu, /<BricklingAvatar/);
  assert.match(menu, /auth\.user\.id/);
  assert.match(menu, /decorative/);
  assert.doesNotMatch(menu, /accountHead|accountBody/);
});

test('account distinguishes Clerk identity from local data and performs real sign-out', () => {
  const account = source('src/screens/AccountScreen.tsx');
  const webPanel = source('src/components/ClerkAuthPanel.web.tsx');
  const nativePanel = source('src/components/ClerkAuthPanel.tsx');

  assert.match(account, /await auth\.signOut\(\)/);
  assert.match(account, /SIGNED IN WITH CLERK/);
  assert.match(account, /SAVED ON THIS DEVICE · NOT ACCOUNT-SYNCED/);
  assert.match(account, /Secure account sign-in has not been connected to this site yet/);
  assert.doesNotMatch(account, /Clerk is not configured on this deployment/);
  assert.match(account, /It will not be added to your Clerk account/);
  assert.match(webPanel, /from '@clerk\/expo\/web'/);
  assert.match(webPanel, /path="\/account"/);
  assert.match(webPanel, /routing="path"/);
  assert.match(webPanel, /withSignUp/);
  assert.match(nativePanel, /NATIVE SIGN-IN ISN'T IN THIS BUILD YET/);
  assert.doesNotMatch(nativePanel, /@clerk\/expo\/native/);
});

test('demo checkout never pretends that local details create an account', () => {
  const checkout = source('src/screens/CheckoutScreen.tsx');

  assert.match(checkout, /usePixBrikAuth\(\)/);
  assert.match(checkout, /NOT SIGNED IN · DEVICE-ONLY DEMO/);
  assert.match(checkout, /Saving this demo does not create an account/);
  assert.match(checkout, /SIGN IN OR CREATE ACCOUNT/);
  assert.match(checkout, /CHECKING SECURE SIGN-IN/);
  assert.match(checkout, /customerEmail: null/);
  assert.match(checkout, /customerName: null/);
  assert.match(checkout, /guest: true/);
  assert.doesNotMatch(checkout, /setGuest|setEmail|setName|<TextInput/);
});

test('Brickling identity is deterministic and varies across seeds', () => {
  const { bricklingDesign, bricklingHash } = loadPureTypeScript('src/lib/brickling.ts');
  const seed = 'user_123:sam@example.com';
  assert.equal(bricklingHash(seed), bricklingHash(seed));
  assert.deepEqual(bricklingDesign(seed), bricklingDesign(seed));
  assert.notDeepEqual(bricklingDesign(seed), bricklingDesign('user_456:alex@example.com'));
  assert.deepEqual(bricklingDesign(seed), bricklingDesign(' USER_123:SAM@EXAMPLE.COM '));
});

test('buyer library has no public prototype-admin entry or route', () => {
  const library = source('src/screens/LibraryScreen.tsx');
  const app = source('App.tsx');
  const navigation = source('src/types/navigation.ts');
  assert.doesNotMatch(library, /Manage library \(admin\)|onNavigate\('admin'\)/);
  assert.doesNotMatch(app, /case 'admin'|<AdminScreen/);
  assert.doesNotMatch(navigation, /\| 'admin'/);
});
