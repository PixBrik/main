/**
 * Durable, privacy-minimal build-guide sharing.
 *
 * A published guide contains only what a clean browser needs to reconstruct
 * the manual: the compact model, frozen catalog packing and deterministic
 * placement order. Customer/order fields and provider mesh URLs are never
 * accepted by the wire format.
 */

import {
  brickify,
  catalogPartFootprint,
  isCatalogColorId,
  type BillOfMaterials,
  type BomLine,
  type BrickPlacement,
} from './brickify';
import {
  loadOrderModel,
  snapshotOrderModel,
  type OrderModelSnapshot,
} from './orderStore';
import {
  ASSEMBLY_PLAN_VERSION,
  isAssemblyBuildable,
  type AssemblyPlan,
} from './instructions/assemblyPlan';
import type { BuildProfile, VoxelModel } from './voxelFox';

export const GUIDE_SHARE_SCHEMA = 'pixbrik.guide' as const;
export const GUIDE_SHARE_VERSION = 1 as const;
export const GUIDE_MANUAL_VERSION = ASSEMBLY_PLAN_VERSION;
export const GUIDE_SHARE_MAX_BYTES = 3 * 1024 * 1024;
export const GUIDE_SHARE_MAX_CELLS = 100_000;
export const GUIDE_SHARE_MAX_PLACEMENTS = 100_000;
export const GUIDE_SHARE_MAX_LINES = 5_000;

export const GUIDE_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const HEX = /^#[0-9a-f]{6}$/i;
const PROFILES = new Set<BuildProfile>(['efficient', 'balanced', 'detailed']);

export interface GuideBuildSnapshot {
  accent: string;
  bom: BillOfMaterials;
  model: OrderModelSnapshot;
  name: string;
  profile: BuildProfile;
}

/** Compact frozen manual. Details are regenerated from the exact frozen BOM. */
export interface GuideManualSnapshot {
  /** Must match the assembly planner understood by the reader. */
  plannerVersion: typeof GUIDE_MANUAL_VERSION;
  /** Full, unique permutation of `build.bom.placements` indices. */
  placementOrder: number[];
}

export interface GuideShareDraft {
  build: GuideBuildSnapshot;
  manual: GuideManualSnapshot;
  schema: typeof GUIDE_SHARE_SCHEMA;
  version: typeof GUIDE_SHARE_VERSION;
}

export interface PublishedGuideSnapshot extends GuideShareDraft {
  expiresAt: string;
  publishedAt: string;
}

export interface CreateGuideShareInput {
  accent: string;
  assemblyPlan?: Pick<AssemblyPlan, 'placementOrder' | 'version'>;
  bom?: BillOfMaterials;
  buildName: string;
  model: VoxelModel;
  placementOrder?: readonly number[];
  plannerVersion?: number;
  profile: BuildProfile;
}

/**
 * Structural source accepted from an OrderRecord. Deliberately omits every
 * customer, payment and provider-source field; passing a complete OrderRecord
 * is safe because this function copies only this whitelist.
 */
export interface GuideShareOrderSource {
  accent: string;
  bom?: BillOfMaterials;
  buildName: string;
  model: OrderModelSnapshot;
  profile: BuildProfile;
}

export interface PublishedGuideLink {
  expiresAt: string;
  id: string;
  url: string;
}

export interface GuideShareClientOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export class GuideShareError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GuideShareError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordWithKeys(value: unknown, label: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new GuideShareError(`${label} must be an object.`);
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) throw new GuideShareError(`${label} contains unsupported field ${unexpected}.`);
  const missing = allowed.find((key) => !(key in value));
  if (missing) throw new GuideShareError(`${label}.${missing} is required.`);
  return value;
}

function text(value: unknown, label: string, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new GuideShareError(`${label} must be text.`);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new GuideShareError(`${label} is invalid.`);
  }
  return clean;
}

function numberValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new GuideShareError(`${label} is outside the supported range.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new GuideShareError(`${label} must be true or false.`);
  return value;
}

function color(value: unknown, label: string): string {
  const result = text(value, label, 7)!;
  if (!HEX.test(result)) throw new GuideShareError(`${label} must be a six-digit hex colour.`);
  return result.toUpperCase();
}

function optionalWebUrl(value: unknown, label: string): string | null {
  const result = text(value, label, 1_024, true);
  if (result === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new GuideShareError(`${label} must be a web URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new GuideShareError(`${label} must be a web URL.`);
  }
  return parsed.toString();
}

