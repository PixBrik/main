# PixBrik — Full Project Brief (external-agent handoff)

Written 16 Jul 2026 as a self-contained context pack for an outside coding
agent (Codex). Everything here is current as of commit `6393c9e`. The
mesh→brick conversion has its own deep-dive: `docs/brick-engine-brief.md` —
read that before touching anything in `src/lib/photoEngine/`.

## 1. Product

PixBrik (www.pixbrik.com) turns a customer photo into a physical brick
building kit: the buyer sees a brick rendition of their photo, picks a style
and size, and orders a boxed kit (real sorted parts + printed instructions).
It is a working **prototype**: pricing, parts and previews are real; checkout
takes no payment. The differentiator is likeness — a buyer must recognise
their cat/car/face in the preview or they won't buy. The owner's quality bar
is high and the product voice is honest (never claim AI/retraining/live
features that don't exist).

Two product tiers:
- **Panel** (free to preview, the volume product): a dithered brick mosaic of
  the framed photo — Classic B/W, Sepia, or Full Colour. Always looks right;
  computed on-device in ~1s.
- **Full 3D sculpture** (premium): AI image→3D generation (Meshy-6 first,
  Tripo fallback), buyer approves the raw 3D before brick conversion.

## 2. Stack, repo, deploy

- Expo / React Native compiled to web (RN-web), TypeScript strict. The web
  app IS the product (desktop + mobile browser); native builds fall back to
  a sample object.
- Repo `github.com/PixBrik/main`; app in `apps/mobile`. Push to `main`
  auto-deploys www.pixbrik.com via Vercel. Serverless functions live in
  `apps/mobile/api/` (same deployment).
- No router: `App.tsx` holds a `DemoScreen` state machine + all cross-screen
  state. Global nav = `NavigationContext` + `TopMenu` (account + hamburger).
- Design system "Saffron Press": tokens in `src/theme/tokens.ts` (saffron
  `#FFC800` world, ink `#17130A`, white pills, alarm red rationed). Archivo
  Black / Archivo fonts. Follow existing component patterns.
- Suites (run from `apps/mobile`): `npm run check` (typecheck+tests),
  `npx expo-doctor`, `npx expo export --platform web`. All must pass before
  push.

## 3. The buyer flow (rebuilt from scratch 16 Jul — keep its philosophy)

Home → CREATE A BUILD → mode (single photo / 360° capture) →

**Capture** (`src/screens/CaptureScreen.tsx`, fully rewritten):
1. Add photo (picked photos are downscaled to ≤1600px immediately —
   `downscalePhoto.ts` — full-size phone photos killed mobile tabs).
2. Frame it: photo pans under a fixed window (one drag gesture) + big +/−
   zoom buttons. COCO detection (`detect.ts`) only pre-centres the frame,
   non-blocking with an 8s timeout.
3. "See it in bricks" → three real style previews from the WHOLE framed
   photo (full-frame mask). Background removal is an **opt-in toggle**
   (classic heuristic mask), never a gate. Tap a preview → lightbox with
   ‹ › browsing and Select.
4. Rights checkbox → "Choose the size".

**The philosophy that must survive future edits**: the fragile CV stack
(SAM, CLIP, face landmarks, depth) is OUT of the buyer's critical path.
It exists only in the hidden Model Lab. Full-frame panels have no AI
failure modes; that is why they are the default.

→ Preferences (`PreferencesScreen` — currently decorative, chips don't
drive the engine; known debt) → Progress (staged animation) →

**Result** (`ResultScreen.tsx`): big preview (WebGL `ThreeBrickView` /
SVG schematic), **CHOOSE A BUILD PROFILE** tickets — each previews ITS OWN
model (head-on mosaic for panels via `panelMosaicFaces`) with real hollow
("standard kit") part counts and prices — plus "Make it a full 3D
sculpture — AI-generated, you approve it first" (the premium upgrade:
generates mesh → shows 3 raw stills in an approval modal → only on
approval converts at all three profiles). PDF guide export. →

**BOM** (`BomScreen`, prices the chosen fill) → **Purchase**
(`PurchaseScreen`: STANDARD hollow preselected / SOLID·COLLECTOR upsell,
country shipping, real catalog prices) → Checkout (demo, no payment).

**360° capture** (`Capture360Screen.tsx`): guided 4-slot capture
(front required) → Tripo `multiview_to_model`. Shots persist
(`capture360Store.ts`); the lab can A/B them. (Approve-first not yet
applied to this path — open item.)

## 4. Engines

