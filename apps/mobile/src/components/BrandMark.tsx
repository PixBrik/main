import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { whenVisible } from '../lib/whenVisible';
import { colors, signals } from '../theme/tokens';

export type BrandMarkVariant = 'compact' | 'full';
export type BrandMarkTone = 'light' | 'dark' | 'inverse';

export interface BrandMarkProps {
  accessibilityLabel?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  tone?: BrandMarkTone;
  variant?: BrandMarkVariant;
  /** Disable the looping pixel animation (e.g. for print/export contexts). */
  animated?: boolean;
}

const tonePalette: Record<
  BrandMarkTone,
  { accent: string; tile: string; muted: string; text: string; stud: string }
> = {
  light: {
    accent: colors.blue,
    tile: colors.ink,
    muted: colors.inkSoft,
    text: colors.ink,
    stud: colors.ink,
  },
  dark: {
    accent: '#8392FF',
    tile: '#111915',
    muted: '#B9C3BD',
    text: colors.white,
    stud: '#111915',
  },
  inverse: {
    accent: colors.white,
    tile: 'rgba(255,255,255,0.16)',
    muted: colors.white,
    text: colors.white,
    stud: 'rgba(255,255,255,0.16)',
  },
};

/** The four "pixels" — one per stage signal, in flow order. */
const PIXELS = [signals.coral.main, signals.indigo.main, signals.mint.main, signals.saffron.main];

/**
 * PixBrik logo: a brick-shaped tile (two studs on top) holding a 2×2 grid of
 * signal-colour pixels — pixels becoming a brick. Pixels pop in staggered on
 * mount, then gently pulse in sequence on a slow loop.
 */
export function BrandMark({
  accessibilityLabel = 'PixBrik — pixels to bricks',
  size = 42,
  style,
  tone = 'light',
  variant = 'full',
  animated = true,
}: BrandMarkProps) {
  const palette = tonePalette[tone];
  const isInverse = tone === 'inverse';

  // One intro driver (0→1) and one looping pulse driver (0→1); each pixel
  // reads its own window of the drivers. Pixels default to scale 1, so the
  // logo stays visible even if animations never run.
  const intro = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return;
    const introAnim = Animated.timing(intro, {
      duration: 620,
      easing: Easing.out(Easing.back(1.6)),
      toValue: 1,
      useNativeDriver: true,
    });
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.delay(3600),
        Animated.timing(pulse, {
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { duration: 0, toValue: 0, useNativeDriver: true }),
      ]),
    );
    const cleanupVisible = whenVisible(
      () =>
        introAnim.start(({ finished }) => {
          if (finished) pulseAnim.start();
        }),
      () => intro.setValue(1),
    );
    return () => {
      cleanupVisible();
      introAnim.stop();
      pulseAnim.stop();
      intro.setValue(1);
      pulse.setValue(0);
    };
  }, [animated, intro, pulse]);

  /** Per-pixel scale: staggered pop-in, then a wave pulse sweeping the grid. */
  const pixelScale = (index: number) => {
    const step = 0.16;
    const from = index * step;
    const introScale = intro.interpolate({
      inputRange: [0, from, Math.min(1, from + 0.5), 1],
      outputRange: [0, 0, 1, 1],
    });
    const start = index * 0.18;
    const pulseScale = pulse.interpolate({
      inputRange: [0, start, start + 0.13, start + 0.3, 1],
      outputRange: [0, 0, 0.24, 0, 0],
      extrapolate: 'clamp',
    });
    return Animated.add(introScale, pulseScale);
  };

  // Geometry derived from `size` (tile is size×size, studs sit above).
  const stud = Math.max(4, size * 0.16);
  const tileRadius = Math.max(4, size * 0.2);
  const pad = Math.max(3, size * 0.12);
  const gap = Math.max(2, size * 0.07);
  const pixel = (size - pad * 2 - gap) / 2;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={[styles.container, style]}
    >
      <View style={{ paddingTop: stud * 0.72 }}>
        <View style={[styles.studRow, { paddingHorizontal: size * 0.18, top: 0 }]}>
          {[0, 1].map((index) => (
            <View
              key={index}
              style={{
                backgroundColor: palette.stud,
                borderRadius: stud * 0.35,
                height: stud,
                width: stud * 1.5,
              }}
            />
          ))}
        </View>
        <View
          style={{
            backgroundColor: palette.tile,
            borderRadius: tileRadius,
            height: size,
            padding: pad,
            width: size,
          }}
        >
          <View style={[styles.pixelGrid, { gap }]}>
            {PIXELS.map((color, index) => (
              <Animated.View
                key={index}
                style={{
                  backgroundColor: isInverse ? colors.white : color,
                  borderRadius: Math.max(2, pixel * 0.3),
                  height: pixel,
                  opacity: isInverse ? 0.55 + index * 0.15 : 1,
                  transform: [{ scale: pixelScale(index) }],
                  width: pixel,
                }}
              />
            ))}
          </View>
        </View>
      </View>

      {variant === 'full' ? (
        <View style={[styles.wordmark, { marginLeft: Math.max(9, size * 0.26) }]}>
          <View style={styles.nameRow}>
            <Text
              maxFontSizeMultiplier={1.2}
              style={[
                styles.name,
                { color: palette.text, fontSize: size * 0.5, lineHeight: size * 0.55 },
              ]}
            >
              PIX
            </Text>
            <Text
              maxFontSizeMultiplier={1.2}
              style={[
                styles.name,
                { color: palette.accent, fontSize: size * 0.5, lineHeight: size * 0.55 },
              ]}
            >
              BRIK
            </Text>
          </View>
          <Text
            maxFontSizeMultiplier={1.15}
            style={[
              styles.signature,
              {
                color: palette.muted,
                fontSize: Math.max(7, size * 0.18),
                lineHeight: Math.max(9, size * 0.22),
              },
            ]}
          >
            PIXELS → BRICKS
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
  },
  studRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'absolute',
    width: '100%',
  },
  pixelGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  wordmark: {
    justifyContent: 'center',
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  name: {
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  signature: {
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 3,
  },
});