function parseModel(value: unknown): OrderModelSnapshot {
  if (!isRecord(value)) throw new GuideShareError('build.model must be an object.');
  const source = value;
  const keys = Object.keys(source);
  const unsupported = keys.find(
    (key) => !['brickCount', 'cells', 'layerHeight', 'palette', 'size'].includes(key),
  );
  if (unsupported) throw new GuideShareError(`build.model contains unsupported field ${unsupported}.`);
  for (const required of ['brickCount', 'cells', 'palette', 'size']) {
    if (!(required in source)) throw new GuideShareError(`build.model.${required} is required.`);
  }

  if (!Array.isArray(source.palette) || source.palette.length < 1 || source.palette.length > 256) {
    throw new GuideShareError('build.model.palette is invalid.');
  }
  const palette = source.palette.map((entry, index) => color(entry, `build.model.palette[${index}]`));
  if (!Array.isArray(source.cells) || source.cells.length < 1 || source.cells.length > GUIDE_SHARE_MAX_CELLS) {
    throw new GuideShareError('build.model.cells is outside the supported size.');
  }
  const occupied = new Set<string>();
  const cells = source.cells.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 6) {
      throw new GuideShareError(`build.model.cells[${index}] must contain six numbers.`);
    }
    const i = numberValue(entry[0], `cell ${index} i`, -4_096, 4_096, true);
    const j = numberValue(entry[1], `cell ${index} j`, -4_096, 4_096, true);
    const k = numberValue(entry[2], `cell ${index} k`, -4_096, 4_096, true);
    const paletteIndex = numberValue(entry[3], `cell ${index} palette`, 0, palette.length - 1, true);
    const slope = numberValue(entry[4], `cell ${index} slope`, 0, 1, true);
    const facing = numberValue(entry[5], `cell ${index} facing`, 0, 4, true);
    if ((slope === 1 && facing === 0) || (slope === 0 && facing !== 0)) {
      throw new GuideShareError(`build.model.cells[${index}] has invalid slope orientation.`);
    }
    const key = `${i}|${j}|${k}`;
    if (occupied.has(key)) throw new GuideShareError(`build.model.cells contains duplicate ${key}.`);
    occupied.add(key);
    return [i, j, k, paletteIndex, slope, facing];
  });
  const brickCount = numberValue(
    source.brickCount,
    'build.model.brickCount',
    cells.length,
    cells.length,
    true,
  );
  const size = numberValue(source.size, 'build.model.size', 0.000_001, 100);
  const layerHeight =
    source.layerHeight === undefined
      ? undefined
      : numberValue(source.layerHeight, 'build.model.layerHeight', 0.000_001, 100);
  return { brickCount, cells, palette, size, ...(layerHeight === undefined ? {} : { layerHeight }) };
}

function parseBomLine(value: unknown, index: number): BomLine {
  const label = `build.bom.lines[${index}]`;
  const source = recordWithKeys(value, label, [
    'colorId', 'colorName', 'colorRgb', 'elementId', 'estimated', 'imageUrl', 'l',
    'lineTotalEur', 'part', 'partName', 'quantity', 'skuId', 'substituted', 'unitPriceEur', 'w',
  ]);
  const part = text(source.part, `${label}.part`, 128)!;
  const footprint = catalogPartFootprint(part);
  if (!footprint) throw new GuideShareError(`${label}.part is not in the build catalog.`);
  const colorId = numberValue(source.colorId, `${label}.colorId`, 0, 1_000_000, true);
  if (!isCatalogColorId(colorId)) throw new GuideShareError(`${label}.colorId is not in the build catalog.`);
  const w = numberValue(source.w, `${label}.w`, 1, 64, true);
  const l = numberValue(source.l, `${label}.l`, 1, 64, true);
  if (w !== footprint.w || l !== footprint.l) {
    throw new GuideShareError(`${label} does not match the catalog footprint.`);
  }
  if (source.elementId !== null || source.skuId !== null || source.imageUrl !== null) {
    throw new GuideShareError(`${label} contains private catalog commerce fields.`);
  }
  const estimated = booleanValue(source.estimated, `${label}.estimated`);
  const substituted = booleanValue(source.substituted, `${label}.substituted`);
  if (estimated || substituted) {
    throw new GuideShareError(`${label} contains commerce-only estimate metadata.`);
  }
  const unitPriceEur = numberValue(source.unitPriceEur, `${label}.unitPriceEur`, 0, 0);
  const lineTotalEur = numberValue(source.lineTotalEur, `${label}.lineTotalEur`, 0, 0);
  return {
    colorId,
    colorName: text(source.colorName, `${label}.colorName`, 120)!,
    colorRgb: color(source.colorRgb, `${label}.colorRgb`),
    elementId: null,
    estimated,
    imageUrl: null,
    l,
    lineTotalEur,
    part,
    partName: text(source.partName, `${label}.partName`, 160)!,
    quantity: numberValue(source.quantity, `${label}.quantity`, 1, GUIDE_SHARE_MAX_PLACEMENTS, true),
    skuId: null,
    substituted,
    unitPriceEur,
    w,
  };
}

