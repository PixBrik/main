/**
 * Brickifier: packs the voxel model into real catalog parts.
 *
 * Greedy per-layer packing — biggest brick first, both orientations, only
 * over same-colour cells. Every line in the resulting bill of materials is
 * a real part reference; where the exact part+colour combination exists in
 * the catalog the real element id is attached, otherwise the nearest
 * available colour is substituted and flagged.
 *
 * Prices are estimates (base per stud count × colour scarcity), pending
 * marketplace API keys.
 */

import catalog from '../data/brickCatalog.json';
import { colorDistance } from './photoEngine/voxelizePhoto';
import { buildModelFromCells, FACE_DIRECTIONS, type VoxelCell, type VoxelModel } from './voxelFox';
import { voxelBaseColor } from './voxelRender';

export interface BomLine {
  part: string;
  partName: string;
  w: number;
  l: number;
  colorId: number;
  colorName: string;
  colorRgb: string;
  elementId: string | null;
  /** GoBricks sku id for direct product links (when catalog provides it). */
  skuId: string | null;
  /** Real product photo of this exact part in this exact colour. */
  imageUrl: string | null;
  /** True when this line's unit price is a model estimate, not live retail. */
  estimated: boolean;
  substituted: boolean;
  quantity: number;
  unitPriceEur: number;
  lineTotalEur: number;
}

export interface BrickPlacement {
  part: string;
  colorId: number;
  /** Anchor cell (min i / min k) and layer. */
  i: number;
  j: number;
  k: number;
  /** Footprint after orientation. */
  spanI: number;
  spanK: number;
  /** Catalog shape metadata used by the exact kit preview and instructions. */
  shape: 'brick' | 'slope';
  /** Slope descent direction, indexed like FACE_DIRECTIONS. */
  facing?: number;
}

export interface BillOfMaterials {
  lines: BomLine[];
  totalParts: number;
  totalEur: number;
  colorCount: number;
  /** True when ANY line fell back to estimated pricing. */
  isEstimate: boolean;
  /** Physical placement of every packed brick — feeds exports. */
  placements: BrickPlacement[];
}

interface CatalogColor {
  id: number;
  name: string;
  rgb: string;
  trans: boolean;
  scarcity: number;
}

interface CatalogBrick {
  part: string;
  name: string;
  w: number;
  l: number;
  studs: number;
  basePriceEur: number;
  elements: Record<string, string>;
  /** Real per-colour retail prices (EUR) when the catalog carries them. */
  prices?: Record<string, number>;
  /** Live stock per colour at crawl time. */
  inventory?: Record<string, number>;
  /** Marketplace sku ids per colour for direct links. */
  skuIds?: Record<string, string>;
  /** GoBricks mould code — drives real per-colour product photos. */
  mould?: string | null;
}

const COLORS = catalog.colors as unknown as CatalogColor[];
const BRICKS = catalog.bricks as unknown as CatalogBrick[];

interface CatalogSlope extends CatalogBrick {
  ridge: number;
}

/** Distinguish expected catalog-capacity failures from programming errors. */
export function isCatalogStockError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('Catalog stock cannot cover');
}

/** 45° slope parts, largest ridge first for greedy packing. */
const SLOPE_PARTS: CatalogSlope[] = (
  (catalog as unknown as { slopes?: Array<Omit<CatalogSlope, 'w' | 'l' | 'studs'>> }).slopes ?? []
)
  .map((slope) => ({ ...slope, l: slope.ridge, studs: slope.ridge, w: 2 }))
  .sort((a, b) => b.ridge - a.ridge);

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

const colorCache = new Map<string, CatalogColor>();

