/**
 * Device-local order history for the prototype checkout. An order owns a
 * compact snapshot of the exact selected build, so its guide still works if
 * the gallery is renamed, trimmed, or the user starts another build.
 */

import type { PanelStyle } from './photoEngine/voxelizePhoto';
import { brickify, hollowBuildModel, type BillOfMaterials } from './brickify';
import { isAssemblyBuildable } from './instructions/assemblyPlan';
import { buildModelFromCells, type BuildProfile, type VoxelModel } from './voxelFox';
import { voxelBaseColor } from './voxelRender';
import type { BuildFill, BuildProduct } from '../types/navigation';

export type OrderStatus = 'reserved-demo';
export type OrderPaletteMode = 'natural' | 'black-white';

export interface OrderModelSnapshot {
  size: number;
  layerHeight?: number;
  brickCount: number;
  palette: string[];
  /** [i, j, k, paletteIndex, slopeFlag, facing] per cell. */
  cells: number[][];
}

export interface OrderColor {
  name: string;
  hex: string;
  quantity: number;
}

export interface OrderPartLine {
  part: string;
  partName: string;
  colorName: string;
  colorHex: string;
  quantity: number;
}

export interface OrderRecord {
  id: string;
  createdAt: string;
  status: OrderStatus;
  buildId: string | null;
  buildName: string;
  product: BuildProduct;
  fill: BuildFill;
  selectedVariant: string;
  profile: BuildProfile;
  paletteMode: OrderPaletteMode;
  style: PanelStyle;
  accent: string;
  kitQuantity: number;
  parts: number;
  colorCount: number;
  colors: OrderColor[];
  partLines: OrderPartLine[];
  countryCode: string;
  deliveryRange: string;
  currency: string;
  currencySymbol: string;
  kitPrice: number;
  shippingPrice: number;
  totalPrice: number;
  customerName: string | null;
  customerEmail: string | null;
  guest: boolean;
  model: OrderModelSnapshot;
  /** Frozen catalog packing used for the purchased preview and instructions. */
  bom?: BillOfMaterials;
  source3DMeshUrl: string | null;
  source3DRetakesRemaining: number;
}

export interface CreateOrderInput {
  buildId: string | null;
  buildName: string;
  product: BuildProduct;
  fill: BuildFill;
  selectedVariant: string;
  profile: BuildProfile;
  paletteMode: OrderPaletteMode;
  style: PanelStyle;
  accent: string;
  countryCode: string;
  deliveryRange: string;
  currency: string;
  currencySymbol: string;
  kitPrice: number;
  shippingPrice: number;
  totalPrice: number;
  customerName?: string | null;
  customerEmail?: string | null;
  guest: boolean;
  model: VoxelModel;
  source3DMeshUrl?: string | null;
  source3DRetakesRemaining?: number;
}

const STORAGE_KEY = 'pixbrik.orders.v1';
const MAX_ORDERS = 10;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function snapshotOrderModel(model: VoxelModel, accent = '#E96632'): OrderModelSnapshot {
  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();
  const cells = model.cells.map((cell) => {
    const hex = cell.colorHex ?? voxelBaseColor({ ...cell, exposed: [] }, accent);
    let index = paletteIndex.get(hex);
    if (index === undefined) {
      index = palette.length;
      palette.push(hex);
      paletteIndex.set(hex, index);
    }
    return [cell.i, cell.j, cell.k, index, cell.shape === 'slope' ? 1 : 0, cell.facing ?? 0];
  });
  return {
    brickCount: model.brickCount,
    cells,
    ...(model.layerHeight ? { layerHeight: model.layerHeight } : {}),
    palette,
    size: model.size,
  };
}