function parsePlacement(value: unknown, index: number): BrickPlacement {
  const label = `build.bom.placements[${index}]`;
  if (!isRecord(value)) throw new GuideShareError(`${label} must be an object.`);
  const allowed = ['colorId', 'facing', 'i', 'j', 'k', 'part', 'shape', 'spanI', 'spanK'];
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new GuideShareError(`${label} contains unsupported field ${unexpected}.`);
  for (const required of ['colorId', 'i', 'j', 'k', 'part', 'shape', 'spanI', 'spanK']) {
    if (!(required in value)) throw new GuideShareError(`${label}.${required} is required.`);
  }
  if (value.shape !== 'brick' && value.shape !== 'slope') {
    throw new GuideShareError(`${label}.shape is invalid.`);
  }
  const facing =
    value.facing === undefined
      ? undefined
      : numberValue(value.facing, `${label}.facing`, 1, 4, true);
  if ((value.shape === 'slope' && facing === undefined) || (value.shape === 'brick' && facing !== undefined)) {
    throw new GuideShareError(`${label} has invalid orientation metadata.`);
  }
  const part = text(value.part, `${label}.part`, 128)!;
  const footprint = catalogPartFootprint(part);
  if (!footprint || footprint.shape !== value.shape) {
    throw new GuideShareError(`${label} does not match a catalog shape.`);
  }
  const colorId = numberValue(value.colorId, `${label}.colorId`, 0, 1_000_000, true);
  if (!isCatalogColorId(colorId)) throw new GuideShareError(`${label}.colorId is not in the build catalog.`);
  const spanI = numberValue(value.spanI, `${label}.spanI`, 1, 64, true);
  const spanK = numberValue(value.spanK, `${label}.spanK`, 1, 64, true);
  const catalogOrientation =
    (spanI === footprint.l && spanK === footprint.w) ||
    (spanI === footprint.w && spanK === footprint.l);
  if (!catalogOrientation) throw new GuideShareError(`${label} does not match the catalog footprint.`);
  return {
    colorId,
    ...(facing === undefined ? {} : { facing }),
    i: numberValue(value.i, `${label}.i`, -4_096, 4_096, true),
    j: numberValue(value.j, `${label}.j`, -4_096, 4_096, true),
    k: numberValue(value.k, `${label}.k`, -4_096, 4_096, true),
    part,
    shape: value.shape,
    spanI,
    spanK,
  };
}

