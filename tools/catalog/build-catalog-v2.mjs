/**
 * Builds the in-app brick catalog from the crawled GoBricks inventory
 * (data/gobricks/*, see crawl-gobricks.mjs).
 *
 * Upgrades over v1 (Rebrickable + estimates):
 *  - REAL per-colour retail prices (GoBricks USD, converted to EUR)
 *  - live stock: only variants actually ON_SHELF with inventory > 0
 *  - the full GoBricks colour chart (with LEGO/LDraw cross-references)
 *  - real GoBricks SKU codes + detail-page links per part+colour
 *
 * Also emits data/gobricks/full-catalog.json — the entire parts universe
 * (every part × every colour variant) for future packing engines.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gb = (f) => join(root, 'data', 'gobricks', f);

const USD_TO_EUR = 0.92;

const colorsRaw = JSON.parse(readFileSync(gb('colors.json'), 'utf8'));
const details = readFileSync(gb('details.ndjson'), 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// ---- colour chart ----
const colorByName = new Map();
const colorByCode = new Map();
const outColors = [];
for (const color of colorsRaw.colors ?? []) {
  const entry = {
    id: Number(color.color_code),
    name: color.color_name,
    rgb: color.color_value,
    trans: color.color_type === '3',
    metallic: color.color_type === '2',
    legoColorCode: color.lego_color_code ?? null,
    ldraw: Number.isFinite(Number(color.ldraw_color_code)) ? Number(color.ldraw_color_code) : null,
    scarcity: 1,
  };
  outColors.push(entry);
  colorByName.set(color.color_name.toLowerCase(), entry);
  colorByCode.set(String(Number(color.color_code)), entry);
}

function skuColor(sku) {
  // sku_code like GDS-502-010 → colour code suffix; specs carry the name.
  const codeMatch = /-(\d{3})$/.exec(sku.sku_code ?? '');
  if (codeMatch && colorByCode.has(String(Number(codeMatch[1])))) {
    return colorByCode.get(String(Number(codeMatch[1])));
  }
  try {
    const specs = JSON.parse(sku.specs ?? '[]');
    const name = specs.find((s) => s.spec_name === 'color')?.spec_value;
    if (name && colorByName.has(name.toLowerCase())) {
      return colorByName.get(name.toLowerCase());
    }
  } catch {
    // fallthrough
  }
  return null;
}

// ---- full catalog (all parts, all variants) ----
const fullCatalog = details.map((detail) => ({
  id: detail.id,
  name: detail.caption,
  legoCode: detail.lego_code || null,
  ldrawCode: detail.ldraw_code || null,
  mouldCode: detail.mould_code || null,
  categoryId: detail.category_id,
  picture: detail.picture_url,
  variants: (detail.product_skus ?? [])
    .map((sku) => {
      const color = skuColor(sku);
      const priceUsd = Number(sku.currency_product_sku?.price ?? NaN);
      return {
        skuId: sku.id,
        skuCode: sku.sku_code,
        colorId: color?.id ?? null,
        colorName: color?.name ?? null,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
        inventory: Number(sku.inventory ?? 0),
        onShelf: sku.shelf_state === 'ON_SHELF',
        weightG: Number(sku.product_weight ?? 0),
      };
    })
    .filter((variant) => variant.colorId !== null),
}));
writeFileSync(gb('full-catalog.json'), JSON.stringify(fullCatalog));
const variantCount = fullCatalog.reduce((sum, part) => sum + part.variants.length, 0);

// ---- app catalog: the 11 packing sizes with real prices ----
const BRICK_SIZES = [
  { caption: 'brick 2 x 8', w: 2, l: 8 },
  { caption: 'brick 2 x 6', w: 2, l: 6 },
  { caption: 'brick 2 x 4', w: 2, l: 4 },
  { caption: 'brick 2 x 3', w: 2, l: 3 },
  { caption: 'brick 2 x 2', w: 2, l: 2 },
  { caption: 'brick 1 x 8', w: 1, l: 8 },
  { caption: 'brick 1 x 6', w: 1, l: 6 },
  { caption: 'brick 1 x 4', w: 1, l: 4 },
  { caption: 'brick 1 x 3', w: 1, l: 3 },
  { caption: 'brick 1 x 2', w: 1, l: 2 },
  { caption: 'brick 1 x 1', w: 1, l: 1 },
];

const outBricks = [];
for (const size of BRICK_SIZES) {
  const part = fullCatalog.find((candidate) => candidate.name?.trim().toLowerCase() === size.caption);
  if (!part) {
    console.warn(`MISSING part for "${size.caption}"`);
    continue;
  }
  const elements = {};
  const prices = {};
  const inventory = {};
  const skuIds = {};
  for (const variant of part.variants) {
    if (!variant.onShelf || variant.inventory <= 0 || variant.priceUsd === null) continue;
    elements[variant.colorId] = variant.skuCode;
    prices[variant.colorId] = Number((variant.priceUsd * USD_TO_EUR).toFixed(4));
    inventory[variant.colorId] = variant.inventory;
    skuIds[variant.colorId] = variant.skuId;
  }
  const priceValues = Object.values(prices).sort((a, b) => a - b);
  const median = priceValues[Math.floor(priceValues.length / 2)] ?? 0.05;
  // GDS-<mould>-<colour> → mould segment drives the per-colour image URL:
  // https://image.gobricks.cn/newproducts/<colour>/<mould>.png
  const mould = /GDS-([0-9A-Za-z]+)-/.exec(part.variants[0]?.skuCode ?? '')?.[1] ?? null;
  outBricks.push({
    part: part.legoCode || part.mouldCode || part.id,
    gobricksId: part.id,
    mould,
    name: part.name,
    w: size.w,
    l: size.l,
    studs: size.w * size.l,
    basePriceEur: median,
    elements,
    prices,
    inventory,
    skuIds,
  });
}

// ---- 45° slope family: converts stair-steps into real sloped parts ----
// ridge = studs along the ridge line; every part is 2 deep (slope + top row).
const SLOPE_SIZES = [
  { lego: '4445', ridge: 8 },
  { lego: '3037', ridge: 4 },
  { lego: '3038', ridge: 3 },
  { lego: '3039', ridge: 2 },
  { lego: '3040', ridge: 1 },
];

const outSlopes = [];
for (const size of SLOPE_SIZES) {
  const part = fullCatalog.find((candidate) => candidate.legoCode === size.lego);
  if (!part) {
    console.warn(`MISSING slope ${size.lego}`);
    continue;
  }
  const elements = {};
  const prices = {};
  const inventory = {};
  const skuIds = {};
  for (const variant of part.variants) {
    if (!variant.onShelf || variant.inventory <= 0 || variant.priceUsd === null) continue;
    elements[variant.colorId] = variant.skuCode;
    prices[variant.colorId] = Number((variant.priceUsd * USD_TO_EUR).toFixed(4));
    inventory[variant.colorId] = variant.inventory;
    skuIds[variant.colorId] = variant.skuId;
  }
  const priceValues = Object.values(prices).sort((a, b) => a - b);
  const mould = /GDS-([0-9A-Za-z]+)-/.exec(part.variants[0]?.skuCode ?? '')?.[1] ?? null;
  outSlopes.push({
    part: size.lego,
    gobricksId: part.id,
    mould,
    name: part.name,
    ridge: size.ridge,
    basePriceEur: priceValues[Math.floor(priceValues.length / 2)] ?? 0.03,
    elements,
    prices,
    inventory,
    skuIds,
  });
}

// Colours only count if at least one packing brick is actually buyable in them.
const usedColorIds = new Set();
for (const brick of outBricks) {
  for (const id of Object.keys(brick.elements)) usedColorIds.add(Number(id));
}
const finalColors = outColors.filter((color) => usedColorIds.has(color.id));

const catalog = {
  source:
    'GoBricks storefront catalog (gobricks.net) — real retail prices (USD→EUR @0.92) and live stock at crawl time. Colour chart includes LEGO/LDraw cross-references. Crawled with permission of the operator of this prototype for demo purposes.',
  crawledParts: fullCatalog.length,
  crawledVariants: variantCount,
  colors: finalColors,
  bricks: outBricks,
  slopes: outSlopes,
};

writeFileSync(join(root, 'apps', 'mobile', 'src', 'data', 'brickCatalog.json'), JSON.stringify(catalog, null, 1) + '\n');

const combos = outBricks.reduce((sum, brick) => sum + Object.keys(brick.elements).length, 0);
console.log(
  `full catalog: ${fullCatalog.length} parts, ${variantCount} variants | app catalog: ${outBricks.length} sizes, ${finalColors.length} colours, ${combos} buyable combos`,
);