export function loadOrderModel(snapshot: OrderModelSnapshot): VoxelModel {
  let minI = Infinity;
  let maxI = -Infinity;
  let minJ = Infinity;
  let minK = Infinity;
  let maxK = -Infinity;
  for (const [i, j, k] of snapshot.cells) {
    minI = Math.min(minI, i!);
    maxI = Math.max(maxI, i!);
    minJ = Math.min(minJ, j!);
    minK = Math.min(minK, k!);
    maxK = Math.max(maxK, k!);
  }
  const centerI = Number.isFinite(minI) ? (minI + maxI) / 2 : 0;
  const centerK = Number.isFinite(minK) ? (minK + maxK) / 2 : 0;
  const hasStoredGeometry = snapshot.cells.some((cell) => cell.length >= 5);
  const layerHeight = snapshot.layerHeight ?? snapshot.size;
  return buildModelFromCells(
    snapshot.cells.map(([i, j, k, paletteIndex, slopeFlag, facing]) => ({
      colorHex: snapshot.palette[paletteIndex!] ?? '#E96632',
      cx: (i! - centerI) * snapshot.size,
      cy: (j! - minJ + 0.5) * layerHeight,
      cz: (k! - centerK) * snapshot.size,
      i: i!,
      j: j!,
      k: k!,
      ...(slopeFlag === 1 ? { shape: 'slope' as const } : {}),
      ...(facing ? { facing } : {}),
      zone: 'body',
    })),
    snapshot.size,
    { layerHeight: snapshot.layerHeight, preserveShapes: hasStoredGeometry },
  );
}

/** Infer the label from the actual ordered cells when no explicit UI choice is supplied. */
export function inferOrderPaletteMode(model: VoxelModel): OrderPaletteMode {
  const colored = model.cells.some((cell) => {
    const hex = (cell.colorHex ?? '#E96632').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return true;
    const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    return Math.max(...channels) - Math.min(...channels) > 14;
  });
  return colored ? 'natural' : 'black-white';
}

function isOrderRecord(value: unknown): value is OrderRecord {
  if (!value || typeof value !== 'object') return false;
  const order = value as Partial<OrderRecord>;
  return (
    typeof order.id === 'string' &&
    typeof order.createdAt === 'string' &&
    typeof order.buildName === 'string' &&
    !!order.model &&
    Array.isArray(order.model.cells) &&
    Array.isArray(order.model.palette)
  );
}

export function listOrders(): OrderRecord[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isOrderRecord) : [];
  } catch {
    return [];
  }
}

export function getOrder(id: string): OrderRecord | null {
  return listOrders().find((order) => order.id === id) ?? null;
}

export function createOrder(input: CreateOrderInput): OrderRecord | null {
  const store = storage();
  if (!store) return null;
  // The input is always the approved exterior/full source model. Freeze the
  // BOM with the exact fill option quoted upstream; packing an already-hollow
  // reconstruction can move exposed seams and change the saved part count.
  const hollow = input.fill === 'hollow';
  const bom = brickify(input.model, input.accent, { hollow });
  const orderedModel = hollow ? hollowBuildModel(input.model) : input.model;
  // A visual preview is not yet a sellable kit. Persist neither an order nor
  // its manual until every frozen catalog placement is physically connected.
  if (!isAssemblyBuildable(bom)) return null;
  const quantities = new Map<string, OrderColor>();
  for (const line of bom.lines) {
    const key = `${line.colorName}|${line.colorRgb}`;
    const current = quantities.get(key);
    if (current) current.quantity += line.quantity;
    else quantities.set(key, { hex: line.colorRgb, name: line.colorName, quantity: line.quantity });
  }
  const createdAt = new Date().toISOString();
  const order: OrderRecord = {
    ...input,
    buildName: input.buildName.trim() || 'PixBrik build',
    colorCount: bom.colorCount,
    colors: [...quantities.values()].sort((a, b) => b.quantity - a.quantity),
    createdAt,
    customerEmail: input.customerEmail?.trim() || null,
    customerName: input.customerName?.trim() || null,
    id: `PX-${createdAt.slice(2, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 36 ** 4)
      .toString(36)
      .padStart(4, '0')
      .toUpperCase()}`,
    kitQuantity: 1,
    model: snapshotOrderModel(orderedModel, input.accent),
    bom: {
      ...bom,
      lines: bom.lines.map((line) => ({ ...line })),
      placements: bom.placements.map((placement) => ({ ...placement })),
    },
    partLines: bom.lines.map((line) => ({
      colorHex: line.colorRgb,
      colorName: line.colorName,
      part: line.part,
      partName: line.partName,
      quantity: line.quantity,
    })),
    parts: bom.totalParts,
    source3DMeshUrl: input.source3DMeshUrl ?? null,
    source3DRetakesRemaining: input.source3DRetakesRemaining ?? 0,
    status: 'reserved-demo',
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify([order, ...listOrders()].slice(0, MAX_ORDERS)));
    return order;
  } catch {
    return null;
  }
}
