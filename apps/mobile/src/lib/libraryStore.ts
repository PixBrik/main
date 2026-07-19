/**
 * Object-library store. Persists the catalogue to localStorage on web so the
 * admin can add/remove entries; falls back to the seed everywhere else.
 */

import { LIBRARY_SEED, type LibraryEntry } from '../data/carLibrary';

const KEY = 'fotobrik.library.v1';

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
  if (!store) return cleanCatalog(LIBRARY_SEED);
  try {
    const raw = store.getItem(KEY);
    if (!raw) return cleanCatalog(LIBRARY_SEED);
    const custom = JSON.parse(raw) as LibraryEntry[];
    // Seed entries always present; custom entries appended.
    const customOnly = custom.filter((entry) => !entry.seed);
    return cleanCatalog([...LIBRARY_SEED, ...customOnly]);
  } catch {
    return cleanCatalog(LIBRARY_SEED);
  }
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