/** Nearest catalog colour for an arbitrary hex. */
export function catalogColorFor(hex: string): CatalogColor {
  const cached = colorCache.get(hex);
  if (cached) {
    return cached;
  }
  const [r, g, b] = hexToRgb(hex);
  let best = COLORS[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of COLORS) {
    if (color.trans) continue;
    const [cr, cg, cb] = hexToRgb(color.rgb);
    const distance = colorDistance(r, g, b, cr, cg, cb);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  colorCache.set(hex, best);
  return best;
}

/** Nearest buyable colour for this part that still has recorded stock. */
function stockedColorFor(
  brick: CatalogBrick,
  wanted: CatalogColor,
  stockUsed: Map<string, number>,
): { color: CatalogColor; substituted: boolean } | null {
  const hasStock = (colorId: number) => {
    if (!brick.elements[String(colorId)]) return false;
    const available = brick.inventory?.[String(colorId)];
    return available === undefined || (stockUsed.get(`${brick.part}|${colorId}`) ?? 0) < available;
  };
  if (hasStock(wanted.id)) {
    return { color: wanted, substituted: false };
  }
  const [r, g, b] = hexToRgb(wanted.rgb);
  let best: CatalogColor | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of COLORS) {
    if (color.trans || !hasStock(color.id)) continue;
    const [cr, cg, cb] = hexToRgb(color.rgb);
    const distance = colorDistance(r, g, b, cr, cg, cb);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best ? { color: best, substituted: true } : null;
}

export interface BrickifyOptions {
  /**
   * Hollow build: drop fully-enclosed interior cells (a cell whose six axis
   * neighbours all exist), keeping only the visible shell. This is how real
   * MOCs are built and cuts the part count sharply on solid volumes. Relief
   * panels are already ~shell, so hollow ≈ full there.
   */
  hollow?: boolean;
}

/** Cells that form the visible shell — everything except fully-enclosed interiors. */
function shellCells(model: VoxelModel): VoxelCell[] {
  const present = new Set(model.cells.map((cell) => `${cell.i}|${cell.j}|${cell.k}`));
  const NEIGHBOURS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;
  return model.cells.filter((cell) => {
    for (const [di, dj, dk] of NEIGHBOURS) {
      if (!present.has(`${cell.i + di}|${cell.j + dj}|${cell.k + dk}`)) {
        return true; // has an exposed face → part of the shell
      }
    }
    return false; // fully enclosed → interior, dropped when hollow
  });
}

/**
 * Materialise the exact model sold as a hollow kit. Keeping this as a model,
 * rather than only an estimate option, lets orders and their instructions
 * retain the same cells the customer actually purchased.
 */
export function hollowBuildModel(model: VoxelModel): VoxelModel {
  // Removing the hidden core must not reclassify the already-approved outer
  // slopes. Otherwise the parts quote and the saved order can disagree.
  return buildModelFromCells(
    shellCells(model).map((cell) => ({ ...cell })),
    model.size,
    { layerHeight: model.layerHeight, preserveShapes: true },
  );
}

export function brickify(model: VoxelModel, accent: string, options: BrickifyOptions = {}): BillOfMaterials {
  const colorOf = (cell: VoxelCell) =>
    catalogColorFor(cell.colorHex ?? voxelBaseColor({ ...cell, exposed: [] }, accent)).id;

  const sourceCells = options.hollow ? shellCells(model) : model.cells;

  // part|color -> quantity
  const tally = new Map<string, number>();
  const placements: BrickPlacement[] = [];
  const stockUsed = new Map<string, number>();
  const substitutedKeys = new Set<string>();
  const reserveStock = (part: string, colorId: number) => {
    const key = `${part}|${colorId}`;
    stockUsed.set(key, (stockUsed.get(key) ?? 0) + 1);
  };
  /** Cells consumed by slope parts (the slope cell AND its back cell). */
  const consumed = new Set<string>();

  // ---- 45° slope runs → real slope parts (3040 family) ----
  if (SLOPE_PARTS.length) {
    const cellIndex = new Map(sourceCells.map((cell) => [`${cell.i}|${cell.j}|${cell.k}`, cell]));
    const runs = new Map<string, Array<{ pos: number; cellKey: string; backKey: string; i: number; k: number }>>();

    for (const cell of sourceCells) {
      if (cell.shape !== 'slope' || !cell.facing) continue;
      const dir = FACE_DIRECTIONS[cell.facing]!;
      const backKey = `${cell.i - dir.x}|${cell.j}|${cell.k - dir.z}`;
      const back = cellIndex.get(backKey);
      // Knife-edge ridges have no free back cell; those stay cube-packed.
      if (!back || back.shape === 'slope') continue;
      const colorId = colorOf(cell);
      const ridgeAlongI = dir.z !== 0;
      const lineKey = `${cell.j}|${cell.facing}|${colorId}|${ridgeAlongI ? cell.k : cell.i}`;
      if (!runs.has(lineKey)) runs.set(lineKey, []);
      runs.get(lineKey)!.push({
        backKey,
        cellKey: `${cell.i}|${cell.j}|${cell.k}`,
        i: cell.i,
        k: cell.k,
        pos: ridgeAlongI ? cell.i : cell.k,
      });
    }

    for (const [lineKey, entries] of runs) {
      const colorId = Number(lineKey.split('|')[2]);
      entries.sort((a, b) => a.pos - b.pos);
      // Split into consecutive segments, then pack each greedily.
      let segment: typeof entries = [];
      const segments: Array<typeof entries> = [];
      for (const entry of entries) {
        if (segment.length && entry.pos !== segment[segment.length - 1]!.pos + 1) {
          segments.push(segment);
          segment = [];
        }
        segment.push(entry);
      }
      if (segment.length) segments.push(segment);

      for (const run of segments) {
        let offset = 0;
        while (offset < run.length) {
          const remaining = run.length - offset;
          // Preserve the preview colour whenever a fitting in-stock slope
          // exists. A shorter exact-colour slope beats a larger substituted
          // one because the visible surface must match the approved preview.
          const wanted = COLORS.find((color) => color.id === colorId)!;
          let slopePart: CatalogSlope | null = null;
          let resolved: { color: CatalogColor; substituted: boolean } | null = null;
          for (const requireExactColor of [true, false]) {
            for (const candidate of SLOPE_PARTS) {
              if (candidate.ridge > remaining) continue;
              const candidateColor = stockedColorFor(candidate, wanted, stockUsed);
              if (!candidateColor || (requireExactColor && candidateColor.substituted)) continue;
              slopePart = candidate;
              resolved = candidateColor;
              break;
            }
            if (slopePart && resolved) break;
          }
          if (!slopePart || !resolved) {
            throw new Error(`Catalog stock cannot cover slope colour ${wanted.name}`);
          }
          const take = Math.min(slopePart.ridge, remaining);
          const piece = run.slice(offset, offset + take);
          for (const entry of piece) {
            consumed.add(entry.cellKey);
            consumed.add(entry.backKey);
          }
          const tallyKey = `${slopePart.part}|${resolved.color.id}`;
          tally.set(tallyKey, (tally.get(tallyKey) ?? 0) + 1);
          reserveStock(slopePart.part, resolved.color.id);
          if (resolved.substituted) substitutedKeys.add(tallyKey);
          const facing = Number(lineKey.split('|')[1]);
          const direction = FACE_DIRECTIONS[facing]!;
          const footprint = piece.flatMap((entry) => [
            { i: entry.i, k: entry.k },
            { i: entry.i - direction.x, k: entry.k - direction.z },
          ]);
          const minI = Math.min(...footprint.map((cell) => cell.i));
          const maxI = Math.max(...footprint.map((cell) => cell.i));
          const minK = Math.min(...footprint.map((cell) => cell.k));
          const maxK = Math.max(...footprint.map((cell) => cell.k));
          placements.push({
            colorId: resolved.color.id,
            facing,
            i: minI,
            j: Number(lineKey.split('|')[0]),
            k: minK,
            part: slopePart.part,
            shape: 'slope',
            spanI: maxI - minI + 1,
            spanK: maxK - minK + 1,
          });
          offset += take;
        }
      }
    }
  }

  // ---- rectangle packing for everything not consumed by slopes ----
  const layers = new Map<number, Map<string, { cell: VoxelCell; colorId: number }>>();
  for (const cell of sourceCells) {
    if (consumed.has(`${cell.i}|${cell.j}|${cell.k}`)) continue;
    if (!layers.has(cell.j)) layers.set(cell.j, new Map());
    layers.get(cell.j)!.set(`${cell.i}|${cell.k}`, { cell, colorId: colorOf(cell) });
  }

  for (const [layerJ, layer] of layers) {
    const used = new Set<string>();
    // Deterministic order: sweep cells row-major.
    const keys = [...layer.keys()].sort((a, b) => {
      const [ai, ak] = a.split('|').map(Number);
      const [bi, bk] = b.split('|').map(Number);
      return ak! - bk! || ai! - bi!;
    });

    for (const key of keys) {
      if (used.has(key)) continue;
      const anchor = layer.get(key)!;
      const [i0, k0] = key.split('|').map(Number) as [number, number];

      let placed = false;
      // First pass: use only parts sold in the requested colour. Second pass
      // is the honest last resort for an isolated colour/shape combination.
      const wanted = COLORS.find((color) => color.id === anchor.colorId)!;
      for (const requireExactColor of [true, false]) {
        for (const brick of BRICKS) {
          const resolved = stockedColorFor(brick, wanted, stockUsed);
          if (!resolved || (requireExactColor && resolved.substituted)) continue;
          for (const [w, l] of brick.w === brick.l ? [[brick.w, brick.l]] : [[brick.w, brick.l], [brick.l, brick.w]]) {
            let fits = true;
            for (let di = 0; di < l! && fits; di++) {
              for (let dk = 0; dk < w! && fits; dk++) {
                const cellKey = `${i0 + di}|${k0 + dk}`;
                const cell = layer.get(cellKey);
                if (!cell || used.has(cellKey) || cell.colorId !== anchor.colorId) {
                  fits = false;
                }
              }
            }
            if (!fits) continue;
            for (let di = 0; di < l!; di++) {
              for (let dk = 0; dk < w!; dk++) {
                used.add(`${i0 + di}|${k0 + dk}`);
              }
            }
            const tallyKey = `${brick.part}|${resolved.color.id}`;
            tally.set(tallyKey, (tally.get(tallyKey) ?? 0) + 1);
            reserveStock(brick.part, resolved.color.id);
            if (resolved.substituted) substitutedKeys.add(tallyKey);
            placements.push({
              colorId: resolved.color.id,
              i: i0,
              j: layerJ,
              k: k0,
              part: brick.part,
              shape: 'brick',
              spanI: l!,
              spanK: w!,
            });
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (placed) break;
      }
      if (!placed) {
        throw new Error(`Catalog stock cannot cover ${wanted.name} at ${i0},${layerJ},${k0}`);
      }
    }
  }

  const brickByPart = new Map<string, CatalogBrick>([
    ...BRICKS.map((brick) => [brick.part, brick] as const),
    ...SLOPE_PARTS.map((slope) => [slope.part, slope] as const),
  ]);
  const colorById = new Map(COLORS.map((color) => [color.id, color]));
  const merged = new Map<string, BomLine>();

  for (const [key, quantity] of tally) {
    const [part, colorIdRaw] = key.split('|') as [string, string];
    const brick = brickByPart.get(part)!;
    const color = colorById.get(Number(colorIdRaw))!;
    const substituted = substitutedKeys.has(key);
    const realPrice = brick.prices?.[String(color.id)];
    const unitPrice = realPrice ?? brick.basePriceEur * color.scarcity;

    const mergeKey = `${part}|${color.id}`;
    const existing = merged.get(mergeKey);
    if (existing) {
      existing.quantity += quantity;
      existing.substituted = existing.substituted || substituted;
      existing.lineTotalEur = existing.quantity * existing.unitPriceEur;
    } else {
      merged.set(mergeKey, {
        colorId: color.id,
        colorName: color.name,
        colorRgb: color.rgb,
        elementId: brick.elements[String(color.id)] ?? null,
        estimated: realPrice === undefined,
        imageUrl: brick.mould
          ? `https://image.gobricks.cn/newproducts/${String(color.id).padStart(3, '0')}/${brick.mould}.png`
          : null,
        l: brick.l,
        lineTotalEur: quantity * unitPrice,
        part,
        partName: brick.name,
        quantity,
        skuId: brick.skuIds?.[String(color.id)] ?? null,
        substituted,
        unitPriceEur: Number(unitPrice.toFixed(3)),
        w: brick.w,
      });
    }
  }

  const lines = [...merged.values()].sort((a, b) => b.quantity - a.quantity);
  const totalParts = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalEur = Number(lines.reduce((sum, line) => sum + line.lineTotalEur, 0).toFixed(2));

  return {
    colorCount: new Set(lines.map((line) => line.colorId)).size,
    isEstimate: lines.some((line) => line.estimated),
    lines,
    placements,
    totalEur,
    totalParts,
  };
}

/** Direct GoBricks product page when known, else the Rebrickable part page. */
export function partUrl(line: BomLine): string {
  if (line.skuId) {
    return `https://gobricks.net/part_detail?id=${line.skuId}`;
  }
  return `https://rebrickable.com/parts/${line.part}/`;
}

/** Fotobrik service markup on the parts retail for a prepared bundle. */
export const BUNDLE_MARKUP = 0.9;

/** Fotobrik pick-pack-ship bundle: parts retail + service markup (excl. shipping/VAT). */
export function bundleQuote(bom: BillOfMaterials): { retailEur: number; markupEur: number; totalEur: number } {
  const retail = bom.totalEur;
  const markup = Number((retail * BUNDLE_MARKUP).toFixed(2));
  return { markupEur: markup, retailEur: retail, totalEur: Number((retail + markup).toFixed(2)) };
}

export interface BuildEstimateSide {
  parts: number;
  colorCount: number;
  retailEur: number;
  /** Bundle total = parts retail + service markup (before shipping/coupons). */
  bundleEur: number;
  isEstimate: boolean;
}

export interface BuildEstimate {
  full: BuildEstimateSide;
  hollow: BuildEstimateSide;
  /** Fraction of parts saved by going hollow (0..1). */
  hollowSaving: number;
}

function side(bom: BillOfMaterials): BuildEstimateSide {
  const quote = bundleQuote(bom);
  return {
    bundleEur: quote.totalEur,
    colorCount: bom.colorCount,
    isEstimate: bom.isEstimate,
    parts: bom.totalParts,
    retailEur: bom.totalEur,
  };
}

/** Full vs hollow part counts and pricing for one model. */
export function estimateBuild(model: VoxelModel, accent: string): BuildEstimate {
  const full = side(brickify(model, accent));
  const hollow = side(brickify(model, accent, { hollow: true }));
  return {
    full,
    hollow,
    hollowSaving: full.parts > 0 ? Number((1 - hollow.parts / full.parts).toFixed(3)) : 0,
  };
}
