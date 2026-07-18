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

export interface CatalogPartFootprint {
  l: number;
  shape: BrickPlacement['shape'];
  w: number;
}

/** Public, read-only geometry guard used by shared-guide validation. */
export function catalogPartFootprint(part: string): CatalogPartFootprint | null {
  const brick = BRICKS.find((candidate) => candidate.part === part);
  if (brick) return { l: brick.l, shape: 'brick', w: brick.w };
  const slope = SLOPE_PARTS.find((candidate) => candidate.part === part);
  return slope ? { l: slope.l, shape: 'slope', w: slope.w } : null;
}

export function isCatalogColorId(colorId: number): boolean {
  return COLORS.some((color) => color.id === colorId);
}

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
   * Hollow build: retain the complete exterior plus a bonded base and an
   * internal support lattice. Relief panels and already-open meshes are
   * effectively all exterior, so hollow ≈ full for those models.
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
 * A hollow sculpture still has to be a build, not a paper-thin render.
 *
 * Keep every exterior cell and two complete bottom layers. Broad block-like
 * volumes use sparse 2 x 2 columns; irregular sculptures use isolated cavity
 * slices separated by four bonded deck layers. This avoids the old paired
 * diaphragms that refilled every standard sculpture while keeping wide roofs
 * supported and catalog-packable.
 *
 * Filtering the original cells also preserves their exact colour and any
 * approved slope metadata. Canonical ordering makes the resulting kit stable
 * even when an equivalent source model arrives with cells in another order.
 */
const HOLLOW_BASE_LAYERS = 2;
const HOLLOW_LATTICE_SPACING = 6;
const HOLLOW_COLUMN_WIDTH = 2;
const HOLLOW_CAVITY_RESIDUES = new Set([0, 4]);

