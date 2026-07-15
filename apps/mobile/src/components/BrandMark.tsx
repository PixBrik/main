import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { whenVisible } from '../lib/whenVisible';
import { colors, fonts } from '../theme/tokens';

export type BrandMarkVariant = 'compact' | 'full';
export type BrandMarkTone = 'light' | 'dark' | 'inverse';

export interface BrandMarkProps {
  accessibilityLabel?: string;
  /** Cap height of the wordmark in px. */
  size?: number;
  style?: StyleProp<ViewStyle>;
  tone?: BrandMarkTone;
  variant?: BrandMarkVariant;
  animated?: boolean;
}

const LETTERS = ['P', 'I', 'X', 'B', 'R', 'I', 'K'] as const;
/** The two I's carry the alarm accent — the brand's only colour moment. */
const ALARM_INDICES = new Set([1, 5]);

/**
 * PixBrik "Press" wordmark: all-caps Archivo Black tracked tight, alarm I's,
 * four ink studs beneath (a 2×4 brick seen from above). Letters press up
 * from a clipped line-box; studs pop in after.
 */
export function BrandMark({
  accessibilityLabel = 'PixBrik',
  size = 20,
  style,
  tone = 'light',
  variant = 'full',
  animated = true,
}: BrandMarkProps) {
  const letterColor = tone === 'light' ? colors.ink : colors.saffron;
  const studColor = tone === 'light' ? colors.ink : colors.saffron;

  const rise = useRef(LETTERS.map(() => new Animated.Value(animated ? 1 : 0))).current;
  const studPop = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (!animated) return;
    return whenVisible(
      () => {
        Animated.stagger(
          55,
          rise.map((value) =>
            Animated.timing(value, {
              duration: 460,
              easing: Easing.bezier(0.22, 1, 0.36, 1),
              toValue: 0,
              useNativeDriver: true,
            }),
          ),
        ).start();
        Animated.sequence([
          Animated.delay(420),
          Animated.spring(studPop, {
            friction: 5,
            tension: 220,
            toValue: 1,
            useNativeDriver: true,
          }),
        ]).start();
      },
      () => {
        rise.forEach((value) => value.setValue(0));
        studPop.setValue(1);
      },
    );
  }, [animated, rise, studPop]);

  const lineHeight = size * 1.14;
  const stud = Math.max(3.5, size * 0.24);
  const studGap = Math.max(3, size * 0.18);

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={[styles.container, style]}
    >
      {/* Clipped line-box: letters translate up into view. */}
      <View style={[styles.lineBox, { height: lineHeight }]}>
        {LETTERS.map((letter, index) => (
          <Animated.Text
            key={index}
            style={{
              color: ALARM_INDICES.has(index) ? colors.alarm : letterColor,
              fontFamily: fonts.display,
              fontSize: size,
              letterSpacing: -size * 0.1,
              lineHeight,
              transform: [
                {
                  translateY: rise[index]!.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, lineHeight * 1.1],
                  }),
                },
              ],
            }}
          >
            {letter}
          </Animated.Text>
        ))}
      </View>

      {variant === 'full' ? (
        <View style={[styles.studRow, { gap: studGap, marginTop: Math.max(3, size * 0.2) }]}>
          {[0, 1, 2, 3].map((index) => (
            <Animated.View
              key={index}
              style={{
                backgroundColor: studColor,
                borderRadius: stud,
                height: stud,
                transform: [
                  {
                    scale: studPop.interpolate({
                      inputRange: [0, 0.2 + index * 0.09, 0.65 + index * 0.09, 1],
                      outputRange: [0, 0, 1.15, 1],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
                width: stud,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
  },
  lineBox: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  studRow: {
    flexDirection: 'row',
    paddingLeft: 2,
  },
});
