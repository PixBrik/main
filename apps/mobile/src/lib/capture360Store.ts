/**
 * Persist the latest 360° capture set (compact JPEG data URLs) so the model
 * lab can A/B single-photo vs multiview on the same object, and a reload
 * doesn't lose a half-finished orbit. Device-local, like everything else.
 */

import type { MultiviewShots } from './photoEngine/imageTo3D';
import type { GuidedCropKind } from './guidedViewCrop';

const KEY = 'pixbrik.capture360.v1';
const NORMALIZATION_KEY = 'pixbrik.capture360.normalized.v1';
const PROVIDER_RUNS_KEY = 'pixbrik.capture360.providerRuns.v1';
export const RAW_CAPTURE_TTL_MS = 24 * 60 * 60 * 1_000;

interface Stored360Capture {
  savedAt: number;
  shots: MultiviewShots;
}

export type GuidedViewNormalization = Partial<
  Record<keyof MultiviewShots, GuidedCropKind>
>;

export function save360Capture(shots: MultiviewShots): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const stored: Stored360Capture = { savedAt: Date.now(), shots };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Quota exceeded — the capture still works for this session.
  }
}

export function load360Capture(): MultiviewShots | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored360Capture>;
    if (
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - parsed.savedAt > RAW_CAPTURE_TTL_MS ||
      !parsed.shots ||
      typeof parsed.shots.front !== 'string'
    ) {
      clear360Capture();
      return null;
    }
    return parsed.shots;
  } catch {
    clear360Capture();
    return null;
  }
}

export function has360Capture(): boolean {
  return load360Capture() !== null;
}

export function save360Normalization(value: GuidedViewNormalization): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(NORMALIZATION_KEY, JSON.stringify(value));
  } catch {
    // The current session still keeps its normalization metadata in memory.
  }
}

export function load360Normalization(): GuidedViewNormalization {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(NORMALIZATION_KEY) ?? '{}') as
      GuidedViewNormalization;
    const result: GuidedViewNormalization = {};
    for (const name of ['front', 'left', 'back', 'right'] as const) {
      const kind = parsed?.[name];
      if (kind === 'center' || kind === 'object' || kind === 'person') result[name] = kind;
    }
    return result;
  } catch {
    return {};
  }
}

export function clear360Capture(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(NORMALIZATION_KEY);
  } catch {
    // nothing to clear
  }
}

export function load360ProviderRuns(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(PROVIDER_RUNS_KEY) ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(3, Math.floor(value))) : 0;
  } catch {
    return 0;
  }
}

export function save360ProviderRuns(runs: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROVIDER_RUNS_KEY, String(Math.max(0, Math.min(3, Math.floor(runs)))));
  } catch {
    // The in-memory limit still applies for this session.
  }
}

export function clear360ProviderRuns(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PROVIDER_RUNS_KEY);
  } catch {
    // nothing to clear
  }
}
