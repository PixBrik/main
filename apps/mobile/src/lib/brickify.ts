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
  shape: 'brick' | 'slope' | 'slopeCurved' | 'slopeInverted' | 'round';
  /** Slope descent direction, indexed like FACE_DIRECTIONS. */
  facing?: number;
}

/** Shapes that carry a descent/overhang direction. */
export const FACED_SHAPES: ReadonlySet<BrickPlacement['shape']> = new Set([
  'slope',
  'slopeCurved',
  'slopeInverted',
]);

/**
 * One real wheel: an axle through a technic brick in the body, a wheel on
 * the axle stub, a tire on the wheel. Lives OUTSIDE the stud grid, so it is
 * carried separately from placements — the assembly plan, hollow audits and
 * guide wire format stay untouched.
 */
export interface WheelAccessory {
  i: number;
  j: number;
  k: number;
  side: 1 | -1;
  axlePart: string;
  wheelPart: string;
  tirePart: string;
  holderPart: string;
}

/**
 * A studless tile capping the top of grid layer `j` (1/3 brick tall, sits on
 * the studs of the cell below). Kept outside `placements` so the assembly
 * plan's cell-tiling invariants stay untouched.
 */
export interface TileFinish {
  part: string;
  colorId: number;
  i: number;
  j: number;
  k: number;
  spanI: number;
  spanK: number;
}

