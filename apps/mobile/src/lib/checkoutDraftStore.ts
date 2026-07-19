/**
 * Device-local checkout drafts.
 *
 * This is deliberately not the production abandoned-checkout database. It
 * gives the current demo an honest same-device resume path while the buyer
 * account, authoritative quote and payment APIs are still being built. Raw
 * photos are never copied into the draft.
 */

import type { OrderModelSnapshot, OrderPaletteMode } from './orderStore';
import type { PanelStyle, PhotoBuildMode } from './photoEngine/voxelizePhoto';
import type { BuildFill, BuildProduct } from '../types/navigation';

export const CHECKOUT_DRAFT_VERSION = 1 as const;
export const CHECKOUT_DRAFT_QUERY_PARAMETER = 'draft';
export const CHECKOUT_DRAFT_PATH = '/checkout';

const STORAGE_KEY = 'pixbrik.checkout-drafts.v1';
const MAX_DRAFTS = 5;
const MAX_STORED_BYTES = 4_500_000;
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DRAFT_ID_PATTERN = /^pbd_[A-Za-z0-9_-]{22}$/;

export interface CheckoutDraftSnapshot {
  version: typeof CHECKOUT_DRAFT_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  build: {
    buildId: string | null;
    name: string;
    product: BuildProduct;
    fill: BuildFill;
    selectedVariant: string;
    paletteMode: OrderPaletteMode;
    accent: string;
    style: PanelStyle;
    mode: PhotoBuildMode;
    hasDepth: boolean;
    source3DMeshUrl: string | null;
    source3DRetakesRemaining: number;
    source3DSubject: 'object' | 'person';
  };
  delivery: {
    countryCode: string;
    rangeLabel: string;
  };
  quote: {
    currency: string;
    currencySymbol: string;
    kitPrice: number;
    shippingPrice: number;
    totalPrice: number;
    quotedAt: string;
    /** A draft quote must always be checked again before real payment. */
    requiresServerReprice: true;
  };
  model: OrderModelSnapshot;
}

export type SaveCheckoutDraftInput = Omit<
  CheckoutDraftSnapshot,
  'version' | 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'
> & { id?: string | null };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    if (first === undefined) break;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) output += alphabet[third & 63];
  }
  return output;
}

function mintDraftId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure random values are unavailable');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `pbd_${base64Url(bytes)}`;
}

function safeDate(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isText(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000;
}

function isSafeModel(value: unknown): value is OrderModelSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = value as Partial<OrderModelSnapshot>;
  if (
    typeof model.size !== 'number' || !Number.isFinite(model.size) || model.size <= 0 || model.size > 10_000 ||
    typeof model.brickCount !== 'number' || !Number.isSafeInteger(model.brickCount) || model.brickCount < 0 ||
    !Array.isArray(model.palette) || model.palette.length === 0 || model.palette.length > 256 ||
    !model.palette.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) ||
    !Array.isArray(model.cells) || model.cells.length === 0 || model.cells.length > 50_000
  ) {
    return false;
  }
  return model.cells.every((cell) => (
    Array.isArray(cell) && cell.length >= 4 && cell.length <= 6 &&
    cell.every((coordinate) => Number.isSafeInteger(coordinate)) &&
    (cell[3] ?? -1) >= 0 && (cell[3] ?? 256) < model.palette!.length
  ));
}

function isSafeSourceUrl(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' && value.length <= 2_048 &&
    (/^https:\/\/[^\s]+$/i.test(value) || /^\/api\/[A-Za-z0-9_?&=./%-]+$/.test(value))
  );
}