function parseBom(value: unknown): BillOfMaterials {
  const source = recordWithKeys(value, 'build.bom', [
    'colorCount', 'isEstimate', 'lines', 'placements', 'totalEur', 'totalParts',
  ]);
  if (!Array.isArray(source.lines) || source.lines.length < 1 || source.lines.length > GUIDE_SHARE_MAX_LINES) {
    throw new GuideShareError('build.bom.lines is outside the supported size.');
  }
  if (
    !Array.isArray(source.placements) ||
    source.placements.length < 1 ||
    source.placements.length > GUIDE_SHARE_MAX_PLACEMENTS
  ) {
    throw new GuideShareError('build.bom.placements is outside the supported size.');
  }
  const lines = source.lines.map(parseBomLine);
  const placements = source.placements.map(parsePlacement);
  const totalParts = numberValue(
    source.totalParts,
    'build.bom.totalParts',
    placements.length,
    placements.length,
    true,
  );
  if (lines.reduce((sum, line) => sum + line.quantity, 0) !== totalParts) {
    throw new GuideShareError('build.bom line quantities do not match its placements.');
  }
  const lineByKey = new Map(lines.map((line) => [`${line.part}|${line.colorId}`, line]));
  if (lineByKey.size !== lines.length) throw new GuideShareError('build.bom contains duplicate part lines.');
  const placedByKey = new Map<string, number>();
  for (const placement of placements) {
    const key = `${placement.part}|${placement.colorId}`;
    if (!lineByKey.has(key)) throw new GuideShareError(`build.bom placement ${key} has no part line.`);
    placedByKey.set(key, (placedByKey.get(key) ?? 0) + 1);
  }
  for (const [key, line] of lineByKey) {
    if (placedByKey.get(key) !== line.quantity) {
      throw new GuideShareError(`build.bom quantity for ${key} does not match its placements.`);
    }
  }
  const uniqueColors = new Set(lines.map((line) => line.colorId)).size;
  const colorCount = numberValue(source.colorCount, 'build.bom.colorCount', uniqueColors, uniqueColors, true);
  const totalEur = numberValue(source.totalEur, 'build.bom.totalEur', 0, 0);
  const expectedTotalEur = Number(lines.reduce((sum, line) => sum + line.lineTotalEur, 0).toFixed(2));
  if (Math.abs(totalEur - expectedTotalEur) > 0.001) {
    throw new GuideShareError('build.bom total does not match its part lines.');
  }
  const isEstimate = booleanValue(source.isEstimate, 'build.bom.isEstimate');
  if (isEstimate) throw new GuideShareError('build.bom must not publish pricing estimate metadata.');
  if (isEstimate !== lines.some((line) => line.estimated)) {
    throw new GuideShareError('build.bom estimate status does not match its part lines.');
  }
  return {
    colorCount,
    isEstimate,
    lines,
    placements,
    totalEur,
    totalParts,
  };
}

function validatePackedCoverage(model: OrderModelSnapshot, bom: BillOfMaterials): void {
  const modelCells = new Set(model.cells.map(([i, j, k]) => `${i}|${j}|${k}`));
  const packedCells = new Set<string>();
  let expandedFootprint = 0;
  for (const placement of bom.placements) {
    expandedFootprint += placement.spanI * placement.spanK;
    if (expandedFootprint > GUIDE_SHARE_MAX_CELLS) {
      throw new GuideShareError('build.bom expands beyond the supported model size.');
    }
    for (let di = 0; di < placement.spanI; di++) {
      for (let dk = 0; dk < placement.spanK; dk++) {
        const key = `${placement.i + di}|${placement.j}|${placement.k + dk}`;
        if (!modelCells.has(key)) {
          throw new GuideShareError('build.bom contains a placement outside the frozen model.');
        }
        if (packedCells.has(key)) {
          throw new GuideShareError('build.bom contains overlapping catalog placements.');
        }
        packedCells.add(key);
      }
    }
  }
  if (packedCells.size !== modelCells.size) {
    throw new GuideShareError('build.bom does not cover every frozen model cell exactly once.');
  }
}

function parseBuild(value: unknown): GuideBuildSnapshot {
  const source = recordWithKeys(value, 'build', ['accent', 'bom', 'model', 'name', 'profile']);
  if (typeof source.profile !== 'string' || !PROFILES.has(source.profile as BuildProfile)) {
    throw new GuideShareError('build.profile is unsupported.');
  }
  const model = parseModel(source.model);
  const bom = parseBom(source.bom);
  validatePackedCoverage(model, bom);
  return {
    accent: color(source.accent, 'build.accent'),
    bom,
    model,
    name: text(source.name, 'build.name', 80)!,
    profile: source.profile as BuildProfile,
  };
}

function parseManual(value: unknown, placementCount: number): GuideManualSnapshot {
  const source = recordWithKeys(value, 'manual', ['placementOrder', 'plannerVersion']);
  if (source.plannerVersion !== GUIDE_MANUAL_VERSION) {
    throw new GuideShareError('manual.plannerVersion is unsupported.');
  }
  if (!Array.isArray(source.placementOrder) || source.placementOrder.length !== placementCount) {
    throw new GuideShareError('manual.placementOrder must cover every placement exactly once.');
  }
  const seen = new Set<number>();
  const placementOrder = source.placementOrder.map((entry, index) => {
    const placementIndex = numberValue(entry, `manual.placementOrder[${index}]`, 0, placementCount - 1, true);
    if (seen.has(placementIndex)) {
      throw new GuideShareError('manual.placementOrder contains a duplicate placement.');
    }
    seen.add(placementIndex);
    return placementIndex;
  });
  return { placementOrder, plannerVersion: GUIDE_MANUAL_VERSION };
}

