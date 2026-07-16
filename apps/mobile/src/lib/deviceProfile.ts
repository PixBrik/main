/**
 * Light-device detection: phones and low-memory machines get the lean
 * pipeline (fast classic cutout, no SAM/CLIP) because the full model stack —
 * TF.js detection + SAM + CLIP + FaceMesh WASM — exceeds a mobile browser
 * tab's memory budget and the OS kills the tab mid-lock.
 *
 * `?light` (or #light) forces it on any device, for testing.
 */
export function isLightDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof window !== 'undefined' && /[?&#]light\b/.test(window.location.search + window.location.hash)) {
    return true;
  }
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 4) return true;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