export function isCheckoutDraftSnapshot(value: unknown, nowEpochMs = Date.now()): value is CheckoutDraftSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Partial<CheckoutDraftSnapshot>;
  const build = draft.build as Partial<CheckoutDraftSnapshot['build']> | undefined;
  const delivery = draft.delivery as Partial<CheckoutDraftSnapshot['delivery']> | undefined;
  const quote = draft.quote as Partial<CheckoutDraftSnapshot['quote']> | undefined;
  const createdAt = safeDate(draft.createdAt);
  const updatedAt = safeDate(draft.updatedAt);
  const expiresAt = safeDate(draft.expiresAt);
  return (
    draft.version === CHECKOUT_DRAFT_VERSION &&
    typeof draft.id === 'string' && DRAFT_ID_PATTERN.test(draft.id) &&
    createdAt !== null && updatedAt !== null && expiresAt !== null &&
    createdAt <= updatedAt && updatedAt < expiresAt && expiresAt > nowEpochMs &&
    !!build && (build.buildId === null || isText(build.buildId, 200)) &&
    isText(build.name, 200) &&
    (build.product === 'panel' || build.product === 'sculpture') &&
    (build.fill === 'full' || build.fill === 'hollow') &&
    isText(build.selectedVariant, 40) &&
    (build.paletteMode === 'natural' || build.paletteMode === 'black-white') &&
    typeof build.accent === 'string' && /^#[0-9a-f]{6}$/i.test(build.accent) &&
    (build.style === 'natural' || build.style === 'classic' || build.style === 'sepia') &&
    (build.mode === 'volume' || build.mode === 'relief') &&
    typeof build.hasDepth === 'boolean' &&
    isSafeSourceUrl(build.source3DMeshUrl) &&
    Number.isSafeInteger(build.source3DRetakesRemaining) &&
    (build.source3DRetakesRemaining ?? -1) >= 0 && (build.source3DRetakesRemaining ?? 100) <= 10 &&
    (build.source3DSubject === 'object' || build.source3DSubject === 'person') &&
    !!delivery && typeof delivery.countryCode === 'string' && /^[A-Z]{2}$/.test(delivery.countryCode) &&
    isText(delivery.rangeLabel, 120) &&
    !!quote && typeof quote.currency === 'string' && /^[A-Z]{3}$/.test(quote.currency) &&
    isText(quote.currencySymbol, 8) && isMoney(quote.kitPrice) &&
    isMoney(quote.shippingPrice) && isMoney(quote.totalPrice) &&
    safeDate(quote.quotedAt) !== null && quote.requiresServerReprice === true &&
    isSafeModel(draft.model)
  );
}

function readDrafts(nowEpochMs = Date.now()): CheckoutDraftSnapshot[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_STORED_BYTES) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((candidate) => isCheckoutDraftSnapshot(candidate, nowEpochMs)).slice(0, MAX_DRAFTS)
      : [];
  } catch {
    return [];
  }
}

export function loadCheckoutDraft(id: string, nowEpochMs = Date.now()): CheckoutDraftSnapshot | null {
  if (!DRAFT_ID_PATTERN.test(id)) return null;
  return readDrafts(nowEpochMs).find((draft) => draft.id === id) ?? null;
}

export function saveCheckoutDraft(
  input: SaveCheckoutDraftInput,
  nowEpochMs = Date.now(),
): CheckoutDraftSnapshot | null {
  const store = storage();
  if (!store) return null;
  const previous = input.id ? loadCheckoutDraft(input.id, nowEpochMs) : null;
  let id = previous?.id ?? null;
  if (!id) {
    try {
      id = mintDraftId();
    } catch {
      return null;
    }
  }
  const now = new Date(nowEpochMs).toISOString();
  const draft: CheckoutDraftSnapshot = {
    ...input,
    version: CHECKOUT_DRAFT_VERSION,
    id,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    expiresAt: new Date(nowEpochMs + DRAFT_TTL_MS).toISOString(),
  };
  if (!isCheckoutDraftSnapshot(draft, nowEpochMs - 1)) return null;
  try {
    const next = [draft, ...readDrafts(nowEpochMs).filter((candidate) => candidate.id !== id)]
      .slice(0, MAX_DRAFTS);
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_STORED_BYTES) return null;
    store.setItem(STORAGE_KEY, serialized);
    return draft;
  } catch {
    return null;
  }
}

export function removeCheckoutDraft(id: string): void {
  const store = storage();
  if (!store || !DRAFT_ID_PATTERN.test(id)) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(readDrafts().filter((draft) => draft.id !== id)));
  } catch {
    // Recovery storage is helpful, never a reason to break checkout.
  }
}

export function checkoutDraftPath(id: string): string | null {
  return DRAFT_ID_PATTERN.test(id)
    ? `${CHECKOUT_DRAFT_PATH}?${CHECKOUT_DRAFT_QUERY_PARAMETER}=${encodeURIComponent(id)}`
    : null;
}

export function checkoutDraftIdFromLocation(location: Pick<Location, 'pathname' | 'search'>): string | null {
  if (location.pathname.replace(/\/+$/g, '') !== CHECKOUT_DRAFT_PATH) return null;
  const candidate = new URLSearchParams(location.search).get(CHECKOUT_DRAFT_QUERY_PARAMETER) ?? '';
  return DRAFT_ID_PATTERN.test(candidate) ? candidate : null;
}
