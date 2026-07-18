# Fotobrik mobile foundation

An Expo prototype for the PixBrik object-to-build journey. Clerk identity is optional; builds and demo orders remain device-local until the PostgreSQL buyer APIs are connected.

## Run it

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run start
```

Then press `i`, `a`, or `w` in Expo for iOS, Android, or web. You can also run a target directly:

```bash
npm run ios
npm run android
npm run web
```

From this folder, verify the prototype with:

```bash
npm run check
```

## Optional Clerk identity

Add the public key from the Clerk dashboard to the Expo/Vercel environment:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_or_live_value
```

Do not add a Clerk secret key to the Expo bundle. If the publishable key is absent, the app starts normally and clearly labels account authentication as unavailable and all data as device-only.

Expo web renders Clerk's official sign-in-or-up component on the dedicated `/account` path so its verification steps cannot collide with PixBrik's public-page hashes. iOS and Android keep a safe explanatory fallback in the current build because Clerk's prebuilt native UI requires a new Expo development build. Session tokens use Clerk's Expo token cache backed by `expo-secure-store`; signing in does not yet upload or claim existing local builds or demo orders, and local demo orders store no Clerk name, email, or subject.

## Demo path

1. Home: introduces the Capture → Model → Source → Build studio flow.
2. Capture route: select one photo or a 360° capture.
3. Demo camera: capture the included abstract fox object.
4. Preferences: choose finished size, detail, and colour energy.
5. Workshop: a short simulated local build process.
6. Result: drag to rotate a projected 3D voxel model, switch to a static build view, and compare profiles.
7. Parts manifest: browse sample references, colours, quantities, prices, and availability.
8. Purchase routes: change destination country and compare clearly-labelled demo options.
9. Nearby stores: see store features while keeping wall contents explicitly unverified.
10. Build guide: move through four illustrative construction steps.

After generation, the compact dock jumps among 3D, Parts, Source, and Build.

## Visual direction

“Signal Workshop” combines a warm editorial canvas with graphite model stages, electric indigo, coral capture signals, aqua validation, and a restrained acid accent. The persistent angular Fotobrik mark, technical grid, tabular metrics, and interactive voxel model create the personality without borrowing toy-company marks, photography, logos, or packaging cues.

Core tokens live in `src/theme/tokens.ts`. The persistent identity is in `BrandMark.tsx`; the interactive projected model is in `RotatableBuildPreview.tsx`.

## Architecture

- `App.tsx`: deliberately small typed state-machine navigation; no navigation dependency for the demo.
- `src/screens`: one screen component per file.
- `src/components`: reusable tactile controls, frame, dock, and vector illustrations.
- `src/data/catalog-demo.json`: stable local sample contract that can later be replaced by catalog/build APIs.
- `tests`: zero-dependency fixture-contract checks.

This foundation intentionally does not scrape stores or marketplaces. Prices, matches, and stock are demo values and the interface labels them as such.
