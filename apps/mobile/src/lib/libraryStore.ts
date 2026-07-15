/**
 * Object-library store. Persists the catalogue to localStorage on web so the
 * admin can add/remove entries; falls back to the seed everywhere else.
 */

import { LIBRARY_SEED, type LibraryEntry } from '../data/carLibrary';

const KEY = 'fotobrik.library.v1';

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
  if (!store) return LIBRARY_SEED;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return LIBRARY_SEED;
    const custom = JSON.parse(raw) as LibraryEntry[];
    // Seed entries always present; custom entries appended.
    const customOnly = custom.filter((entry) => !entry.seed);
    return [...LIBRARY_SEED, ...customOnly];
  } catch {
    return LIBRARY_SEED;
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
