/**
 * Buyer library. PostgreSQL is authoritative for realistic mesh products.
 * The local seed is deliberately limited to products whose procedural nature
 * is the product itself (custom words/signs), never toy-like substitute cars,
 * animals, flowers or objects.
 */

import { COMPOSED_SEED, LIBRARY_SEED, type LibraryEntry } from '../data/carLibrary';

const KEY = 'fotobrik.library.v1';
const CURATED_PROCEDURAL = LIBRARY_SEED.filter(
  (entry) => entry.supportsHolder || entry.id === 'love-sign',
  // Composed bouquet products (real-mesh masters, buyer-chosen count/vase)
  // join the curated set; COMPOSED_SEED stays empty until stem masters exist.
).concat(COMPOSED_SEED);

function cleanCatalog(entries: LibraryEntry[]): LibraryEntry[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
    .map((entry) => ({
      ...entry,
      id: entry.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: entry.name.trim().replace(/\s+/g, ' '),
      tags: [...new Set((entry.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    }))
    .filter((entry) => {
      if (!entry.id || !entry.name || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return !!entry.meshUrl || !!entry.proceduralKey;
    });
}

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // unavailable
  }
  return null;
}

export function listLibrary(): LibraryEntry[] {
  const store = storage();
  if (!store) return cleanCatalog(CURATED_PROCEDURAL);
  try {
    const raw = store.getItem(KEY);
    if (!raw) return cleanCatalog(CURATED_PROCEDURAL);
    const custom = JSON.parse(raw) as LibraryEntry[];
    // Preserve only legacy real-mesh entries while their owner migrates them
    // through the backoffice. Local procedural experiments are not products.
    const customOnly = custom.filter((entry) => !entry.seed && !!entry.meshUrl);
    return cleanCatalog([...CURATED_PROCEDURAL, ...customOnly]);
  } catch {
    return cleanCatalog(CURATED_PROCEDURAL);
  }
}

export async function loadLibrary(): Promise<LibraryEntry[]> {
  const fallback = listLibrary();
  const response = await fetch('/api/library/catalog', {
    headers: { Accept: 'application/json' },
    method: 'GET',
  });
  const body = (await response.json().catch(() => null)) as
    | { contractVersion?: unknown; entries?: unknown }
    | null;
  if (!response.ok || body?.contractVersion !== 1 || !Array.isArray(body.entries)) {
    throw new Error('The production catalogue is temporarily unavailable.');
  }
  const published = cleanCatalog(body.entries as LibraryEntry[]);
  const legacyRealMeshes = fallback.filter((entry) => !entry.seed && !!entry.meshUrl);
  return cleanCatalog([...CURATED_PROCEDURAL, ...published, ...legacyRealMeshes]);
}

function persistCustom(entries: LibraryEntry[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(entries.filter((entry) => !entry.seed)));
  } catch {
    // ignore quota errors
  }
}

export function addLibraryEntry(entry: Omit<LibraryEntry, 'id' | 'seed'>): LibraryEntry {
  const created: LibraryEntry = {
    ...entry,
    id: `custom-${Date.now().toString(36)}`,
    seed: false,
  };
  persistCustom([...listLibrary(), created]);
  return created;
}

export function removeLibraryEntry(id: string): void {
  persistCustom(listLibrary().filter((entry) => entry.id !== id));
}

export function resetLibrary(): void {
  const store = storage();
  store?.removeItem(KEY);
}
