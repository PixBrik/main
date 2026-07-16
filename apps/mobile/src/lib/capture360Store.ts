/**
 * Persist the latest 360° capture set (compact JPEG data URLs) so the model
 * lab can A/B single-photo vs multiview on the same object, and a reload
 * doesn't lose a half-finished orbit. Device-local, like everything else.
 */

import type { MultiviewShots } from './photoEngine/imageTo3D';

const KEY = 'pixbrik.capture360.v1';

export function save360Capture(shots: MultiviewShots): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(shots));
  } catch {
    // Quota exceeded — the capture still works for this session.
  }
}

export function load360Capture(): MultiviewShots | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultiviewShots;
    return typeof parsed?.front === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function has360Capture(): boolean {
  return load360Capture() !== null;
}

export function clear360Capture(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