- **Panel pipeline** (`voxelizePhoto.ts` + `segment.ts`): colour grid
  sampling (colours for EVERY cell — a fixed bug; don't regress), value
  ramps with Floyd–Steinberg dithering (classic 4 greys / sepia 5 nougats)
  or posterized natural colour; relief = 2-deep panel. Colour distance =
  **redmean** everywhere (weighted-luma once turned dark hair green).
- **Generated 3D**: `imageTo3D.ts` — `generateMeshFromPhoto()` (Meshy-6
  first; Tripo fallback ONLY on submit failure, never after a task exists),
  `buildFromMeshUrlAllProfiles()` after approval, `buildFromMultiview()`
  (Tripo 4-view). Mesh→brick conversion: `meshVoxelize.web.ts` — surface
  shell + outside flood fill (robust to non-watertight AI meshes; ray
  parity is banned, it collapsed on real Tripo output), barycentric colour
  sampling, supersampled shell colours, adaptive k-means palette with
  maximin seeding and small-feature protection. Full details + ranked
  accuracy levers: `docs/brick-engine-brief.md`.
- **Legacy depth-volume path** (photo → depth-inflated 3D) still exists for
  the lab's baseline card but is out of the buyer flow — do not reinvest.

## 5. Server proxies (`apps/mobile/api/`)

- `tripo/{submit,status,model}.ts` + `_tripo.ts`: TRIPO_API_KEY server-side
  only. Submit takes `{image}` (image_to_model) or `{views:{front,…}}`
  (multiview, files order [front,left,back,right], `{}` placeholders).
  **model_version whitelist is mandatory** — the endpoint is public and
  every task spends real credits. 402 → out of credits.
- `meshy/{submit,status,model}.ts` + `_meshy.ts`: MESHY_API_KEY (set in
  Vercel by the owner; account had ~1,110 credits). ai_model pinned
  `meshy-6`, polycount capped 10k. Status is mapped to the Tripo-compatible
  shape so the client poll loop is engine-agnostic. GLBs stream same-origin
  (CORS + keeps CDN URLs private).
- **Never** put an API key client-side, in the repo, or loosen the
  whitelists. Env vars need a redeploy to take effect.

## 6. Catalog & commerce

Real parts catalog crawled from GoBricks (`src/data/brickCatalog.json`):
11 sizes × 63 stocked colours (93 solid colours for quantization), real
per-colour prices. `brickify.ts` merges voxel runs into purchasable parts
(including 45° wedge parts), `{hollow}` drops enclosed interior cells
(~58% part saving, identical outside). `estimateBuild()` returns full +
hollow sides. **Hollow is the standard product everywhere** (tickets, lab,
BOM, purchase default); solid is the collector upsell. Known gap: the PDF
instructions (`instructionsPdf`) still describe the SOLID build.

## 7. Hidden tooling

- **Model Lab** (hamburger menu → MODEL LAB, or `#lab`): runs the same
  locked photo through every engine — on-device depth (free), Tripo
  v1.4/v2.0/v2.5, Meshy-6, Tripo 360° multiview, demo duck (free). Each
  card shows RAW 3D stills (meshSnapshot.web.ts, throwaway WebGL contexts)
  next to OUR BRICK PROPOSAL with standard-kit pricing. Mesh URLs persist
  per candidate; **"RE-CONVERT LAST MESH · FREE"** re-runs only the
  conversion — the loop for judging conversion changes without spending
  generation credits.
- **Coach** (bottom of lab): deterministic feedback → parameter tuning
  (localStorage) + advice log with JSON export. It must never claim model
  retraining — the models are frozen.

## 8. Device & performance rules

- Photos: always ≤1600px working copies (`downscalePhoto`).
- `isLightDevice()` (mobile UA / ≤4GB / `?light` override): light devices
  skip heavy models. The rebuilt buyer flow needs none of them anyway.
- Long CPU work in the browser must be async-chunked with
  **MessageChannel** ticks (`setTimeout` is throttled to ≥1s in background
  tabs — this once made a 30s job take minutes and look like a hang).
- Three.js rendering: NoToneMapping + near-neutral lights (ACES hue-shifts
  brick colours). Never force-distinct catalog colours per cluster.
- Relief panels in generic isometric projection render FROM BEHIND —
  use `panelMosaicFaces()` (head-on) for any panel preview.

## 9. Open work, ranked

1. First real Meshy-6 run + Meshy-vs-Tripo verdict (owner runs; lab ready).
2. Mesh-engine accuracy: interior-surface colour bleed is the top lever
   (engine brief §3.1); then palette zone work.
3. Hollow-aware PDF instructions (blocks real fulfilment).
4. Preferences screen: wire its chips to the engine or fold the step away.
5. Approve-first flow for the 360° path; Meshy multi-image variant.
6. Background-removal toggle quality: SAM could power it on capable
   desktops (opt-in only, never the default path).
7. Checkout is a prototype: no payments/accounts by design — do not add
   real payment collection without explicit owner direction.

## 10. Ground rules (non-negotiable)

- **Verify visually.** Twice this project shipped geometry/colour
  regressions that brick-counts and typechecks could not catch. Render
  projections (`window.__bake(url, profile)` dev hook + orthographic
  projections) or serialize the preview SVGs, and LOOK before shipping.
  Canonical free test assets: the Khronos Duck GLB and a synthetic
  portrait canvas.
- **Credits are real money.** Tripo ~30/task, Meshy per-task. Never spend
  them in tests — the duck and re-convert loops are free. The owner runs
  paid comparisons.
- **Trademark rule**: never use third-party toy-brand names, product
  photography, or trade dress anywhere in the product.
- **Honest UI**: no fake progress, no fake AI claims, prices always from
  the real catalog.
- Determinism: same input → same build (seeded k-means etc.).
- Match the Saffron Press design system; all suites green; push to main
  deploys production immediately — verify on www.pixbrik.com after.