function reinforcedHollowCells(model: VoxelModel): VoxelCell[] {
  if (!model.cells.length) return [];

  const keyOf = (cell: Pick<VoxelCell, 'i' | 'j' | 'k'>) => `${cell.i}|${cell.j}|${cell.k}`;
  const exterior = new Set(shellCells(model).map(keyOf));
  const sourceByKey = new Map(model.cells.map((cell) => [keyOf(cell), cell]));
  let minI = Number.POSITIVE_INFINITY;
  let minJ = Number.POSITIVE_INFINITY;
  let minK = Number.POSITIVE_INFINITY;
  let maxI = Number.NEGATIVE_INFINITY;
  let maxK = Number.NEGATIVE_INFINITY;
  for (const cell of model.cells) {
    minI = Math.min(minI, cell.i);
    minJ = Math.min(minJ, cell.j);
    minK = Math.min(minK, cell.k);
    maxI = Math.max(maxI, cell.i);
    maxK = Math.max(maxK, cell.k);
  }

  const layers = new Map<number, VoxelCell[]>();
  for (const cell of model.cells) {
    const layer = layers.get(cell.j) ?? [];
    layer.push(cell);
    layers.set(cell.j, layer);
  }
  const rectangularLayers = [...layers.values()].filter((layer) => {
    const layerMinI = Math.min(...layer.map((cell) => cell.i));
    const layerMaxI = Math.max(...layer.map((cell) => cell.i));
    const layerMinK = Math.min(...layer.map((cell) => cell.k));
    const layerMaxK = Math.max(...layer.map((cell) => cell.k));
    return layer.length === (layerMaxI - layerMinI + 1) * (layerMaxK - layerMinK + 1);
  }).length;
  const blockLike = rectangularLayers / layers.size >= 0.75;

  // Offset the column lattice into the volume instead of aligning it with a
  // minimum boundary, which is normally already part of the visible shell.
  const gridOriginI = minI + Math.min(
    Math.floor((maxI - minI) / 2),
    Math.floor(HOLLOW_LATTICE_SPACING / 2),
  );
  const gridOriginK = minK + Math.min(
    Math.floor((maxK - minK) / 2),
    Math.floor(HOLLOW_LATTICE_SPACING / 2),
  );
  const onGridLine = (coordinate: number, origin: number) => {
    const remainder = (
      (coordinate - origin) % HOLLOW_LATTICE_SPACING + HOLLOW_LATTICE_SPACING
    ) % HOLLOW_LATTICE_SPACING;
    return remainder < HOLLOW_COLUMN_WIDTH;
  };

  const retained = new Set(
    model.cells
      .filter((cell) => {
        const key = keyOf(cell);
        if (exterior.has(key)) return true;
        if (cell.j < minJ + HOLLOW_BASE_LAYERS) return true;

        if (blockLike) {
          // Two-stud-square columns are each one catalog 2 x 2 brick and keep
          // wide decks within the maximum unsupported span.
          return onGridLine(cell.i, gridOriginI) && onGridLine(cell.k, gridOriginK);
        }

        // Irregular sculptures keep four solid bonding decks out of every six
        // layers and remove hidden cells only on the two cavity slices. The
        // outer shell remains the vertical support lattice.
        const relativeLayer = cell.j - minJ;
        return !HOLLOW_CAVITY_RESIDUES.has(relativeLayer % HOLLOW_LATTICE_SPACING);
      })
      .map(keyOf),
  );

  // Concave source meshes can contain small shell islands that touch the full
  // model only through cells removed by hollowing. Add the shortest paths of
  // original (therefore hidden) cells back to the bonded base component. This
  // keeps the exterior byte-for-byte intact while ensuring every retained
  // detail has a route into the support lattice.
  const neighbourKeys = (key: string): string[] => {
    const [i, j, k] = key.split('|').map(Number) as [number, number, number];
    return [
      `${i}|${j - 1}|${k}`,
      `${i - 1}|${j}|${k}`,
      `${i + 1}|${j}|${k}`,
      `${i}|${j}|${k - 1}`,
      `${i}|${j}|${k + 1}`,
      `${i}|${j + 1}|${k}`,
    ];
  };
  const baseSeed = [...retained]
    .filter((key) => sourceByKey.get(key)?.j === minJ)
    .sort()[0];
  if (baseSeed) {
    const floodRetained = () => {
      const connected = new Set<string>([baseSeed]);
      const queue = [baseSeed];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const neighbour of neighbourKeys(queue[cursor]!)) {
          if (!retained.has(neighbour) || connected.has(neighbour)) continue;
          connected.add(neighbour);
          queue.push(neighbour);
        }
      }
      return connected;
    };

    let connected = floodRetained();
    while (connected.size < retained.size) {
      const queue = [...connected].sort();
      const visited = new Set(queue);
      const parent = new Map<string, string>();
      let target: string | null = null;
      for (let cursor = 0; cursor < queue.length && !target; cursor++) {
        const key = queue[cursor]!;
        for (const neighbour of neighbourKeys(key)) {
          if (!sourceByKey.has(neighbour) || visited.has(neighbour)) continue;
          visited.add(neighbour);
          parent.set(neighbour, key);
          if (retained.has(neighbour) && !connected.has(neighbour)) {
            target = neighbour;
            break;
          }
          queue.push(neighbour);
        }
      }
      if (!target) break;
      for (let key: string | undefined = target; key && !connected.has(key); key = parent.get(key)) {
        retained.add(key);
      }
      connected = floodRetained();
    }
  }

  return model.cells
    .filter((cell) => retained.has(keyOf(cell)))
    .sort((a, b) => a.j - b.j || a.i - b.i || a.k - b.k);
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
    reinforcedHollowCells(model).map((cell) => ({ ...cell })),
    model.size,
    { layerHeight: model.layerHeight, preserveShapes: true },
  );
}