function parseIsoDate(value: unknown, label: string): string {
  const result = text(value, label, 40)!;
  const date = new Date(result);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== result) {
    throw new GuideShareError(`${label} must be an ISO timestamp.`);
  }
  return result;
}

/** Strict parser used both before publication and by the server API. */
export function parseGuideShareDraft(value: unknown): GuideShareDraft {
  const source = recordWithKeys(value, 'guide', ['build', 'manual', 'schema', 'version']);
  if (source.schema !== GUIDE_SHARE_SCHEMA || source.version !== GUIDE_SHARE_VERSION) {
    throw new GuideShareError('This guide version is not supported.');
  }
  const build = parseBuild(source.build);
  const manual = parseManual(source.manual, build.bom.placements.length);
  if (!isAssemblyBuildable(build.bom, { placementOrder: manual.placementOrder })) {
    throw new GuideShareError('This build guide is blocked until every catalog piece has a safe assembly connection.');
  }
  return {
    build,
    manual,
    schema: GUIDE_SHARE_SCHEMA,
    version: GUIDE_SHARE_VERSION,
  };
}

/** Strict clean-browser parser. Expired snapshots are rejected by default. */
export function parsePublishedGuideSnapshot(
  value: unknown,
  options: { allowExpired?: boolean; now?: Date } = {},
): PublishedGuideSnapshot {
  const source = recordWithKeys(value, 'guide', [
    'build', 'expiresAt', 'manual', 'publishedAt', 'schema', 'version',
  ]);
  const draft = parseGuideShareDraft({
    build: source.build,
    manual: source.manual,
    schema: source.schema,
    version: source.version,
  });
  const publishedAt = parseIsoDate(source.publishedAt, 'guide.publishedAt');
  const expiresAt = parseIsoDate(source.expiresAt, 'guide.expiresAt');
  const lifetime = Date.parse(expiresAt) - Date.parse(publishedAt);
  if (lifetime <= 0 || lifetime > 90 * 86_400_000) {
    throw new GuideShareError('The guide expiry is invalid.');
  }
  if (!options.allowExpired && Date.parse(expiresAt) <= (options.now ?? new Date()).valueOf()) {
    throw new GuideShareError('This shared guide has expired.', 410);
  }
  return { ...draft, expiresAt, publishedAt };
}

export function createPublishedGuideSnapshot(
  draftValue: unknown,
  options: { now?: Date; ttlDays?: number } = {},
): PublishedGuideSnapshot {
  const draft = parseGuideShareDraft(draftValue);
  const now = options.now ?? new Date();
  const ttlDays = numberValue(options.ttlDays ?? 30, 'ttlDays', 1, 90, true);
  return {
    ...draft,
    expiresAt: new Date(now.valueOf() + ttlDays * 86_400_000).toISOString(),
    publishedAt: now.toISOString(),
  };
}

function sanitizeGuideBom(source: BillOfMaterials): BillOfMaterials {
  return {
    colorCount: source.colorCount,
    isEstimate: false,
    lines: source.lines.map((line) => ({
      ...line,
      elementId: null,
      estimated: false,
      imageUrl: null,
      lineTotalEur: 0,
      skuId: null,
      substituted: false,
      unitPriceEur: 0,
    })),
    placements: source.placements.map((placement) => ({ ...placement })),
    totalEur: 0,
    totalParts: source.totalParts,
  };
}

/** Build a sanitized draft from an in-memory instructions model. */
export function createGuideShareDraft(input: CreateGuideShareInput): GuideShareDraft {
  const bom = sanitizeGuideBom(input.bom ?? brickify(input.model, input.accent));
  const placementOrder = input.assemblyPlan?.placementOrder ?? input.placementOrder;
  const plannerVersion = input.assemblyPlan?.version ?? input.plannerVersion;
  return parseGuideShareDraft({
    build: {
      accent: input.accent,
      bom,
      model: snapshotOrderModel(input.model, input.accent),
      name: input.buildName,
      profile: input.profile,
    },
    manual: {
      placementOrder: placementOrder ?? bom.placements.map((_, index) => index),
      plannerVersion: plannerVersion ?? GUIDE_MANUAL_VERSION,
    },
    schema: GUIDE_SHARE_SCHEMA,
    version: GUIDE_SHARE_VERSION,
  });
}

