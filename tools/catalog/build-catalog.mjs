/**
 * Builds the compact in-app brick catalog from the official Rebrickable
 * database dumps (data/rebrickable/*.csv — CC-licensed, attribution required).
 *
 * Output: apps/mobile/src/data/brickCatalog.json
 *  - every colour that real basic bricks exist in (element = buyable reference)
 *  - the canonical basic-brick sizes the brickifier packs voxels into
 *  - per part+colour: the real element id and an estimated price
 *
 * Prices are ESTIMATES (no marketplace API keys yet): calibrated to typical
 * new-part market ranges — base by stud count, adjusted by colour scarcity.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (f) => join(root, 'data', 'rebrickable', f);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// The brick sizes the packing engine uses, in preference order (big first).
const BRICK_SIZES = [
  { part: '3007', w: 2, l: 8 },
  { part: '2456', w: 2, l: 6 },
  { part: '3001', w: 2, l: 4 },
  { part: '3002', w: 2, l: 3 },
  { part: '3003', w: 2, l: 2 },
  { part: '3008', w: 1, l: 8 },
  { part: '3009', w: 1, l: 6 },
  { part: '3010', w: 1, l: 4 },
  { part: '3622', w: 1, l: 3 },
  { part: '3004', w: 1, l: 2 },
  { part: '3005', w: 1, l: 1 },
];

const colors = parseCsv(readFileSync(src('colors.csv'), 'utf8'));
const parts = parseCsv(readFileSync(src('parts.csv'), 'utf8'));
const elements = parseCsv(readFileSync(src('elements.csv'), 'utf8'));

const partNames = new Map(parts.map((p) => [p.part_num, p.name]));
const wantedParts = new Set(BRICK_SIZES.map((b) => b.part));

// element references for our brick sizes: part -> color -> element id
const elementIndex = new Map();
for (const e of elements) {
  if (!wantedParts.has(e.part_num)) continue;
  if (!elementIndex.has(e.part_num)) elementIndex.set(e.part_num, {});
  const byColor = elementIndex.get(e.part_num);
  if (!byColor[e.color_id]) byColor[e.color_id] = e.element_id;
}

// colour scarcity factor from how widely the colour is used across the catalog
const maxParts = Math.max(...colors.map((c) => Number(c.num_parts) || 0));
function scarcity(color) {
  const share = (Number(color.num_parts) || 1) / maxParts;
  return Math.min(2.5, 1 + Math.log10(1 / Math.max(share, 1e-4)) * 0.35);
}

const colorById = new Map(colors.map((c) => [c.id, c]));
const usedColorIds = new Set();
for (const byColor of elementIndex.values()) {
  for (const id of Object.keys(byColor)) usedColorIds.add(id);
}

const outColors = [...usedColorIds]
  .map((id) => colorById.get(id))
  .filter(Boolean)
  .filter((c) => c.id !== '-1')
  .map((c) => ({
    id: Number(c.id),
    name: c.name,
    rgb: '#' + c.rgb,
    trans: c.is_trans === 'True',
    scarcity: Number(scarcity(c).toFixed(2)),
  }))
  .sort((a, b) => a.id - b.id);

const outBricks = BRICK_SIZES.map(({ part, w, l }) => {
  const studs = w * l;
  const basePrice = 0.035 + studs * 0.026; // EUR, new-part typical
  const byColor = elementIndex.get(part) ?? {};
  return {
    part,
    name: partNames.get(part) ?? `Brick ${w} x ${l}`,
    w,
    l,
    studs,
    basePriceEur: Number(basePrice.toFixed(3)),
    elements: Object.fromEntries(
      Object.entries(byColor)
        .filter(([colorId]) => colorId !== '-1')
        .map(([colorId, elementId]) => [Number(colorId), elementId]),
    ),
  };
});

const catalog = {
  source: 'Rebrickable database dumps (rebrickable.com/downloads) — CC BY. Prices are Fotobrik estimates, not live market data.',
  generatedFrom: { parts: parts.length, colors: colors.length, elements: elements.length },
  colors: outColors,
  bricks: outBricks,
};

const outPath = join(root, 'apps', 'mobile', 'src', 'data', 'brickCatalog.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(catalog, null, 1) + '\n');

const combos = outBricks.reduce((s, b) => s + Object.keys(b.elements).length, 0);
console.log(`catalog: ${outBricks.length} brick sizes, ${outColors.length} colours, ${combos} buyable part+colour elements`);
