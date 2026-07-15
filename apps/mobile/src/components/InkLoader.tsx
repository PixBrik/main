import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { whenVisible } from '../lib/whenVisible';
import { colors, fonts, inkAlpha, spacing } from '../theme/tokens';

interface InkLoaderProps {
  /** 0–1. Omit for an indeterminate loop. */
  progress?: number;
  /** Stage label under the percentage, e.g. "Matching parts". */
  stage?: string;
  /** Wordmark cap height. */
  size?: number;
  /** Show the four pulsing dots (full-screen variant). */
  dots?: boolean;
}

const WORD = 'PIXBRIK';

/**
 * Branded wait state: the wordmark fills with ink from the baseline upward
 * as progress rises — a faint ghost of the word sits behind, the solid word
 * is revealed by a rising clip window, and a thin "meniscus" bar sloshes on
 * the surface. Percentage counts up (never jumps); stage label crossfades.
 */
export function InkLoader({ progress, stage, size = 44, dots = false }: InkLoaderProps) {
  const fill = useRef(new Animated.Value(0)).current;
  const slosh = useRef(new Animated.Value(0)).current;
  const dotPulse = useRef(new Animated.Value(0)).current;
  const [percentText, setPercentText] = useState(0);
  const indeterminate = progress === undefined;

  const wordHeight = size * 1.16;

  // Fill follows progress (tweened) or loops when indeterminate.
  useEffect(() => {
    if (indeterminate) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(fill, {
            duration: 1800,
            easing: Easing.inOut(Easing.quad),
            toValue: 1,
            useNativeDriver: false,
          }),
          Animated.timing(fill, { duration: 0, toValue: 0, useNativeDriver: false }),
        ]),
      );
      const cleanup = whenVisible(
        () => loop.start(),
        () => fill.setValue(0.6),
      );
      return () => {
        cleanup();
        loop.stop();
      };
    }
    Animated.timing(fill, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: progress,
      useNativeDriver: false,
    }).start();
    return undefined;
  }, [fill, indeterminate, progress]);

  // Percentage readout tracks the animated fill so numbers never jump.
  useEffect(() => {
    const id = fill.addListener(({ value }) => setPercentText(Math.round(value * 100)));
    return () => fill.removeListener(id);
  }, [fill]);

  // Meniscus slosh + dot pulse loops.
  useEffect(() => {
    const sloshLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(slosh, {
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(slosh, {
          duration: 800,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const dotsLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, { duration: 900, toValue: 1, useNativeDriver: true }),
        Animated.timing(dotPulse, { duration: 900, toValue: 0, useNativeDriver: true }),
      ]),
    );
    const cleanup = whenVisible(
      () => {
        sloshLoop.start();
        if (dots) dotsLoop.start();
      },
      () => undefined,
    );
    return () => {
      cleanup();
      sloshLoop.stop();
      dotsLoop.stop();
    };
  }, [dotPulse, dots, slosh]);

  const fillHeight = fill.interpolate({
    inputRange: [0, 1],
    outputRange: [0, wordHeight],
  });

  const wordStyle = {
    fontFamily: fonts.display,
    fontSize: size,
    letterSpacing: -size * 0.08,
    lineHeight: wordHeight,
  } as const;

  return (
    <View style={styles.container}>
      <View style={{ height: wordHeight }}>
        {/* Ghost word — the "empty" outline state. */}
        <Text style={[wordStyle, { color: inkAlpha(0.16) }]}>{WORD}</Text>
        {/* Rising clip window revealing the solid word from the baseline up. */}
        <Animated.View style={[styles.fillWindow, { height: fillHeight }]}>
          <View style={[styles.fillAnchor, { height: wordHeight }]}>
            <Text style={[wordStyle, { color: colors.ink }]}>{WORD}</Text>
          </View>
          {/* Meniscus riding the surface. */}
          <Animated.View
            style={[
              styles.meniscus,
              {
                transform: [
                  {
                    rotate: slosh.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-1.2deg', '1.2deg'],
                    }),
                  },
                ],
              },
            ]}
          />
        </Animated.View>
      </View>

      <View style={styles.readout}>
        <Text style={styles.percent}>{indeterminate ? '' : `${percentText}%`}</Text>
        {stage ? <Text style={styles.stage}>{stage}</Text> : null}
      </View>

      {dots ? (
        <View style={styles.dotRow}>
          {[0, 1, 2, 3].map((index) => (
            <Animated.View
              key={index}
              style={[
                styles.dot,
                {
                  opacity: dotPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: index % 2 === 0 ? [1, 0.15] : [0.15, 1],
                  }),
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  fillWindow: {
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
  },
  fillAnchor: {
    justifyContent: 'flex-end',
  },
  meniscus: {
    backgroundColor: colors.ink,
    borderRadius: 6,
    height: 10,
    left: -6,
    position: 'absolute',
    right: -6,
    top: -4,
  },
  readout: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    minHeight: 30,
  },
  percent: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  stage: {
    color: inkAlpha(0.72),
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  dotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  dot: {
    backgroundColor: colors.ink,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
});