/** Build a sanitized draft from a saved order without copying private fields. */
export function createGuideShareDraftFromOrder(
  source: GuideShareOrderSource,
  manual: Partial<GuideManualSnapshot> = {},
): GuideShareDraft {
  if (!source.bom) throw new GuideShareError('This order has no frozen build plan to share.');
  const bom = sanitizeGuideBom(source.bom);
  return parseGuideShareDraft({
    build: {
      accent: source.accent,
      bom,
      model: source.model,
      name: source.buildName,
      profile: source.profile,
    },
    manual: {
      placementOrder: manual.placementOrder ?? bom.placements.map((_, index) => index),
      plannerVersion: manual.plannerVersion ?? GUIDE_MANUAL_VERSION,
    },
    schema: GUIDE_SHARE_SCHEMA,
    version: GUIDE_SHARE_VERSION,
  });
}

export function loadGuideModel(snapshot: PublishedGuideSnapshot): VoxelModel {
  return loadOrderModel(snapshot.build.model);
}

export function guideSharePath(id: string): string {
  if (!GUIDE_SHARE_ID_PATTERN.test(id)) throw new GuideShareError('The guide link is invalid.');
  return `/g/${id}`;
}

/** Accept a bare id, `/g/:id`, or an app URL containing either form. */
export function readGuideShareId(value: string): string | null {
  if (GUIDE_SHARE_ID_PATTERN.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value, 'https://pixbrik.invalid');
  } catch {
    return null;
  }
  const pathMatch = parsed.pathname.match(/^\/g\/([A-Za-z0-9_-]{22})\/?$/);
  const candidate = pathMatch?.[1] ?? parsed.searchParams.get('guide');
  return candidate && GUIDE_SHARE_ID_PATTERN.test(candidate) ? candidate : null;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function responseTextWithinLimit(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > GUIDE_SHARE_MAX_BYTES) {
    throw new GuideShareError('The shared guide is too large.', 413);
  }
  const value = await response.text();
  if (utf8Bytes(value) > GUIDE_SHARE_MAX_BYTES) {
    throw new GuideShareError('The shared guide is too large.', 413);
  }
  return value;
}

function endpointUrl(endpoint: string, id: string): string {
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`;
}

/** Publish through the server API; returns the short app URL encoded by QR. */
export async function publishGuide(
  draftValue: unknown,
  options: GuideShareClientOptions = {},
): Promise<PublishedGuideLink> {
  const draft = parseGuideShareDraft(draftValue);
  const body = JSON.stringify(draft);
  if (utf8Bytes(body) > GUIDE_SHARE_MAX_BYTES) {
    throw new GuideShareError('This build is too large to publish.', 413);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.endpoint ?? '/api/guides/share', {
    body,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const raw = await responseTextWithinLimit(response);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new GuideShareError('Guide publishing returned an invalid response.', response.status);
  }
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Could not publish this guide.';
    throw new GuideShareError(message, response.status);
  }
  const source = recordWithKeys(payload, 'publish response', ['expiresAt', 'id', 'url']);
  const id = text(source.id, 'publish response.id', 22)!;
  if (!GUIDE_SHARE_ID_PATTERN.test(id)) throw new GuideShareError('Guide publishing returned an invalid id.');
  const url = optionalWebUrl(source.url, 'publish response.url');
  const parsedUrl = url ? new URL(url) : null;
  const localHttp =
    parsedUrl?.protocol === 'http:' &&
    (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');
  if (
    !url ||
    !parsedUrl ||
    (parsedUrl.protocol !== 'https:' && !localHttp) ||
    parsedUrl.pathname !== guideSharePath(id) ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new GuideShareError('Guide publishing returned an invalid app URL.');
  }
  return { expiresAt: parseIsoDate(source.expiresAt, 'publish response.expiresAt'), id, url };
}

/** Load and validate a published guide in a browser with no local order data. */
export async function loadPublishedGuide(
  idOrUrl: string,
  options: GuideShareClientOptions & { now?: Date } = {},
): Promise<PublishedGuideSnapshot> {
  const id = readGuideShareId(idOrUrl);
  if (!id) throw new GuideShareError('The guide link is invalid.', 400);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(endpointUrl(options.endpoint ?? '/api/guides/share', id), {
    headers: { Accept: 'application/json' },
    method: 'GET',
  });
  const raw = await responseTextWithinLimit(response);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new GuideShareError('The shared guide is not valid JSON.', response.status);
  }
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Could not load this shared guide.';
    throw new GuideShareError(message, response.status);
  }
  return parsePublishedGuideSnapshot(payload, { now: options.now });
}
