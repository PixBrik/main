export type DemoScreen =
  | 'home'
  | 'account'
  | 'legal'
  | 'terms'
  | 'privacy'
  | 'contact'
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
  | 'lab'
  | 'instructions';

/** Solid build vs reinforced hollow build. */
export type BuildFill = 'full' | 'hollow';

/** The two distinct products a buyer can switch between for one photo. */
export type BuildProduct = 'panel' | 'sculpture';

export type CaptureMode = 'photo' | 'orbit';
export type TargetSize = 'desk' | 'shelf' | 'statement';
export type DetailLevel = 'simple' | 'balanced' | 'intricate';
export type PaletteMode = 'true' | 'calm' | 'bold';
