export type DemoScreen =
  | 'home'
  | 'mode'
  | 'capture'
  | 'preferences'
  | 'progress'
  | 'result'
  | 'bom'
  | 'purchase'
  | 'stores'
  | 'checkout'
  | 'library'
  | 'admin'
  | 'lab'
  | 'instructions';

/** Solid build vs hollow (shell-only) build. */
export type BuildFill = 'full' | 'hollow';

export type CaptureMode = 'photo' | 'orbit';
export type TargetSize = 'desk' | 'shelf' | 'statement';
export type DetailLevel = 'simple' | 'balanced' | 'intricate';
export type PaletteMode = 'true' | 'calm' | 'bold';
