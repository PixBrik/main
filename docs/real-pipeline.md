# Real pipeline status (last updated 15 Jul 2026, evening)

What is real, what is estimated, and what still needs keys/partners.

## Real

- **Measured 3D depth** — Depth Anything V2 (small, quantized ONNX) runs
  fully in-browser via onnxruntime-web (runtime JS/WASM from jsDelivr CDN,
  ~26 MB weights from HuggingFace, browser-cached). Full-3D builds shape the
  front surface from measured depth; silhouette inflation remains the
  fallback (and the native path). `src/lib/photoEngine/depth.ts`.
- **GoBricks live catalog** — complete MOC-parts inventory crawled from the
  GoBricks storefront API (`tools/catalog/crawl-gobricks.mjs`, rate-limited
  and resumable; raw data in `data/gobricks/`). Real per-colour retail
  prices (USD→EUR), live stock at crawl time, GoBricks SKU codes, LEGO and
  LDraw cross-reference codes, and the full colour chart.
  `tools/catalog/build-catalog-v2.mjs` regenerates the in-app catalog;
  re-run the crawl periodically to refresh prices/stock.

- **Parts catalog** — built from the official Rebrickable database dumps
  (`data/rebrickable/`, regenerate with `node tools/catalog/build-catalog.mjs`).
  11 basic brick sizes × 93 colours = 710 real part+colour **element ids**
  (buyable references). Compact runtime catalog: `apps/mobile/src/data/brickCatalog.json`.
  Attribution: catalog data © Rebrickable, used per their download terms.
- **Photo → 3D engine** (web) — COCO-SSD object detection with tap-to-select,
  **SAM segmentation** (SlimSAM via Transformers.js, prompted at the user's
  selection — clean cutouts on any background; classic border-colour
  segmentation remains the fallback), distance-transform depth inflation,
  photo colours quantized to catalog colours. Runs entirely on-device.
  `src/lib/photoEngine/`. Single-view: UI copy calls it a
  *silhouette-based interpretation*, never an exact replica.
- **Brickifier** — greedy per-layer packing of the voxel model into real parts
  (`src/lib/brickify.ts`); unavailable part+colour combos are substituted with
  the nearest colour that exists as a real element, and flagged.
- **Realistic renderer** — three.js instanced bricks with studs, PBR material,
  shadows, environment reflections (`ThreeBrickView.web.tsx`). Native keeps the
  SVG viewer via platform split.
- **Instruction guide** — layer-by-layer PDF with per-step diagrams and part
  callouts, FotoBrik-branded, neutral wording (`src/lib/instructionsPdf.ts`).
- **Build gallery** — previous builds persisted locally and reopenable
  (`src/lib/buildGallery.ts`).

## Estimated (clearly labeled in UI)

- **Prices** — base-per-stud × colour-scarcity model in EUR, converted for the
  country selector. Marked "est." everywhere. Swap in live pricing by
  implementing a provider against `brickify.ts` line items once
  BrickLink/BrickOwl API keys exist.
- **Bundle quote** — parts estimate + 40 % preparation markup, excl. shipping
  and VAT. Quote only; no payment or order processing exists.

## Not built / needs partners

- Live per-market stock and prices (marketplace API keys or partnerships).
- Multi-view or learned depth reconstruction (currently silhouette inflation).
- Physical store inventory (the stores screen remains demo data).
- Native (iOS/Android) ML + WebGL parity — web-first per decision of 14 Jul.
