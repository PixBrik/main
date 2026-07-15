export const colors = {
  paper: '#F3F1EA',
  paperDeep: '#E5E4DE',
  white: '#FFFFFF',
  ink: '#111315',
  inkSoft: '#5B625E',
  panelDark: '#171A21',
  panelRaise: '#242833',
  blue: '#4F46E5',
  blueBright: '#716BFF',
  blueSoft: '#E8E7FF',
  coral: '#FF6B57',
  coralDeep: '#C2371E',
  coralSoft: '#FFE5DE',
  mint: '#A9F4DE',
  mintDeep: '#087A5B',
  mintSoft: '#DCFBF1',
  saffron: '#C8F04B',
  saffronDeep: '#5C7500',
  saffronSoft: '#F0FAD0',
  lilac: '#B9B5FF',
  line: '#D7D9D2',
  danger: '#C34245',
} as const;

/**
 * Stage signals: each phase of the Capture → Model → Source → Build flow
 * owns one signal. `main` is the raw signal colour, `deep` is its
 * contrast-safe counterpart for text and fills under white type,
 * and `soft` is the tinted surface behind it.
 */
export const signals = {
  indigo: { main: colors.blue, deep: colors.blue, soft: colors.blueSoft },
  coral: { main: colors.coral, deep: colors.coralDeep, soft: colors.coralSoft },
  mint: { main: colors.mint, deep: colors.mintDeep, soft: colors.mintSoft },
  saffron: { main: colors.saffron, deep: colors.saffronDeep, soft: colors.saffronSoft },
} as const;

export type SignalName = keyof typeof signals;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 32,
  huge: 44,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/** Soft modern elevation (maps to box-shadow on web). */
export const shadow = {
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  cta: {
    shadowColor: colors.blue,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

export const type = {
  display: {
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '800' as const,
    letterSpacing: -2,
  },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '800' as const,
    letterSpacing: -1,
  },
  heading: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500' as const,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
  },
  micro: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
  },
} as const;