/** One physical plate of the terrace smoothing, at 1/3-brick sub-layer `level`. */
export interface TerraceStep {
  part: string;
  colorId: number;
  i: number;
  /** Brick layer whose top face the stack sits on. */
  j: number;
  k: number;
  spanI: number;
  spanK: number;
  /** Sub-layer within the stack: 0 rests on the surface, 1 on top of it. */
  level: number;
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
  /** Real wheel assemblies for detected vehicles (not persisted in guides). */
  accessories?: WheelAccessory[];
  /** Axles, wheels, tires and holder bricks — priced separately from lines. */
  accessoryLines?: BomLine[];
  accessoryTotalEur?: number;
  /** Studless tile skin over flat top surfaces — the display-model finish. */
  finish?: TileFinish[];
  finishLines?: BomLine[];
  finishTotalEur?: number;
  /** Plate terracing that softens single-brick steps on gentle slopes. */
  terrace?: TerraceStep[];
  terraceLines?: BomLine[];
  terraceTotalEur?: number;
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

interface CatalogSculptPart extends CatalogBrick {
  kind: 'slopeCurved' | 'slopeInverted' | 'round';
  heightBricks: number;
}

/**
 * Curved, inverted and round parts used by the sculpt pass. All of them fit
 * a single build layer, so every substitution preserves the placement-tiles-
 * cells invariant the assembly plan and hollow audits rely on.
 */
const SCULPT_PARTS: CatalogSculptPart[] = (
  (catalog as unknown as { sculpt?: CatalogSculptPart[] }).sculpt ?? []
);

/** Studless tiles for the finishing skin, largest footprint first. */
const TILE_PARTS: CatalogBrick[] = (
  (catalog as unknown as { tiles?: CatalogBrick[] }).tiles ?? []
).slice().sort((a, b) => b.studs - a.studs);

/** Rectangular plates (1/3-brick height) for terrace smoothing, longest first. */
const PLATE_PARTS: CatalogBrick[] = (
  (catalog as unknown as { plates?: CatalogBrick[] }).plates ?? []
).slice().sort((a, b) => b.studs - a.studs);

/** Public, read-only geometry guard used by shared-guide validation. */
export function catalogPartFootprint(part: string): CatalogPartFootprint | null {
  const brick = BRICKS.find((candidate) => candidate.part === part);
  if (brick) return { l: brick.l, shape: 'brick', w: brick.w };
  const slope = SLOPE_PARTS.find((candidate) => candidate.part === part);
  if (slope) return { l: slope.l, shape: 'slope', w: slope.w };
  const sculpt = SCULPT_PARTS.find((candidate) => candidate.part === part);
  return sculpt ? { l: sculpt.l, shape: sculpt.kind, w: sculpt.w } : null;
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

/**
 * Rendering technique — how the engine interprets the same voxel model:
 * - 'sculpted' (default): slopes, curved parts and a studless tile skin on
 *   flat tops — the realistic display-model formula.
 * - 'mosaic': rectangular bricks only, the deliberate retro voxel look
 *   (wheel assemblies still apply — they are accessories, not shaping).
 * - 'studless': sculpted plus aggressive tiling — flat AND gently tilted
 *   surfaces get tile skins, minimising visible studs.
 * - 'hd': plate-resolution build — expects a plate-grid voxel model (layers
 *   1/3 brick tall) and packs entirely from plates, tripling the vertical
 *   resolution of every silhouette. Renders with an 8-LDU layer height.
 */
export type BrickTechnique = 'sculpted' | 'mosaic' | 'studless' | 'hd';

export interface BrickifyOptions {
  /**
   * Hollow build: retain the complete exterior plus a bonded base and an
   * internal support lattice. Relief panels and already-open meshes are
   * effectively all exterior, so hollow ≈ full for those models.
   */
  hollow?: boolean;
  /** Skip the sculpt substitution pass (plain rectangular vocabulary only). */
  noSculpt?: boolean;
  /** Shaping profile; defaults to 'sculpted'. */
  technique?: BrickTechnique;
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
  // Stage beacons for performance triage: inert unless explicitly enabled
  // (node: PACK_DEBUG=1; browser: window.__PACK_DEBUG = true).
  const packDebug = (globalThis as { __PACK_DEBUG?: boolean }).__PACK_DEBUG === true;
  const packT0 = packDebug ? Date.now() : 0;
  const stamp = (message: string): void => {
    // eslint-disable-next-line no-console -- opt-in triage output
    if (packDebug) console.log('[pack]', message, `${((Date.now() - packT0) / 1000).toFixed(1)}s`);
  };

  const sourceCells = options.hollow ? reinforcedHollowCells(model) : model.cells;
  const technique = options.technique ?? 'sculpted';
  // Shaping = every pass that swaps rectangles for slopes/curves/tiles.
  // 'hd' ships rectangles too for now: the plate grid itself is the
  // smoothing, and every shaped part is calibrated for brick layers.
  const shaping = technique !== 'mosaic' && technique !== 'hd' && !options.noSculpt;
  // The packing vocabulary: bricks normally, plates on a plate grid.
  const PACK_BRICKS = technique === 'hd' ? PLATE_PARTS : BRICKS;
  stamp(`cells ready ${sourceCells.length}`);

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
  if (SLOPE_PARTS.length && shaping) {
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

  stamp(`slopes done, ${placements.length} placements`);

  const sourceCellByKey = new Map(sourceCells.map((cell) => [`${cell.i}|${cell.j}|${cell.k}`, cell]));

  // ---- curvature-first surface pass ----
  // Substituting curves AFTER greedy rectangle packing can never produce
  // curved coverage: the packer eats every surface with 2×10s first, leaving
  // only stray 1×1s to convert. So genuinely tilted surface cells (measured
  // source-mesh normals) are claimed for curved parts BEFORE the rectangle
  // packer runs — crowns, then curved runs along the descent, then single
  // caps — and rectangles fill only what remains.
  if (SCULPT_PARTS.length && shaping) {
    const CURVE_CALIBRATED = new Set(['15068', '37352', '50950', '54200', '61678', '7126', '83473']);
    const curveFor = (kind: 'slopeCurved', w: number, l: number, colorId: number): CatalogSculptPart | undefined => {
      let best: CatalogSculptPart | undefined;
      for (const part of SCULPT_PARTS) {
        if (part.kind !== kind || !CURVE_CALIBRATED.has(part.part)) continue;
        if (!((part.w === w && part.l === l) || (part.w === l && part.l === w))) continue;
        if (!part.elements[String(colorId)]) continue;
        if (!best || (part.heightBricks ?? 1) > (best.heightBricks ?? 1)) best = part;
      }
      return best;
    };
    const cellTilt = (cell: VoxelCell | undefined): number | null => {
      const surf = cell?.surf;
      if (!surf) return null;
      const ny = surf[1];
      if (ny < 0.55 || ny > 0.965) return null;
      return Math.abs(surf[0]) >= Math.abs(surf[2]) ? (surf[0] > 0 ? 3 : 4) : (surf[2] > 0 ? 1 : 2);
    };
    const free = (key: string) => !consumed.has(key);
    const keyOf = (i: number, j: number, k: number) => `${i}|${j}|${k}`;
    const openAbove = (i: number, j: number, k: number) => !sourceCellByKey.has(keyOf(i, j + 1, k));
    const supported = (i: number, j: number, k: number) =>
      j === 0 || sourceCellByKey.has(keyOf(i, j - 1, k));
    const commitCurve = (
      part: CatalogSculptPart,
      colorId: number,
      i0: number,
      j0: number,
      k0: number,
      spanI: number,
      spanK: number,
      facing: number,
      cellKeys: string[],
    ) => {
      for (const cellKey of cellKeys) consumed.add(cellKey);
      const tallyKey = `${part.part}|${colorId}`;
      tally.set(tallyKey, (tally.get(tallyKey) ?? 0) + 1);
      reserveStock(part.part, colorId);
      placements.push({
        colorId,
        facing,
        i: i0,
        j: j0,
        k: k0,
        part: part.part,
        shape: part.kind,
        spanI,
        spanK,
      });
    };

    // Pass 1: 2×2 curved crowns on coherent tilted patches.
    for (const cell of sourceCells) {
      const { i, j, k } = cell;
      const anchorKey = keyOf(i, j, k);
      if (!free(anchorKey) || !openAbove(i, j, k)) continue;
      const facing = cellTilt(cell);
      if (facing === null) continue;
      const quad = [[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]] as const;
      let ok = true;
      const keys: string[] = [];
      let colorId = -1;
      for (const [ci, ck] of quad) {
        const qKey = keyOf(ci, j, ck);
        const qCell = sourceCellByKey.get(qKey);
        if (!qCell || !free(qKey) || !openAbove(ci, j, ck) || !supported(ci, j, ck) || cellTilt(qCell) !== facing || (colorId >= 0 && colorOf(qCell) !== colorId)) {
          ok = false;
          break;
        }
        keys.push(qKey);
        if (colorId < 0) colorId = colorOf(qCell);
      }
      if (!ok) continue;
      const part = curveFor('slopeCurved', 2, 2, colorId);
      if (part) commitCurve(part, colorId, i, j, k, 2, 2, facing, keys);
    }

    // Pass 2: curved runs 4→3→2 along the descent direction.
    for (const runLength of [4, 3, 2]) {
      for (const cell of sourceCells) {
        const { i, j, k } = cell;
        if (!free(keyOf(i, j, k)) || !openAbove(i, j, k)) continue;
        const facing = cellTilt(cell);
        if (facing === null) continue;
        const d = FACE_DIRECTIONS[facing]!;
        const keys: string[] = [];
        let ok = true;
        let colorId = -1;
        for (let step = 0; step < runLength; step++) {
          const ci = i - d.x * step;
          const ck = k - d.z * step;
          const cKey = keyOf(ci, j, ck);
          const cCell = sourceCellByKey.get(cKey);
          if (!cCell || !free(cKey) || !openAbove(ci, j, ck) || !supported(ci, j, ck) || cellTilt(cCell) !== facing || (colorId >= 0 && colorOf(cCell) !== colorId)) {
            ok = false;
            break;
          }
          keys.push(cKey);
          if (colorId < 0) colorId = colorOf(cCell);
        }
        if (!ok) continue;
        const spanI = d.x !== 0 ? runLength : 1;
        const spanK = d.z !== 0 ? runLength : 1;
        const part = curveFor('slopeCurved', 1, runLength, colorId);
        if (!part) continue;
        commitCurve(
          part, colorId,
          Math.min(i, i - d.x * (runLength - 1)), j, Math.min(k, k - d.z * (runLength - 1)),
          spanI, spanK, facing, keys,
        );
      }
    }

    // Pass 3: lone tilted cells become cheese caps when they have a tilted
    // or curved neighbour — isolated bumps stay rectangular to avoid stipple.
    for (const cell of sourceCells) {
      const { i, j, k } = cell;
      const cellKey = keyOf(i, j, k);
      if (!free(cellKey) || !openAbove(i, j, k) || !supported(i, j, k)) continue;
      const facing = cellTilt(cell);
      if (facing === null) continue;
      let hasMate = false;
      for (const face of [1, 2, 3, 4] as const) {
        const d = FACE_DIRECTIONS[face]!;
        const nKey = keyOf(i + d.x, j, k + d.z);
        const nCell = sourceCellByKey.get(nKey);
        if ((nCell && cellTilt(nCell) !== null) || consumed.has(nKey)) {
          hasMate = true;
          break;
        }
      }
      if (!hasMate) continue;
      const colorId = colorOf(cell);
      const part = curveFor('slopeCurved', 1, 1, colorId);
      if (part) commitCurve(part, colorId, i, j, k, 1, 1, facing, [cellKey]);
    }
    stamp(`curvature-first done, ${placements.length} placements`);
  }

  // ---- rectangle packing for everything not consumed by slopes ----
  const layers = new Map<number, Map<string, { cell: VoxelCell; colorId: number }>>();
  const sourceCellKeys = new Set(sourceCells.map((cell) => `${cell.i}|${cell.j}|${cell.k}`));
  const originalExteriorKeys = new Set(model.shell.map((cell) => `${cell.i}|${cell.j}|${cell.k}`));
  // A plain loop, not Math.min(...spread): spreading 100k+ cells as call
  // arguments overflows the stack on dense high-resolution builds.
  let firstSourceLayer = 0;
  if (sourceCells.length) {
    firstSourceLayer = Infinity;
    for (const cell of sourceCells) {
      if (cell.j < firstSourceLayer) firstSourceLayer = cell.j;
    }
  }
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
      for (const brick of PACK_BRICKS) {
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
    const oneByOne = PACK_BRICKS.find((brick) => brick.w === 1 && brick.l === 1);
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
        for (const brick of PACK_BRICKS) {
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
  const structuralOneByOne = PACK_BRICKS.find((brick) => brick.w === 1 && brick.l === 1);
  const structuralOneByTwo = PACK_BRICKS.find(
    (brick) => brick.studs === 2 && Math.min(brick.w, brick.l) === 1,
  );
  stamp(`rect packing done, ${placements.length} placements`);

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
    const structuralColorCandidatesForCells = (
      cells: Array<{ key: string }>,
      fallbackColorId: number,
    ): number[] => {
      const visibleColors: number[] = [];
      for (const cell of cells) {
        if (!exteriorKeys.has(cell.key)) continue;
        const source = sourceCellByKey.get(cell.key);
        if (source) {
          const colorId = colorOf(source);
          if (!visibleColors.includes(colorId)) visibleColors.push(colorId);
        }
      }
      // A textured mesh can place a one-stud feature beside the supported
      // body with no vertical clutch below it. When that seam is the only
      // reason the exact packing is disconnected, one real bridge brick must
      // use one of the source colours. Keep the detached feature colour and
      // let the exact packed 360/BOM show the bounded one-stud adjustment; no
      // geometry is added or removed, and the rewrite is accepted below only
      // when graph simulation proves that it improves connectivity.
      const ordered = visibleColors.length === 1
        ? [visibleColors[0]!, fallbackColorId]
        : [fallbackColorId, ...visibleColors];
      return [...new Set(ordered)];
    };
    const structuralColorForCells = (
      cells: Array<{ key: string }>,
      fallbackColorId: number,
      brick?: CatalogBrick,
    ): number | null => {
      const candidates = structuralColorCandidatesForCells(cells, fallbackColorId);
      return candidates.find((colorId) => !brick || structuralColorFor(brick, colorId) !== null) ?? null;
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

    const structuralBricks = [...PACK_BRICKS].sort((a, b) =>
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
                const colorId = structuralColorForCells(covered, anchor.colorId, brick);
                if (colorId === null) continue;
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

    const packingSignature = (candidatePlacements: BrickPlacement[]) =>
      candidatePlacements
        .map((placement) => [
          placement.part,
          placement.colorId,
          placement.i,
          placement.j,
          placement.k,
          placement.spanI,
          placement.spanK,
        ].join('|'))
        .sort()
        .join(';');
    const seenStructuralPackings = new Set([packingSignature(placements)]);
    // Each pass costs a full rebuild over every placement, so passes must be
    // bounded by convergence, not by count: `placements.length` passes on a
    // 20k-placement hollow build is O(N²) and runs for hours. Ties converge
    // within a few dozen passes on every real model; the cap only exists so
    // a pathological merge chain degrades to "some ties left" instead of a
    // frozen build. The assembly gate still verifies support independently.
    const maxTiePasses = Math.min(placements.length, 64);
    for (let pass = 0; pass < maxTiePasses; pass++) {
      if (pass % 4 === 0) stamp(`tie pass ${pass}/${maxTiePasses}`);
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
              connected.shape !== 'brick' ||
              detached.shape !== 'brick'
            ) continue;
            const combinedCells = [...placementCells(detached), ...placementCells(connected)];
            const minI = Math.min(...combinedCells.map((cell) => cell.i));
            const maxI = Math.max(...combinedCells.map((cell) => cell.i));
            const minK = Math.min(...combinedCells.map((cell) => cell.k));
            const maxK = Math.max(...combinedCells.map((cell) => cell.k));
            const spanI = maxI - minI + 1;
            const spanK = maxK - minK + 1;
            const uniqueCells = new Set(combinedCells.map((cell) => cell.key));
            if (uniqueCells.size !== spanI * spanK) continue;
            let bridgeBrick: CatalogBrick | undefined;
            let bridgeColorId: number | null = null;
            for (const colorId of structuralColorCandidatesForCells(combinedCells, detached.colorId)) {
              bridgeBrick = PACK_BRICKS.find((brick) =>
                ((brick.l === spanI && brick.w === spanK) ||
                (brick.w === spanI && brick.l === spanK)) &&
                structuralColorFor(brick, colorId) !== null,
              );
              if (bridgeBrick) {
                bridgeColorId = colorId;
                break;
              }
            }
            if (!bridgeBrick || bridgeColorId === null) continue;
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
        seenStructuralPackings.add(packingSignature(placements));
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
              structuralOneByTwo,
            );
            if (
              connected.shape !== 'brick' ||
              detached.shape !== 'brick' ||
              bridgeColorId === null
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
      let selectedRepair: {
        candidate: (typeof splitCandidates)[number];
        connected: BrickPlacement;
        detached: BrickPlacement;
        kept: BrickPlacement[];
        remainderSpecs: StructuralPlacementSpec[];
        signature: string;
        spanI: number;
        spanK: number;
        trialComponentCount: number;
      } | null = null;
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
        // Prefer a rewrite that actually removes a detached component. An
        // equal-count seam move is still useful when it unlocks the next pass,
        // but never revisit an earlier packing (the old first-match strategy
        // could cycle and finish with the same floating 1 x 1).
        const trialComponentCount = disconnectedComponentCount(trial);
        const signature = packingSignature(trial);
        if (
          trialComponentCount > currentComponentCount
          || seenStructuralPackings.has(signature)
        ) continue;
        if (
          !selectedRepair
          || trialComponentCount < selectedRepair.trialComponentCount
          || (
            trialComponentCount === selectedRepair.trialComponentCount
            && candidate.score < selectedRepair.candidate.score
          )
        ) {
          selectedRepair = {
            candidate,
            connected,
            detached,
            kept,
            remainderSpecs,
            signature,
            spanI,
            spanK,
            trialComponentCount,
          };
        }
      }
      if (!selectedRepair) break;
      const repair = selectedRepair;
      releasePlacement(repair.detached);
      releasePlacement(repair.connected);
      placements.splice(0, placements.length, ...repair.kept);
      addStructuralPlacement(
        structuralOneByTwo,
        repair.candidate.colorId,
        Math.min(repair.candidate.detachedCell.i, repair.candidate.connectedCell.i),
        repair.candidate.detachedCell.j,
        Math.min(repair.candidate.detachedCell.k, repair.candidate.connectedCell.k),
        repair.spanI,
        repair.spanK,
      );
      for (const spec of repair.remainderSpecs) {
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
      seenStructuralPackings.add(repair.signature);
    }

  }

  stamp('structural block done');

  // ---- sculpt pass: curved, round and inverted parts on organic edges ----
  // Runs on the finished placement set, before BOM lines are derived from the
  // tally, so quotes, orders, instructions and previews all agree. Every
  // substitution keeps the placement's exact footprint and layer (the
  // assembly plan and hollow audits treat a placement as its stud rectangle),
  // and fires only when the exact part+colour SKU exists in the catalogue.
  if (SCULPT_PARTS.length && shaping) {
    const sculptByPart = new Map(SCULPT_PARTS.map((part) => [part.part, part]));
    const occupied = (i: number, j: number, k: number) => sourceCellByKey.has(`${i}|${j}|${k}`);
    const horizontal = [1, 2, 3, 4] as const;

    /**
     * Faced parts (slopes, curves, inverted) render with an explicit yaw, and
     * LDraw mould orientations vary wildly — several are even modelled
     * upside-down — so only parts whose native orientation has been visually
     * calibrated may carry a facing. Rotation-free 'round' parts need no
     * calibration. Grow this set via the part-gallery check, and the indexed
     * catalogue flows into builds automatically.
     */
    const CALIBRATED_FACED = new Set([
      '15068', '24201', '3016', '30474', '3660', '3665', '32803', '37352', '4286', '50950', '54200', '60477', '61678', '7126', '83473',
    ]);

    /** Best indexed part for a role: kind + footprint + colour availability. */
    const sculptPick = (
      kind: CatalogSculptPart['kind'],
      w: number,
      l: number,
      colorId: number,
      opts: { maxHeight?: number } = {},
    ): CatalogSculptPart | undefined => {
      let best: CatalogSculptPart | undefined;
      let bestScore = -1;
      for (const part of SCULPT_PARTS) {
        if (part.kind !== kind) continue;
        if (!((part.w === w && part.l === l) || (part.w === l && part.l === w))) continue;
        if (kind !== 'round' && !CALIBRATED_FACED.has(part.part)) continue;
        const height = part.heightBricks ?? 1;
        if (opts.maxHeight !== undefined && height > opts.maxHeight) continue;
        if (!part.elements[String(colorId)]) continue;
        // Curved profiles beat straight cuts for organic work; fuller height
        // beats caps when both fit the slot.
        const score = (/curved/i.test(part.name) ? 2 : 0) + height;
        if (score > bestScore) {
          best = part;
          bestScore = score;
        }
      }
      return best;
    };

    /**
     * Real surface tilt at a placement, from the sampled source-mesh normals:
     * returns the descent facing (1..4) when the surface leans consistently
     * 14°–58° off vertical-up across the footprint, else null. This is what
     * makes curved parts land on genuinely curved surfaces — bonnets, skulls,
     * haunches — instead of only where a stair-step pattern happens to form.
     */
    const tiltFacing = (i0: number, j0: number, k0: number, spanI: number, spanK: number): number | null => {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let count = 0;
      for (let di = 0; di < spanI; di++) {
        for (let dk = 0; dk < spanK; dk++) {
          const cell = sourceCellByKey.get(`${i0 + di}|${j0}|${k0 + dk}`);
          const surf = cell?.surf;
          if (!surf) continue;
          sx += surf[0];
          sy += surf[1];
          sz += surf[2];
          count++;
        }
      }
      if (count === 0) return null;
      const length = Math.hypot(sx, sy, sz);
      if (length < count * 0.6) return null; // normals disagree — not one surface
      const ny = sy / length;
      if (ny < 0.55 || ny > 0.97) return null; // near-vertical wall or flat top
      const hx = sx / length;
      const hz = sz / length;
      if (Math.abs(hx) < Math.abs(hz)) return hz > 0 ? 1 : 2;
      return hx > 0 ? 3 : 4;
    };
    const swap = (placement: BrickPlacement, target: CatalogSculptPart | undefined, facing?: number): void => {
      if (!target || !target.elements[String(placement.colorId)]) return;
      const oldKey = `${placement.part}|${placement.colorId}`;
      const oldCount = tally.get(oldKey) ?? 0;
      if (oldCount <= 1) tally.delete(oldKey);
      else tally.set(oldKey, oldCount - 1);
      const oldStock = stockUsed.get(oldKey);
      if (oldStock !== undefined) stockUsed.set(oldKey, Math.max(0, oldStock - 1));
      const newKey = `${target.part}|${placement.colorId}`;
      tally.set(newKey, (tally.get(newKey) ?? 0) + 1);
      reserveStock(target.part, placement.colorId);
      placement.part = target.part;
      placement.shape = target.kind;
      if (facing !== undefined) placement.facing = facing;
      else delete placement.facing;
    };

    // 1×1 cheese caps are collected first and only applied where a neighbour
    // along the ridge axis wants the same facing: connected step EDGES read
    // as clean curved lines, while lone surface bumps capped individually
    // would stipple an organic body into chainmail.
    const cheeseCandidates = new Map<string, { facing: number; lone?: boolean; placement: BrickPlacement }>();

    for (const placement of placements) {
      const { i, j, k } = placement;

      // 45° slope whose crest continues onto an open surface reads better as
      // a curve; a knife-edge or walled crest keeps the hard chamfer. The
      // curved part is studless, so the back cell must also be free above.
      if (placement.part === '3040' && placement.shape === 'slope' && placement.facing) {
        const dir = FACE_DIRECTIONS[placement.facing]!;
        const frontI = dir.x > 0 ? i + placement.spanI - 1 : i;
        const frontK = dir.z > 0 ? k + placement.spanK - 1 : k;
        const backI = frontI - dir.x;
        const backK = frontK - dir.z;
        const crestI = backI - dir.x;
        const crestK = backK - dir.z;
        if (
          occupied(crestI, j, crestK)
          && !occupied(crestI, j + 1, crestK)
          && !occupied(backI, j + 1, backK)
        ) {
          swap(placement, sculptPick('slopeCurved', 1, 2, placement.colorId), placement.facing);
        }
        continue;
      }

      // Single studs: cones cap isolated pillars, round bricks form their
      // shafts, cheese slopes soften one-stud step edges.
      if (placement.part === '3005' && placement.shape === 'brick') {
        const above = occupied(i, j + 1, k);
        const isolatedAt = (layer: number) => horizontal.every((face) => {
          const d = FACE_DIRECTIONS[face]!;
          return !occupied(i + d.x, layer, k + d.z);
        });
        if (isolatedAt(j)) {
          const belowIsolated = occupied(i, j - 1, k) && isolatedAt(j - 1);
          if (!above && belowIsolated) swap(placement, sculptByPart.get('4589'));
          else swap(placement, sculptByPart.get('3062'));
        } else if (!above) {
          let match: number | null = null;
          for (const face of horizontal) {
            const d = FACE_DIRECTIONS[face]!;
            const ahead = occupied(i + d.x, j, k + d.z);
            const aheadBelow = occupied(i + d.x, j - 1, k + d.z);
            if (!ahead && aheadBelow) {
              if (match !== null) {
                match = null;
                break;
              }
              match = face;
            }
          }
          // No step pattern? The measured surface tilt is the better witness.
          if (match === null) match = tiltFacing(i, j, k, 1, 1);
          if (match !== null) {
            // A step edge whose surface CONTINUES behind it is genuine
            // bodywork (bonnet tread, brow line) and deserves its cap even
            // without a ridge mate; only free-floating bumps must wait for
            // one, or organic noise stipples.
            const d = FACE_DIRECTIONS[match]!;
            const behindFilled = occupied(i - d.x, j, k - d.z);
            const behindOpen = !occupied(i - d.x, j + 1, k - d.z);
            cheeseCandidates.set(`${i}|${j}|${k}`, {
              facing: match,
              lone: behindFilled && behindOpen,
              placement,
            });
          }
        }
        continue;
      }

      // 2×2 caps: an isolated tower top becomes a dome; a shoulder that steps
      // down on exactly one side becomes the wide curved crown.
      if (placement.part === '3003' && placement.shape === 'brick' && placement.spanI === 2 && placement.spanK === 2
        && ![[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]].some(([ci, ck]) => occupied(ci!, j + 1, ck!))) {
        const top = [[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]] as const;
        const ringEmpty = horizontal.every((face) => {
          const d = FACE_DIRECTIONS[face]!;
          return top.every(([ci, ck]) => {
            const ni = ci + d.x;
            const nk = ck + d.z;
            const inside = ni >= i && ni <= i + 1 && nk >= k && nk <= k + 1;
            return inside || !occupied(ni, j, nk);
          });
        });
        if (ringEmpty) {
          swap(placement, sculptByPart.get('30367'));
          continue;
        }
        let match: number | null = null;
        for (const face of horizontal) {
          const d = FACE_DIRECTIONS[face]!;
          const edge = top.filter(([ci, ck]) =>
            (d.x > 0 && ci === i + 1) || (d.x < 0 && ci === i)
            || (d.z > 0 && ck === k + 1) || (d.z < 0 && ck === k));
          const steps = edge.every(([ci, ck]) =>
            !occupied(ci + d.x, j, ck + d.z) && occupied(ci + d.x, j - 1, ck + d.z));
          if (!steps) continue;
          if (match !== null) {
            match = null;
            break;
          }
          match = face;
        }
        if (match === null) match = tiltFacing(i, j, k, 2, 2);
        if (match !== null) swap(placement, sculptPick('slopeCurved', 2, 2, placement.colorId, { maxHeight: 1 }), match);
        continue;
      }

      // 1×2 bricks on a measurably tilted top surface, leaning ALONG their
      // long axis, become the full-height curved slope — its curve descends
      // along its length, which is exactly this geometry.
      if (placement.part === '3004' && placement.shape === 'brick'
        && !occupied(i, j + 1, k)
        && !occupied(i + placement.spanI - 1, j + 1, k + placement.spanK - 1)) {
        const tilt = tiltFacing(i, j, k, placement.spanI, placement.spanK);
        const alongI = placement.spanI === 2 && (tilt === 3 || tilt === 4);
        const alongK = placement.spanK === 2 && (tilt === 1 || tilt === 2);
        if (tilt !== null && (alongI || alongK)) {
          const curved = sculptPick('slopeCurved', 1, 2, placement.colorId);
          if (curved?.elements[String(placement.colorId)]) {
            swap(placement, curved, tilt);
            continue;
          }
        }
      }

      // 1×2 bricks whose front stud floats over air while the back stands on
      // the layer below are overhang steps. The curved inverted part (24201)
      // is preferred — organic undersides (bellies, jaws, wheel-arch lips)
      // read rounded — with the hard 45° (3665) as the colour fallback.
      if (placement.part === '3004' && placement.shape === 'brick' && j > 0) {
        const along = placement.spanI === 2 ? [3, 4] as const : [1, 2] as const;
        let match: number | null = null;
        for (const face of along) {
          const d = FACE_DIRECTIONS[face]!;
          const frontI = d.x > 0 ? i + placement.spanI - 1 : i;
          const frontK = d.z > 0 ? k + placement.spanK - 1 : k;
          const backI = frontI - d.x;
          const backK = frontK - d.z;
          if (!occupied(frontI, j - 1, frontK) && occupied(backI, j - 1, backK)) {
            if (match !== null) {
              match = null;
              break;
            }
            match = face;
          }
        }
        if (match !== null) {
          const curved = sculptPick('slopeInverted', 1, 2, placement.colorId);
          if (curved?.elements[String(placement.colorId)]) swap(placement, curved, match);
          else swap(placement, sculptByPart.get('3665'), match);
        }
        continue;
      }

      // 2×2 bricks overhanging on exactly one full edge get the wide
      // inverted parts — curved (32803) first, hard 45° (3660) as fallback.
      if (placement.part === '3003' && placement.shape === 'brick' && placement.spanI === 2 && placement.spanK === 2 && j > 0) {
        const top = [[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]] as const;
        let match: number | null = null;
        for (const face of [1, 2, 3, 4] as const) {
          const d = FACE_DIRECTIONS[face]!;
          const front = top.filter(([ci, ck]) =>
            (d.x > 0 && ci === i + 1) || (d.x < 0 && ci === i)
            || (d.z > 0 && ck === k + 1) || (d.z < 0 && ck === k));
          const back = top.filter(([ci, ck]) => !front.some(([fi, fk]) => fi === ci && fk === ck));
          const overhangs = front.every(([ci, ck]) => !occupied(ci, j - 1, ck))
            && back.every(([ci, ck]) => occupied(ci, j - 1, ck));
          if (!overhangs) continue;
          if (match !== null) {
            match = null;
            break;
          }
          match = face;
        }
        if (match !== null) {
          const curved = sculptPick('slopeInverted', 2, 2, placement.colorId);
          if (curved?.elements[String(placement.colorId)]) swap(placement, curved, match);
          else swap(placement, sculptByPart.get('3660'), match);
        }
      }
    }

    for (const [key, candidate] of cheeseCandidates) {
      const [i, j, k] = key.split('|').map(Number) as [number, number, number];
      const ridge = FACE_DIRECTIONS[candidate.facing]!.x !== 0
        ? [`${i}|${j}|${k - 1}`, `${i}|${j}|${k + 1}`]
        : [`${i - 1}|${j}|${k}`, `${i + 1}|${j}|${k}`];
      const hasMate = ridge.some((mateKey) => cheeseCandidates.get(mateKey)?.facing === candidate.facing);
      if (hasMate || candidate.lone) swap(candidate.placement, sculptPick('slopeCurved', 1, 1, candidate.placement.colorId) ?? sculptByPart.get('54200'), candidate.facing);
    }
  }

  const brickByPart = new Map<string, CatalogBrick>([
    ...BRICKS.map((brick) => [brick.part, brick] as const),
    ...PLATE_PARTS.map((plate) => [plate.part, plate] as const),
    ...SLOPE_PARTS.map((slope) => [slope.part, slope] as const),
    ...SCULPT_PARTS.map((sculpt) => [sculpt.part, sculpt] as const),
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

  stamp('sculpt done');

  // ---- terrace pass: plate steps soften single-brick cliffs ----
  // A gentle slope quantised to brick height reads as 24-LDU cliffs. The
  // sculpture-standard fix is terracing: a 2-plate stack on the lower side
  // of each step edge, and a 1-plate stack one stud further out, turning one
  // big step into three 8-LDU ones. Purely additive — placements and packer
  // invariants untouched; plates ride in their own BOM block like tiles.
  let terrace: TerraceStep[] | undefined;
  let terraceLines: BomLine[] | undefined;
  let terraceTotalEur: number | undefined;
  if (PLATE_PARTS.length && shaping) {
    const topByColumn = new Map<string, VoxelCell>();
    for (const cell of sourceCells) {
      const columnKey = `${cell.i}|${cell.k}`;
      const current = topByColumn.get(columnKey);
      if (!current || cell.j > current.j) topByColumn.set(columnKey, cell);
    }
    const stacks = new Map<string, { cell: VoxelCell; plates: 1 | 2 }>();
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (const upper of topByColumn.values()) {
      // Terrace only where the surface itself is a slope: walls and cliffs
      // (steep normals) keep their sharp edges, and cells the curve pass
      // already claimed are smoother than any plate stack.
      const surf = upper.surf;
      if (!surf || surf[1] < 0.55) continue;
      if (consumed.has(`${upper.i}|${upper.j}|${upper.k}`)) continue;
      for (const [di, dk] of DIRS) {
        const lower = topByColumn.get(`${upper.i + di}|${upper.k + dk}`);
        if (!lower || upper.j - lower.j !== 1) continue;
        const lowerColumn = `${lower.i}|${lower.k}`;
        if (consumed.has(`${lower.i}|${lower.j}|${lower.k}`)) continue;
        const existing = stacks.get(lowerColumn);
        if (!existing || existing.plates < 2) stacks.set(lowerColumn, { cell: lower, plates: 2 });
        const beyond = topByColumn.get(`${upper.i + di * 2}|${upper.k + dk * 2}`);
        if (beyond && beyond.j === lower.j && !consumed.has(`${beyond.i}|${beyond.j}|${beyond.k}`)) {
          const beyondColumn = `${beyond.i}|${beyond.k}`;
          if (!stacks.has(beyondColumn)) stacks.set(beyondColumn, { cell: beyond, plates: 1 });
        }
      }
    }
    if (stacks.size) {
      terrace = [];
      const terraceTally = new Map<string, number>();
      const oneWide = PLATE_PARTS.filter((plate) => plate.w === 1);
      const emitted = new Set<string>();
      for (const [positionKey, entry] of stacks) {
        if (emitted.has(positionKey)) continue;
        const { cell } = entry;
        const colorId = colorOf(cell);
        const matches = (candidate?: { cell: VoxelCell; plates: 1 | 2 }) =>
          !!candidate && candidate.plates === entry.plates && candidate.cell.j === cell.j
          && colorOf(candidate.cell) === colorId;
        const runAlong = (di: number, dk: number): number => {
          let length = 1;
          while (length < 10) {
            const nextKey = `${cell.i + di * length}|${cell.k + dk * length}`;
            if (emitted.has(nextKey) || !matches(stacks.get(nextKey))) break;
            length += 1;
          }
          return length;
        };
        const lengthI = runAlong(1, 0);
        const lengthK = runAlong(0, 1);
        const alongI = lengthI >= lengthK;
        let remaining = alongI ? lengthI : lengthK;
        let cursor = 0;
        while (remaining > 0) {
          const plate = oneWide.find((candidate) => candidate.l <= remaining && candidate.elements[String(colorId)]);
          if (!plate) break;
          const span = plate.l;
          const baseI = cell.i + (alongI ? cursor : 0);
          const baseK = cell.k + (alongI ? 0 : cursor);
          for (let step = 0; step < span; step++) {
            const stepI = baseI + (alongI ? step : 0);
            const stepK = baseK + (alongI ? 0 : step);
            emitted.add(`${stepI}|${stepK}`);
            // The stack owns this top face — the tile skin must skip it.
            consumed.add(`${stepI}|${cell.j}|${stepK}`);
          }
          for (let level = 0; level < entry.plates; level++) {
            terrace.push({
              colorId,
              i: baseI,
              j: cell.j,
              k: baseK,
              level,
              part: plate.part,
              spanI: alongI ? span : 1,
              spanK: alongI ? 1 : span,
            });
            const tallyKey = `${plate.part}|${colorId}`;
            terraceTally.set(tallyKey, (terraceTally.get(tallyKey) ?? 0) + 1);
          }
          cursor += span;
          remaining -= span;
        }
      }
      if (terrace.length) {
        const plateByPart = new Map(PLATE_PARTS.map((plate) => [plate.part, plate]));
        const colorById = new Map(COLORS.map((color) => [color.id, color]));
        terraceLines = [...terraceTally.entries()].map(([key, quantity]) => {
          const [part, colorIdRaw] = key.split('|') as [string, string];
          const plate = plateByPart.get(part)!;
          const color = colorById.get(Number(colorIdRaw))!;
          const unitPriceEur = plate.prices?.[String(color.id)] ?? plate.basePriceEur;
          return {
            colorId: color.id,
            colorName: color.name,
            colorRgb: color.rgb,
            elementId: plate.elements[String(color.id)] ?? null,
            estimated: false,
            imageUrl: null,
            l: plate.l,
            lineTotalEur: Number((unitPriceEur * quantity).toFixed(2)),
            part,
            partName: plate.name,
            quantity,
            skuId: null,
            substituted: false,
            unitPriceEur,
            w: plate.w,
          };
        });
        terraceTotalEur = Number(terraceLines.reduce((sum, line) => sum + line.lineTotalEur, 0).toFixed(2));
        stamp(`terrace done, ${terrace.length} plates`);
      } else {
        terrace = undefined;
      }
    }
  }

  // ---- tile finishing pass: the studless skin ----
  // On near-flat surfaces (a bonnet tilts 10°, a dog's back barely more)
  // slopes cannot help at brick resolution — what reads as "toy" is the
  // STUDS. Display models tile flat tops smooth; so do we: every flat,
  // top-exposed cell gets a tile cap, greedily covered largest-tile-first
  // per colour. Tiles live outside placements/lines (like wheel assemblies)
  // so plan and audit invariants stay untouched.
  let finish: TileFinish[] | undefined;
  let finishLines: BomLine[] | undefined;
  let finishTotalEur: number | undefined;
  if (TILE_PARTS.length && shaping) {
    const tiled = new Set<string>();
    const flatTop = new Map<string, { cell: VoxelCell; colorId: number }>();
    // Studless mode tiles gently tilted tops too, not just true flats — the
    // display-model look tolerates a slightly stepped skin over studs.
    const tileTilt = technique === 'studless' ? 0.72 : 0.94;
    for (const cell of sourceCells) {
      const key = `${cell.i}|${cell.j}|${cell.k}`;
      if (consumed.has(key)) continue; // slopes and curves are already studless
      if (sourceCellByKey.has(`${cell.i}|${cell.j + 1}|${cell.k}`)) continue;
      const surf = cell.surf;
      if (surf && surf[1] < tileTilt) continue; // meaningfully tilted — curve territory
      flatTop.set(key, { cell, colorId: colorOf(cell) });
    }
    const finishTally = new Map<string, number>();
    finish = [];
    for (const [key, anchor] of flatTop) {
      if (tiled.has(key)) continue;
      const { cell, colorId } = anchor;
      for (const tile of TILE_PARTS) {
        if (!tile.elements[String(colorId)]) continue;
        let committed = false;
        for (const [w, l] of tile.w === tile.l ? [[tile.w, tile.l]] : [[tile.w, tile.l], [tile.l, tile.w]]) {
          let fits = true;
          for (let di = 0; di < w! && fits; di++) {
            for (let dk = 0; dk < l! && fits; dk++) {
              const probe = `${cell.i + di}|${cell.j}|${cell.k + dk}`;
              const entry = flatTop.get(probe);
              if (!entry || tiled.has(probe) || entry.colorId !== colorId) fits = false;
            }
          }
          if (!fits) continue;
          for (let di = 0; di < w!; di++) {
            for (let dk = 0; dk < l!; dk++) tiled.add(`${cell.i + di}|${cell.j}|${cell.k + dk}`);
          }
          finish.push({ colorId, i: cell.i, j: cell.j, k: cell.k, part: tile.part, spanI: w!, spanK: l! });
          const tallyKey = `${tile.part}|${colorId}`;
          finishTally.set(tallyKey, (finishTally.get(tallyKey) ?? 0) + 1);
          committed = true;
          break;
        }
        if (committed) break;
      }
    }
    if (finish.length) {
      const tileByPart = new Map(TILE_PARTS.map((tile) => [tile.part, tile]));
      const colorById = new Map(COLORS.map((color) => [color.id, color]));
      finishLines = [...finishTally.entries()].map(([key, quantity]) => {
        const [part, colorIdRaw] = key.split('|') as [string, string];
        const tile = tileByPart.get(part)!;
        const color = colorById.get(Number(colorIdRaw))!;
        const unitPriceEur = tile.prices?.[String(color.id)] ?? tile.basePriceEur;
        return {
          colorId: color.id,
          colorName: color.name,
          colorRgb: color.rgb,
          elementId: tile.elements[String(color.id)] ?? null,
          estimated: false,
          imageUrl: null,
          l: tile.l,
          lineTotalEur: Number((unitPriceEur * quantity).toFixed(2)),
          part,
          partName: tile.name,
          quantity,
          skuId: null,
          substituted: false,
          unitPriceEur,
          w: tile.w,
        };
      });
      finishTotalEur = Number(finishLines.reduce((sum, line) => sum + line.lineTotalEur, 0).toFixed(2));
      stamp(`finish done, ${finish.length} tiles`);
    } else {
      finish = undefined;
    }
  }

  // ---- real wheel assemblies for detected vehicles ----
  // Axle 3L through a technic brick, 18mm wheel, 24×14 tire: every SKU and
  // price from the GoBricks harvest. Kept out of `lines`/`totalParts` so the
  // assembly plan's placement-count invariant is untouched.
  const anchors = (model as {
    wheelAnchors?: Array<{ i: number; j: number; k: number; side: 1 | -1; radiusCells?: number }>;
  }).wheelAnchors;
  let accessories: WheelAccessory[] | undefined;
  let accessoryLines: BomLine[] | undefined;
  let accessoryTotalEur: number | undefined;
  if (anchors?.length) {
    // Four real tire sizes ladder up to the carve radius (studs): 24×14 for
    // small builds, 43.2 ZR for ≈5-stud arches, 68.7 R for ≈8-stud arches,
    // and the 94.8 R balloon for the ≈12-stud wells a 64-stud car carves.
    // A tire half the size of its well is what made every car read as a toy.
    const tierFor = (radius: number): { tirePart: string; wheelPart: string } => {
      if (radius >= 5.2) return { tirePart: '54120', wheelPart: '56908' };
      if (radius >= 3.5) return { tirePart: '61480', wheelPart: '56145' };
      if (radius >= 1.5) return { tirePart: '44309', wheelPart: '56145' };
      return { tirePart: '24341', wheelPart: '55982' };
    };
    accessories = anchors.map((anchor) => {
      const tier = tierFor(anchor.radiusCells ?? 2);
      return {
        axlePart: '4519',
        holderPart: '3700',
        i: anchor.i,
        j: anchor.j,
        k: anchor.k,
        side: anchor.side,
        tirePart: tier.tirePart,
        wheelPart: tier.wheelPart,
      };
    });
    const count = anchors.length;
    const tireCount = (part: string) =>
      accessories!.filter((accessory) => accessory.tirePart === part).length;
    const wheelCount = (part: string) =>
      accessories!.filter((accessory) => accessory.wheelPart === part).length;
    const catalogueBlack = COLORS.find((color) => color.id === 11) ?? COLORS[0]!;
    const wheelGrey = COLORS.find((color) => color.id === 71) ?? catalogueBlack;
    const accessoryLine = (
      part: string,
      partName: string,
      colour: CatalogColor,
      sku: string,
      unitPriceEur: number,
      quantity: number,
    ): BomLine => ({
      colorId: colour.id,
      colorName: colour.name,
      colorRgb: colour.rgb,
      elementId: sku,
      estimated: false,
      imageUrl: null,
      l: 1,
      lineTotalEur: Number((unitPriceEur * quantity).toFixed(2)),
      part,
      partName,
      quantity,
      skuId: null,
      substituted: false,
      unitPriceEur,
      w: 1,
    });
    // The 4-stud moulded arch only suits tires up to the 43.2 ZR; bigger
    // wells get brick-built rims instead (the renderer skips the arch too).
    const archCount = tireCount('24341') + tireCount('44309');
    accessoryLines = [
      accessoryLine('3700', 'Technic Brick 1 x 2 with Hole', catalogueBlack, 'GDS-623-011', 0.08, count),
      ...(archCount
        ? [accessoryLine('98282', 'Mudguard 4 x 2 1/2 with Round Arch', catalogueBlack, 'GDS-1319-011', 0.12, archCount)]
        : []),
      accessoryLine('4519', 'Technic Axle 3L', catalogueBlack, 'GDS-579-011', 0.05, count),
      ...(wheelCount('56908')
        ? [accessoryLine('56908', 'Wheel 43.2mm D. x 26mm Racing', wheelGrey, 'GDS-1229-071', 0.59, wheelCount('56908'))]
        : []),
      ...(wheelCount('56145')
        ? [accessoryLine('56145', 'Wheel 30.4mm D. x 20mm', wheelGrey, 'GDS-1231-071', 0.38, wheelCount('56145'))]
        : []),
      ...(wheelCount('55982')
        ? [accessoryLine('55982', 'Wheel 18mm D. x 14mm', wheelGrey, 'GDS-1158-071', 0.14, wheelCount('55982'))]
        : []),
      ...(tireCount('54120')
        ? [accessoryLine('54120', 'Tire 94.8 x 44 R Balloon', catalogueBlack, 'GDS-1511-080', 3.08, tireCount('54120'))]
        : []),
      ...(tireCount('61480')
        ? [accessoryLine('61480', 'Tire 68.7 x 34 R', catalogueBlack, 'GDS-1573-080', 1.51, tireCount('61480'))]
        : []),
      ...(tireCount('44309')
        ? [accessoryLine('44309', 'Tire 43.2 x 22 ZR', catalogueBlack, 'GDS-1234-080', 0.77, tireCount('44309'))]
        : []),
      ...(tireCount('24341')
        ? [accessoryLine('24341', 'Tire 24 x 14 Shallow Tread', catalogueBlack, 'GDS-2218-090', 0.22, tireCount('24341'))]
        : []),
    ];
    accessoryTotalEur = Number(accessoryLines.reduce((sum, line) => sum + line.lineTotalEur, 0).toFixed(2));
  }

  return {
    ...(accessories ? { accessories, accessoryLines, accessoryTotalEur } : {}),
    ...(finish ? { finish, finishLines, finishTotalEur } : {}),
    ...(terrace ? { terrace, terraceLines, terraceTotalEur } : {}),
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
