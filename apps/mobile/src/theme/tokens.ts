/**
 * PixBrik "Saffron Press" identity (design handoff D2).
 * Four colours total: saffron is the world, ink does all the talking,
 * white floats, alarm is strictly rationed (wordmark I's + at most one
 * live element per screen). Type: Archivo Black shouts, Archivo whispers.
 */

export const fonts = {
  /** Archivo Black — display, prices, states, buttons. Single weight. */
  display: 'ArchivoBlack_400Regular',
  /** Archivo weights — body and labels. */
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  extrabold: 'Archivo_800ExtraBold',
} as const;

const ink = '#17130A';
const saffron = '#FFC800';
const alarm = '#FF3D17';

/** Alpha helpers on ink (for text/surfaces sitting on saffron). */
export const inkAlpha = (alpha: number) => `rgba(23, 19, 10, ${alpha})`;
/** Alpha helpers on saffron (for text/surfaces sitting on ink). */
export const saffronAlpha = (alpha: number) => `rgba(255, 200, 0, ${alpha})`;

export const colors = {
  // Canonical Saffron Press palette.
  saffron,
  ink,
  white: '#FFFFFF',
  alarm,
  /** Hollow-core cell in cross-section grids only. */
  core: '#F4EEDC',

  // Legacy names, remapped so every existing screen lands in the new world.
  paper: saffron,
  paperDeep: '#EFBB00',
  inkSoft: inkAlpha(0.66),
  panelDark: ink,
  panelRaise: '#241E10',
  blue: ink,
  blueBright: '#2E2716',
  blueSoft: inkAlpha(0.08),
  coral: alarm,
  coralDeep: alarm,
  coralSoft: inkAlpha(0.08),
  mint: saffronAlpha(0.7),
  mintDeep: ink,
  mintSoft: inkAlpha(0.08),
  saffronDeep: ink,
  saffronSoft: inkAlpha(0.08),
  lilac: inkAlpha(0.35),
  line: inkAlpha(0.14),
  danger: alarm,
} as const;

/**
 * Stage signals are retired in Saffron Press: every stage speaks ink.
 * The map stays for API compatibility; all four entries are identical.
 */
const inkSignal = { main: ink, deep: ink, soft: inkAlpha(0.08) };
export const signals = {
  indigo: inkSignal,
  coral: inkSignal,
  mint: inkSignal,
  saffron: inkSignal,
} as const;

export type SignalName = keyof typeof signals;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 44,
} as const;

/** Dock 26 · cards 20 · buttons 16 · pills 999. */
export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

/** Soft ink-tinted shadows (map to box-shadow on web). */
export const shadow = {
  /** White floating pills/cards. */
  card: {
    shadowColor: ink,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 5,
  },
  /** The dock. */
  dock: {
    shadowColor: ink,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.42,
    shadowRadius: 48,
    elevation: 12,
  },
  /** Legacy alias (was a glow CTA shadow). */
  cta: {
    shadowColor: ink,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 6,
  },
} as const;

export const type = {
  display: {
    fontFamily: fonts.display,
    fontSize: 62,
    lineHeight: 61,
    letterSpacing: -2.5,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 33,
    letterSpacing: -1,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.4,
  },
  body: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
  },
  label: {
    fontFamily: fonts.extrabold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  micro: {
    fontFamily: fonts.extrabold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
} as const;
