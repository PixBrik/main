# PixBrik — 3D→Brick Engine Brief (external-review handoff)

Written 16 Jul 2026 as a self-contained context pack for an outside coding
agent (Codex) reviewing the **3D-model → brick-build conversion** for
accuracy. Everything an engine reviewer needs is in this file plus the files
it points to. The task: make the brick output look more like the subject.

## 1. Product in one paragraph

PixBrik (www.pixbrik.com, this repo, app in `apps/mobile`, Expo/React-Native
compiled to web, TypeScript) turns a customer photo into a physical brick
building kit: photo → 3D interpretation → voxel grid → real catalog parts →
priced kit with printable instructions. The differentiator is likeness — a
buyer must recognise their cat/car/face in the preview or they won't buy.
Everything runs client-side in the browser except mesh *generation* (Tripo
AI, proxied through `/api/tripo/*` serverless functions; API key server-side
only).

## 2. The two pipelines that end in bricks

### A. Photo pipeline (no external 3D model)
`src/lib/photoEngine/voxelizePhoto.ts`
- Input: a `Segmentation` (normalized mask grid ≤56², colours per cell,
  optional measured depth grid from Depth Anything V2, optional facial
  landmarks) produced by `segment.ts` / `segmentSam.ts` / `depth.ts` /
  `faceFeatures.ts`.
- **Relief mode** (portrait panels): flat 2-deep mosaic, up to 68 studs wide
  (detailed). Value-based styles are the likeness workhorse: percentile
  contrast stretch + Floyd–Steinberg dithering onto fixed ramps — classic B/W
  (4 greys) or sepia (5 nougats) — or posterized natural colour.
- **Volume mode**: silhouette extrusion where back depth scales with local
  silhouette width and front extrusion = width-driven magnitude × a bounded
  depth factor (0.55–1.45) from the measured depth map. Known ceiling: faces
  and complex geometry blob out; this mode is honest-but-weak, which is why
  the mesh pipeline exists.
- Palette: k-means posterize (volume k=8, relief k=14), 3×3 majority
  smoothing, dark-feature protection (`markDarkFeatures`), facial-feature
  stamping post-dither. Colour distance = **redmean** everywhere (weighted
  luma once turned dark hair green — do not reuse).

### B. Mesh pipeline (THE REVIEW TARGET)
`src/lib/photoEngine/meshVoxelize.web.ts` — mesh (GLB) → voxel cells.
Sources of meshes: Tripo image_to_model / multiview_to_model (via
`imageTo3D.ts`), the object library (curated GLBs), demo duck (Khronos
sample). Current algorithm, top to bottom:

1. `prepare()`: traverse the glTF scene; per mesh, clone geometry, **bake
   `matrixWorld` into vertices** (world space, so raycasts and the grid share
   one frame); build a `three-mesh-bvh` BVH; raycast against a **DoubleSide
   clone** of the material (parity must count every wall crossing; FrontSide
   materials silently cull exits). Texture read once into a canvas
   `ImageData` for colour sampling.
2. Grid: axis-aligned bounding box of all meshes, cubic voxels sized
   `maxAxis / RES[profile]`, `RES = { efficient: 28, balanced: 44,
   detailed: 64 }`. Buyer default is **balanced**. World scale normalized to
   6.3 units on the longest axis (matches procedural models).
3. Inside test (per voxel centre): **surface shell + outside flood fill**
   (NOT ray parity — parity variants were tried and collapse on the
   non-watertight meshes AI generators produce; a real Tripo bust once
   converted to 158 floating bricks). SHELL = centres within `0.75 × voxel`
   of any surface (bounded `bvh.closestPointToPoint` with `maxThreshold`,
   so far voxels early-exit); OUTSIDE = 6-connected BFS from every grid
   border voxel through non-shell space; kept = shell ∪ never-reached
   interior. Sub-voxel seams close inside the shell; larger openings leave
   the model hollow but correct. Loop is async-chunked (one x-slice per
   `MessageChannel` tick — `setTimeout` is throttled ≥1s in background
   tabs).
4. Colour (per kept voxel): nearest surface point via
   `bvh.closestPointToPoint`; `surfaceColor()` interpolates attributes
   **barycentrically at the exact closest point** (vertex colour → texture
   UV sample → material colour), with centroid weights as the
   degenerate-triangle fallback.
5. `despeckle()`: drop voxels with ≤1 face-neighbours (parity noise).
6. `posterizeVoxelColors()`: deterministic k-means (k=10, redmean,
   luma-seeded centroids, 8 iterations) over all voxel colours →
   conservative 3D majority smoothing (a cell flips only when ≥4 of its 6
   neighbours agree on another cluster — strict so eyes survive) → each
   cluster mapped to the nearest of the **93 real catalog solid colours**
   (`quantizeToCatalog`). This step took the duck from 30 muddy colours to 5.