export function brickify(model: VoxelModel, accent: string, options: BrickifyOptions = {}): BillOfMaterials {
  const colorOf = (cell: VoxelCell) =>
    catalogColorFor(cell.colorHex ?? voxelBaseColor({ ...cell, exposed: [] }, accent)).id;

  // Quote, preview, saved order and instructions must all describe the exact
  // same reinforced cell set materialised by `hollowBuildModel` above.
  const sourceCells = options.hollow ? reinforcedHollowCells(model) : model.cells;

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

    // A non-slope back cell can be adjacent to slopes facing in different
    // directions. Resolve those candidates in one canonical order and reserve
    // both studs atomically so two slope placements can never claim it.
    for (const lineKey of [...runs.keys()].sort()) {
      const entries = runs.get(lineKey)!;
      const colorId = Number(lineKey.split('|')[2]);
      entries.sort((a, b) => a.pos - b.pos);
      // Split the still-unreserved candidates into consecutive segments, then
      // pack each greedily. A losing slope cell remains available to the
      // ordinary rectangle packer below.
      let segment: typeof entries = [];
      const segments: Array<typeof entries> = [];
      for (const entry of entries) {
        if (consumed.has(entry.cellKey) || consumed.has(entry.backKey)) {
          if (segment.length) segments.push(segment);
          segment = [];
          continue;
        }
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
  const sourceCellByKey = new Map(sourceCells.map((cell) => [`${cell.i}|${cell.j}|${cell.k}`, cell]));
  const sourceCellKeys = new Set(sourceCells.map((cell) => `${cell.i}|${cell.j}|${cell.k}`));
  const originalExteriorKeys = new Set(model.shell.map((cell) => `${cell.i}|${cell.j}|${cell.k}`));
  const firstSourceLayer = sourceCells.length
    ? Math.min(...sourceCells.map((cell) => cell.j))
    : 0;
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

    const commitBrick = (
      brick: CatalogBrick,
      resolved: { color: CatalogColor; substituted: boolean },
      i0: number,
      k0: number,
      spanI: number,
      spanK: number,
    ) => {
      for (let di = 0; di < spanI; di++) {
        for (let dk = 0; dk < spanK; dk++) used.add(`${i0 + di}|${k0 + dk}`);
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
        spanI,
        spanK,
      });
    };

    const footprintColor = (
      i0: number,
      k0: number,
      spanI: number,
      spanK: number,
      fallbackColorId: number,
    ): { colorId: number; hasVisibleColor: boolean } | null => {
      const visibleColors = new Set<number>();
      for (let di = 0; di < spanI; di++) {
        for (let dk = 0; dk < spanK; dk++) {
          const sourceKey = `${i0 + di}|${layerJ}|${k0 + dk}`;
          if (!originalExteriorKeys.has(sourceKey)) continue;
          const source = sourceCellByKey.get(sourceKey);
          if (source) visibleColors.add(colorOf(source));
        }
      }
      if (visibleColors.size > 1) return null;
      return {
        colorId: visibleColors.values().next().value ?? fallbackColorId,
        hasVisibleColor: visibleColors.size === 1,
      };
    };

    type LayerChoice = {
      brick: CatalogBrick;
      i0: number;
      k0: number;
      resolved: { color: CatalogColor; substituted: boolean };
      spanI: number;
      spanK: number;
      supportedStuds: number;
      unsupportedStuds: number;
    };

    const choicesContaining = (
      targetI: number,
      targetK: number,
      options: { exactVisibleColor?: number; requireBridge?: boolean } = {},
    ): LayerChoice[] => {
      const target = layer.get(`${targetI}|${targetK}`);
      if (!target) return [];
      const choices: LayerChoice[] = [];
      for (const brick of BRICKS) {
        const orientations = brick.w === brick.l
          ? [[brick.l, brick.w] as const]
          : [[brick.l, brick.w] as const, [brick.w, brick.l] as const];
        for (const [spanI, spanK] of orientations) {
          for (let targetDi = 0; targetDi < spanI; targetDi++) {
            for (let targetDk = 0; targetDk < spanK; targetDk++) {
              const i0 = targetI - targetDi;
              const k0 = targetK - targetDk;
              let fits = true;
              let supportedStuds = 0;
              let unsupportedStuds = 0;
              for (let di = 0; di < spanI && fits; di++) {
                for (let dk = 0; dk < spanK; dk++) {
                  const cellKey = `${i0 + di}|${k0 + dk}`;
                  if (!layer.has(cellKey) || used.has(cellKey)) {
                    fits = false;
                    break;
                  }
                  if (sourceCellKeys.has(`${i0 + di}|${layerJ - 1}|${k0 + dk}`)) supportedStuds++;
                  else unsupportedStuds++;
                }
              }
              if (!fits || (options.requireBridge && (!supportedStuds || !unsupportedStuds))) continue;
              const color = footprintColor(i0, k0, spanI, spanK, target.colorId);
              if (!color || (
                options.exactVisibleColor !== undefined &&
                color.colorId !== options.exactVisibleColor
              )) continue;
              const wanted = COLORS.find((candidate) => candidate.id === color.colorId)!;
              const resolved = stockedColorFor(brick, wanted, stockUsed);
              if (!resolved || (color.hasVisibleColor && resolved.substituted)) continue;
              choices.push({ brick, i0, k0, resolved, spanI, spanK, supportedStuds, unsupportedStuds });
            }
          }
        }
      }
      return choices;
    };

    // Some catalog colours deliberately have no 1 x 1 element. Reserve a
    // compatible larger part for those visible cells before a greedy sweep can
    // consume the hidden stud that makes the exact colour physically possible.
    const oneByOne = BRICKS.find((brick) => brick.w === 1 && brick.l === 1);
    while (oneByOne) {
      let constrained: LayerChoice[] | null = null;
      for (const targetKey of keys) {
        if (used.has(targetKey)) continue;
        const sourceKey = `${targetKey.split('|')[0]}|${layerJ}|${targetKey.split('|')[1]}`;
        if (!originalExteriorKeys.has(sourceKey)) continue;
        const target = layer.get(targetKey)!;
        if (oneByOne.elements[String(target.colorId)]) continue;
        const [targetI, targetK] = targetKey.split('|').map(Number) as [number, number];
        const choices = choicesContaining(targetI, targetK, { exactVisibleColor: target.colorId });
        if (!choices.length) continue; // an unavoidable catalog substitution
        if (!constrained || choices.length < constrained.length) constrained = choices;
      }
      if (!constrained) break;
      constrained.sort((a, b) =>
        Number(b.supportedStuds > 0 && b.unsupportedStuds > 0) -
          Number(a.supportedStuds > 0 && a.unsupportedStuds > 0) ||
        b.spanI * b.spanK - a.spanI * a.spanK ||
        a.k0 - b.k0 || a.i0 - b.i0 || a.brick.part.localeCompare(b.brick.part),
      );
      const choice = constrained[0]!;
      commitBrick(choice.brick, choice.resolved, choice.i0, choice.k0, choice.spanI, choice.spanK);
    }

    // Anchor overhang runs before the ordinary area-first tiling. A greedy
    // rectangle sweep can otherwise leave a row of perfectly valid voxels as
    // separate 1 x 1 pieces beside the body, even though one longer catalog
    // brick could span from that detail onto supported studs. This pre-pass
    // keeps every visible cell and colour identical; it only chooses a more
    // buildable partition of the same occupied layer.
    if (layerJ > firstSourceLayer) {
      while (true) {
        let constrainedChoices: LayerChoice[] | null = null;
        for (const targetKey of keys) {
          if (used.has(targetKey)) continue;
          const [targetI, targetK] = targetKey.split('|').map(Number) as [number, number];
          if (sourceCellKeys.has(`${targetI}|${layerJ - 1}|${targetK}`)) continue;
          const choices = choicesContaining(targetI, targetK, { requireBridge: true });
          if (
            choices.length &&
            (!constrainedChoices || choices.length < constrainedChoices.length)
          ) {
            constrainedChoices = choices;
          }
        }
        const choices = constrainedChoices as LayerChoice[] | null;
        if (!choices) break;
        choices.sort((a, b) =>
          b.unsupportedStuds - a.unsupportedStuds ||
          b.spanI * b.spanK - a.spanI * a.spanK ||
          a.k0 - b.k0 ||
          a.i0 - b.i0 ||
          a.brick.part.localeCompare(b.brick.part),
        );
        const choice = choices[0] ?? null;
        if (!choice) break;
        commitBrick(choice.brick, choice.resolved, choice.i0, choice.k0, choice.spanI, choice.spanK);
      }
    }

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
            commitBrick(brick, resolved, i0, k0, l!, w!);
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

  // Tie every vertically disconnected packing island back into the main
  // sculpture without adding a stand, glue, or geometry outside the approved
  // voxels. Two side-touching rectangular pieces are merged into the matching
  // larger catalog brick whenever their combined footprint is itself a real
  // rectangle. Repeating this joins tails, ears and hollow shell sections that
  // an area-first tiler can otherwise leave unattached.
  const structuralOneByOne = BRICKS.find((brick) => brick.w === 1 && brick.l === 1);
  const structuralOneByTwo = BRICKS.find(
    (brick) => brick.studs === 2 && Math.min(brick.w, brick.l) === 1,
  );
  if (structuralOneByOne && structuralOneByTwo && placements.length) {
    const exteriorKeys = originalExteriorKeys;
    const placementCells = (placement: BrickPlacement) => {
      const cells: Array<{ i: number; j: number; k: number; key: string }> = [];
      for (let di = 0; di < placement.spanI; di++) {
        for (let dk = 0; dk < placement.spanK; dk++) {
          const i = placement.i + di;
          const k = placement.k + dk;
          cells.push({ i, j: placement.j, k, key: `${i}|${placement.j}|${k}` });
        }
      }
      return cells;
    };
    const disconnectedComponentCount = (candidatePlacements: BrickPlacement[]) => {
      if (!candidatePlacements.length) return 0;
      const parent = candidatePlacements.map((_, index) => index);
      const find = (index: number): number => {
        let root = index;
        while (parent[root] !== root) root = parent[root]!;
        while (parent[index] !== index) {
          const next = parent[index]!;
          parent[index] = root;
          index = next;
        }
        return root;
      };
      const union = (a: number, b: number) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
      };
      const coverage = new Map<string, number>();
      let minLayer = Number.POSITIVE_INFINITY;
      candidatePlacements.forEach((placement, index) => {
        minLayer = Math.min(minLayer, placement.j);
        for (const cell of placementCells(placement)) coverage.set(cell.key, index);
      });
      candidatePlacements.forEach((placement, index) => {
        for (const cell of placementCells(placement)) {
          const below = coverage.get(`${cell.i}|${cell.j - 1}|${cell.k}`);
          const above = coverage.get(`${cell.i}|${cell.j + 1}|${cell.k}`);
          if (below !== undefined) union(index, below);
          if (above !== undefined) union(index, above);
        }
      });
      const baseRoots = new Set(
        candidatePlacements
          .map((placement, index) => placement.j === minLayer ? find(index) : -1)
          .filter((root) => root >= 0),
      );
      return new Set(
        candidatePlacements
          .map((_, index) => find(index))
          .filter((root) => !baseRoots.has(root)),
      ).size;
    };
    const releasePlacement = (placement: BrickPlacement) => {
      const key = `${placement.part}|${placement.colorId}`;
      const remaining = (tally.get(key) ?? 0) - 1;
      if (remaining > 0) tally.set(key, remaining);
      else tally.delete(key);
      const stockRemaining = (stockUsed.get(key) ?? 0) - 1;
      if (stockRemaining > 0) stockUsed.set(key, stockRemaining);
      else stockUsed.delete(key);
    };
    const structuralColorFor = (brick: CatalogBrick, wantedId: number) => {
      const wanted = COLORS.find((color) => color.id === wantedId) ?? COLORS[0]!;
      if (!brick.elements[String(wanted.id)]) return null;
      const available = brick.inventory?.[String(wanted.id)];
      if (available !== undefined && (stockUsed.get(`${brick.part}|${wanted.id}`) ?? 0) >= available) {
        return null;
      }
      // Structural rewrites must never recolour already-approved cells. If an
      // exact-colour connector is unavailable, leave the original packing and
      // let the assembly validator reject it instead of hiding a substitution.
      return { color: wanted, substituted: false };
    };
    const structuralColorForCells = (
      cells: Array<{ key: string }>,
      fallbackColorId: number,
    ): number | null => {
      const visibleColors = new Set<number>();
      for (const cell of cells) {
        if (!exteriorKeys.has(cell.key)) continue;
        const source = sourceCellByKey.get(cell.key);
        if (source) visibleColors.add(colorOf(source));
      }
      // A physical brick has one colour. Crossing source-colour boundaries is
      // allowed only behind the visible shell; every exposed stud must retain
      // the exact catalog colour approved in the preview.
      if (visibleColors.size > 1) return null;
      return visibleColors.values().next().value ?? fallbackColorId;
    };
    const addStructuralPlacement = (
      brick: CatalogBrick,
      wantedColorId: number,
      i: number,
      j: number,
      k: number,
      spanI: number,
      spanK: number,
    ) => {
      const resolved = structuralColorFor(brick, wantedColorId);
      if (!resolved) return false;
      const key = `${brick.part}|${resolved.color.id}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      reserveStock(brick.part, resolved.color.id);
      if (resolved.substituted) substitutedKeys.add(key);
      placements.push({
        colorId: resolved.color.id,
        i,
        j,
        k,
        part: brick.part,
        shape: 'brick',
        spanI,
        spanK,
      });
      return true;
    };

    interface StructuralCell {
      colorId: number;
      i: number;
      j: number;
      k: number;
      key: string;
    }

    interface StructuralPlacementSpec {
      brick: CatalogBrick;
      colorId: number;
      i: number;
      j: number;
      k: number;
      spanI: number;
      spanK: number;
    }

    const structuralBricks = [...BRICKS].sort((a, b) =>
      b.studs - a.studs || b.l - a.l || b.w - a.w || a.part.localeCompare(b.part),
    );

    /**
     * Repack cells released by a local structural tie. Keeping their largest
     * remaining rectangles intact matters: reducing every leftover stud to a
     * 1 x 1 can simply move the detached seam to the other end of the piece.
     */
    const packStructuralCells = (cells: StructuralCell[]): StructuralPlacementSpec[] | null => {
      const all = new Map(cells.map((cell) => [cell.key, cell]));
      const failed = new Set<string>();

      const search = (remaining: Map<string, StructuralCell>): StructuralPlacementSpec[] | null => {
        if (!remaining.size) return [];
        const signature = [...remaining.keys()].sort().join(';');
        if (failed.has(signature)) return null;
        const anchor = [...remaining.values()].sort((a, b) =>
          a.j - b.j || a.k - b.k || a.i - b.i,
        )[0]!;
        const options: StructuralPlacementSpec[] = [];

        for (const brick of structuralBricks) {
          const orientations = brick.w === brick.l
            ? [[brick.l, brick.w] as const]
            : [[brick.l, brick.w] as const, [brick.w, brick.l] as const];
          for (const [spanI, spanK] of orientations) {
            for (let anchorDi = 0; anchorDi < spanI; anchorDi++) {
              for (let anchorDk = 0; anchorDk < spanK; anchorDk++) {
                const i = anchor.i - anchorDi;
                const k = anchor.k - anchorDk;
                const covered: StructuralCell[] = [];
                let fits = true;
                for (let di = 0; di < spanI && fits; di++) {
                  for (let dk = 0; dk < spanK; dk++) {
                    const cell = remaining.get(`${i + di}|${anchor.j}|${k + dk}`);
                    if (!cell) {
                      fits = false;
                      break;
                    }
                    covered.push(cell);
                  }
                }
                if (!fits) continue;
                const colorId = structuralColorForCells(covered, anchor.colorId);
                if (colorId === null || structuralColorFor(brick, colorId) === null) continue;
                options.push({ brick, colorId, i, j: anchor.j, k, spanI, spanK });
              }
            }
          }
        }

        options.sort((a, b) =>
          b.spanI * b.spanK - a.spanI * a.spanK ||
          a.k - b.k || a.i - b.i || a.brick.part.localeCompare(b.brick.part),
        );
        for (const option of options) {
          const next = new Map(remaining);
          for (let di = 0; di < option.spanI; di++) {
            for (let dk = 0; dk < option.spanK; dk++) {
              next.delete(`${option.i + di}|${option.j}|${option.k + dk}`);
            }
          }
          const tail = search(next);
          if (tail) return [option, ...tail];
        }
        failed.add(signature);
        return null;
      };

      return search(all);
    };

    const maxTiePasses = placements.length;
    for (let pass = 0; pass < maxTiePasses; pass++) {
      const parent = placements.map((_, index) => index);
      const find = (index: number): number => {
        let root = index;
        while (parent[root] !== root) root = parent[root]!;
        while (parent[index] !== index) {
          const next = parent[index]!;
          parent[index] = root;
          index = next;
        }
        return root;
      };
      const union = (a: number, b: number) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
      };
      const coverage = new Map<string, number>();
      let minLayer = Number.POSITIVE_INFINITY;
      placements.forEach((placement, index) => {
        minLayer = Math.min(minLayer, placement.j);
        for (const cell of placementCells(placement)) coverage.set(cell.key, index);
      });
      placements.forEach((placement, index) => {
        for (const cell of placementCells(placement)) {
          const below = coverage.get(`${cell.i}|${cell.j - 1}|${cell.k}`);
          const above = coverage.get(`${cell.i}|${cell.j + 1}|${cell.k}`);
          if (below !== undefined) union(index, below);
          if (above !== undefined) union(index, above);
        }
      });
      const baseRoots = new Set(
        placements
          .map((placement, index) => placement.j === minLayer ? find(index) : -1)
          .filter((root) => root >= 0),
      );
      const disconnected = new Set(
        placements
          .map((_, index) => index)
          .filter((index) => !baseRoots.has(find(index))),
      );
      if (!disconnected.size) break;

      let tie: {
        bridgeBrick: CatalogBrick;
        colorId: number;
        connectedIndex: number;
        disconnectedIndex: number;
        i: number;
        j: number;
        k: number;
        score: number;
        spanI: number;
        spanK: number;
      } | null = null;
      for (const disconnectedIndex of disconnected) {
        const detached = placements[disconnectedIndex]!;
        for (const detachedCell of placementCells(detached)) {
          for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const neighbourKey = `${detachedCell.i + di}|${detachedCell.j}|${detachedCell.k + dk}`;
            const connectedIndex = coverage.get(neighbourKey);
            if (
              connectedIndex === undefined ||
              connectedIndex === disconnectedIndex ||
              find(connectedIndex) === find(disconnectedIndex)
            ) continue;
            const connected = placements[connectedIndex]!;
            if (
              connected.shape === 'slope' ||
              detached.shape === 'slope'
            ) continue;
            const combinedCells = [...placementCells(detached), ...placementCells(connected)];
            const bridgeColorId = structuralColorForCells(combinedCells, detached.colorId);
            if (bridgeColorId === null) continue;
            const minI = Math.min(...combinedCells.map((cell) => cell.i));
            const maxI = Math.max(...combinedCells.map((cell) => cell.i));
            const minK = Math.min(...combinedCells.map((cell) => cell.k));
            const maxK = Math.max(...combinedCells.map((cell) => cell.k));
            const spanI = maxI - minI + 1;
            const spanK = maxK - minK + 1;
            const uniqueCells = new Set(combinedCells.map((cell) => cell.key));
            if (uniqueCells.size !== spanI * spanK) continue;
            const bridgeBrick = BRICKS.find((brick) =>
              ((brick.l === spanI && brick.w === spanK) ||
              (brick.w === spanI && brick.l === spanK)) &&
              structuralColorFor(brick, bridgeColorId) !== null,
            );
            if (!bridgeBrick) continue;
            const basePenalty = disconnected.has(connectedIndex) ? 10_000_000 : 0;
            const visiblePenalty = exteriorKeys.has(neighbourKey) ? 100_000 : 0;
            const areaPenalty = uniqueCells.size * 100;
            const score = basePenalty + visiblePenalty + areaPenalty;
            if (!tie || score < tie.score) {
              tie = {
                bridgeBrick,
                colorId: bridgeColorId,
                connectedIndex,
                disconnectedIndex,
                i: minI,
                j: detached.j,
                k: minK,
                score,
                spanI,
                spanK,
              };
            }
          }
        }
      }
      const selectedTie = tie as typeof tie;
      if (selectedTie) {
        const detached = placements[selectedTie.disconnectedIndex]!;
        const connected = placements[selectedTie.connectedIndex]!;
        releasePlacement(detached);
        releasePlacement(connected);
        const remove = new Set([selectedTie.disconnectedIndex, selectedTie.connectedIndex]);
        const kept = placements.filter((_, index) => !remove.has(index));
        placements.splice(0, placements.length, ...kept);
        addStructuralPlacement(
          selectedTie.bridgeBrick,
          selectedTie.colorId,
          selectedTie.i,
          selectedTie.j,
          selectedTie.k,
          selectedTie.spanI,
          selectedTie.spanK,
        );
        continue;
      }

      // A non-rectangular boundary cannot merge into one larger brick. Try a
      // local 1 x 2 tie and split only the two touched pieces, but accept that
      // rewrite solely when a complete graph simulation proves it reduces the
      // number of detached components. This guard prevents a connector from
      // fixing one stud while accidentally marooning the rest of a long part.
      const currentComponentCount = new Set(
        [...disconnected].map((index) => find(index)),
      ).size;
      const splitCandidates: Array<{
        colorId: number;
        connectedCell: { i: number; j: number; k: number; key: string };
        connectedIndex: number;
        detachedCell: { i: number; j: number; k: number; key: string };
        detachedIndex: number;
        score: number;
      }> = [];
      const seenBoundaries = new Set<string>();
      for (const detachedIndex of disconnected) {
        const detached = placements[detachedIndex]!;
        for (const detachedCell of placementCells(detached)) {
          for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const neighbourKey = `${detachedCell.i + di}|${detachedCell.j}|${detachedCell.k + dk}`;
            const connectedIndex = coverage.get(neighbourKey);
            if (
              connectedIndex === undefined ||
              find(connectedIndex) === find(detachedIndex)
            ) continue;
            const boundaryKey = `${detachedIndex}|${connectedIndex}|${detachedCell.key}|${neighbourKey}`;
            if (seenBoundaries.has(boundaryKey)) continue;
            seenBoundaries.add(boundaryKey);
            const connected = placements[connectedIndex]!;
            const connectedCell = {
              i: detachedCell.i + di,
              j: detachedCell.j,
              k: detachedCell.k + dk,
              key: neighbourKey,
            };
            const bridgeColorId = structuralColorForCells(
              [detachedCell, connectedCell],
              detached.colorId,
            );
            if (
              connected.shape === 'slope' ||
              detached.shape === 'slope' ||
              bridgeColorId === null ||
              structuralColorFor(structuralOneByTwo, bridgeColorId) === null
            ) continue;
            splitCandidates.push({
              colorId: bridgeColorId,
              connectedCell,
              connectedIndex,
              detachedCell,
              detachedIndex,
              score:
                (disconnected.has(connectedIndex) ? 10_000_000 : 0) +
                (exteriorKeys.has(neighbourKey) ? 100_000 : 0) +
                (connected.spanI * connected.spanK + detached.spanI * detached.spanK) * 100,
            });
          }
        }
      }
      splitCandidates.sort((a, b) => a.score - b.score);
      let repaired = false;
      for (const candidate of splitCandidates.slice(0, 200)) {
        const detached = placements[candidate.detachedIndex]!;
        const connected = placements[candidate.connectedIndex]!;
        const removed = new Set([candidate.detachedIndex, candidate.connectedIndex]);
        const kept = placements.filter((_, index) => !removed.has(index));
        const bridgeKeys = new Set([candidate.detachedCell.key, candidate.connectedCell.key]);
        const remainder = [
          ...placementCells(detached),
          ...placementCells(connected),
        ].filter((cell) => !bridgeKeys.has(cell.key)).map((cell) => ({
          ...cell,
          colorId: sourceCellByKey.get(cell.key)
            ? colorOf(sourceCellByKey.get(cell.key)!)
            : detached.colorId,
        }));
        const remainderSpecs = packStructuralCells(remainder);
        if (!remainderSpecs) continue;
        const spanI = candidate.detachedCell.i === candidate.connectedCell.i ? 1 : 2;
        const spanK = spanI === 1 ? 2 : 1;
        const trial: BrickPlacement[] = [
          ...kept,
          {
            colorId: candidate.colorId,
            i: Math.min(candidate.detachedCell.i, candidate.connectedCell.i),
            j: candidate.detachedCell.j,
            k: Math.min(candidate.detachedCell.k, candidate.connectedCell.k),
            part: structuralOneByTwo.part,
            shape: 'brick',
            spanI,
            spanK,
          },
          ...remainderSpecs.map((spec) => ({
            colorId: spec.colorId,
            i: spec.i,
            j: spec.j,
            k: spec.k,
            part: spec.brick.part,
            shape: 'brick' as const,
            spanI: spec.spanI,
            spanK: spec.spanK,
          })),
        ];
        // A colour-safe bridge can move a seam before the next pass removes
        // the detached remainder. Accept equal-component rewrites as long as
        // they preserve exact coverage; the bounded outer loop prevents a
        // pathological model from cycling forever.
        if (disconnectedComponentCount(trial) > currentComponentCount) continue;

        releasePlacement(detached);
        releasePlacement(connected);
        placements.splice(0, placements.length, ...kept);
        addStructuralPlacement(
          structuralOneByTwo,
          candidate.colorId,
          Math.min(candidate.detachedCell.i, candidate.connectedCell.i),
          candidate.detachedCell.j,
          Math.min(candidate.detachedCell.k, candidate.connectedCell.k),
          spanI,
          spanK,
        );
        for (const spec of remainderSpecs) {
          addStructuralPlacement(
            spec.brick,
            spec.colorId,
            spec.i,
            spec.j,
            spec.k,
            spec.spanI,
            spec.spanK,
          );
        }
        repaired = true;
        break;
      }
      if (!repaired) break;
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