7. `buildModelFromCells(cells, worldSize, { slopes: true })`
   (`src/lib/voxelFox.ts`): interior-face culling for rendering +
   `detectSlopes` (a step voxel with a same-colour backing cell becomes a
   45° wedge, facings 1–4).
8. `brickify()` (`src/lib/brickify.ts`): merges voxel runs into real
   purchasable parts (11 sizes × 63 stocked colours from the crawled
   GoBricks catalog, real per-colour prices in
   `apps/mobile/src/data/brickCatalog.json`), packs slope runs into real
   wedge parts (3040/3039/3038/3037/4445), optional `hollow` (drops fully
   enclosed cells, ~33% part saving). `estimateBuild()` = parts, colours,
   retail €, bundle €.
9. Rendering: `ThreeBrickView.web.tsx` (three.js instanced boxes + wedges,
   **NoToneMapping + near-neutral lights** — ACES hue-shifts saturated brick
   colours; never force-distinct catalog colours per cluster, it spreads
   uniform objects onto wrong hues) and `voxelRender.ts` (SVG projection for
   thumbnails/PDF).

## 3. Where accuracy is believed to leak (ranked hypotheses)

1. **Colour sampling is still single-tap.** One `closestPointToPoint` per
   voxel (now barycentric at the hit point, but still one sample). Small
   texture features (eyes, logos, colour boundaries) alias. Fix ideas: 4–8
   jittered samples per voxel with redmean-median; area-weighted sampling
   over the voxel's surface patch.
2. **Fixed k=10 global palette.** A bust with skin+hair+shirt shares 10
   clusters with the background pedestal Tripo sometimes adds. Ideas:
   per-connected-component or per-zone palettes; k chosen by colour variance;
   protect small high-contrast clusters from majority smoothing (the ≥4-of-6
   rule still erodes 1-voxel features).
3. **Shell thickness is fixed at 0.75 voxel.** Bigger closes more seams but
   fattens thin features; smaller is crisper but lets the flood leak through
   coarse AI-mesh cracks. Could be adaptive (measure seam sizes first).
4. **Grid alignment/orientation.** The grid is the world AABB; a model
   rotated 30° wastes resolution and staircases. Idea: PCA or
   oriented-bounding-box align before voxelizing, rotate back after.
5. **Resolution ceilings are UX, not algorithmic.** 44 (balanced) is the
   buyer default; 64 works but costs part count and € (a solid res-44 duck
   is already ~3,487 parts ≈ €431 full / much less hollow). Raising fidelity
   via smarter sampling beats raising resolution.
6. **Slope vocabulary is minimal.** Only axis-aligned 45° wedges with a
   same-colour backer. Real sets use 33°/2×-run slopes, curved slopes,
   plates (⅓-height) for smooth gradients. Plates in particular could halve
   the staircase look of organic shapes — catalog has them.
7. **Depth-volume photo mode** (pipeline A) is fundamentally limited — do
   not spend effort there; the mesh path is the future. The lab exists to
   prove which mesh generator wins.

## 4. Ground rules for any change

- **Verify visually, never by counts.** The twisted-duck regression shipped
  because a refactor was validated by brick counts only. Canonical test
  asset: the Khronos Duck GLB
  (`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb`).
  In-app: dev hook `window.__bake(url, profile)` (defined in `App.tsx`)
  returns `{ size, palette, cells: [i,j,k,paletteIndex][] }` — render
  orthographic projections from that and LOOK at them. The model lab
  (hamburger menu → MODEL LAB, or `#lab`) runs the full path with raw-mesh
  stills next to the brick result.
- **Keep the voxelizer async-chunked** (yield per slice) and off
  `setTimeout` (background-tab throttling). It runs on the main thread; a
  synchronous rewrite will freeze tabs and re-cap resolution.
- **Determinism**: same input → same build (k-means is deterministically
  seeded on purpose; buyers re-open their builds).
- **Palette discipline stays**: raw per-voxel quantization against 93
  colours without posterize is what "messy" looked like.
- **Catalog is the contract**: only parts/colours in `brickCatalog.json`
  exist physically; `brickify` output must remain purchasable, and
  `estimateBuild` prices must stay real.
- **Do not touch** `api/tripo/submit.ts`'s model-version whitelist (public
  endpoint, ~30 credits/task), and never put `TRIPO_API_KEY` client-side.
  Tripo generations cost real credits — test conversion with the free duck
  and locally cached GLBs, not fresh generations.
- Suites: `npm run check`, `npx expo-doctor`, `npx expo export --platform
  web` from `apps/mobile`. Push to `main` auto-deploys www.pixbrik.com.

## 5. Success criteria

On the duck (free) and one Tripo-generated bust GLB (ask the owner — they
have saved outputs): at `balanced`, (1) silhouette recognisable from
front/side/top projections, (2) small features (beak colour boundary, eyes)
survive as distinct catalog colours, (3) no phantom/missing chunks, (4)
part count and price not materially worse than current, (5) wall-clock in a
foreground tab ≤ ~15s at balanced. Any proposal should show before/after
projections of the same GLB, not adjectives.
