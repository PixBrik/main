import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, signals, spacing, type } from '../theme/tokens';

/**
 * Auto-cycling expanding steps: the active step grows and reveals its detail
 * while the others collapse to a compact chip — a dynamic, non-template feel.
 * Tapping a step activates it; the cycle pauses briefly after a manual pick.
 * Pauses entirely under reduced motion (all steps read statically).
 */

const STEPS = [
  { number: '01', title: 'Shoot', body: 'Snap any object — a car, a pet, a face, a plant.', signal: signals.coral },
  { number: '02', title: 'Model', body: 'AI turns it into a real 3D brick build.', signal: signals.indigo },
  { number: '03', title: 'Source', body: 'Real parts and prices, reinforced hollow or solid.', signal: signals.mint },
  { number: '04', title: 'Build', body: 'A prepared kit ships with one-piece-at-a-time steps.', signal: signals.saffron },
] as const;

const CYCLE_MS = 2600;

function StepCard({
  step,
  active,
  reduceMotion,
  onPress,
}: {
  step: (typeof STEPS)[number];
  active: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  const grow = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      grow.setValue(1);
      return;
    }
    Animated.timing(grow, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: active ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }, [active, grow, reduceMotion]);

  // Active step takes ~2.6× the width of a collapsed one.
  const flex = reduceMotion ? 1.6 : grow.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const bodyOpacity = reduceMotion ? 1 : grow;
  const expanded = active || reduceMotion;

  return (
    <Animated.View style={[styles.cardOuter, { flex }]}>
      <Pressable
        accessibilityLabel={`Step ${step.number}: ${step.title}. ${step.body}`}
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.card, { backgroundColor: expanded ? step.signal.soft : colors.white }]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.numberDot, { backgroundColor: step.signal.main }]}>
            <Text style={styles.numberText}>{step.number}</Text>
          </View>
          {expanded ? <Text style={[styles.title, { color: step.signal.deep }]}>{step.title}</Text> : null}
        </View>
        {expanded ? (
          <Animated.Text numberOfLines={3} style={[styles.body, { opacity: bodyOpacity }]}>
            {step.body}
          </Animated.Text>
        ) : (
          <Text style={styles.collapsedTitle}>{step.title}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function HowItWorks() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [active, setActive] = useState(0);
  const holdUntil = useRef(0);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => mounted && enabled && setReduceMotion(true))
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      setActive((current) => (current + 1) % STEPS.length);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const select = useMemo(
    () => (index: number) => {
      holdUntil.current = Date.now() + 6000;
      setActive(index);
    },
    [],
  );

  return (
    <View accessibilityLabel="How it works, four steps" style={styles.wrap}>
      <Text style={styles.label}>HOW IT WORKS</Text>
      <View style={styles.row}>
        {STEPS.map((step, index) => (
          <StepCard
            active={index === active}
            key={step.number}
            onPress={() => select(index)}
            reduceMotion={reduceMotion}
            step={step}
          />
        ))}
      </View>
      {!reduceMotion ? (
        <View accessibilityElementsHidden pointerEvents="none" style={styles.dots}>
          {STEPS.map((step, index) => (
            <View
              key={step.number}
              style={[styles.dot, index === active && { backgroundColor: step.signal.main, width: 16 }]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
  },
  label: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardOuter: {
    minWidth: 0,
  },
  card: {
    borderRadius: radius.md,
    minHeight: 96,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  cardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  numberDot: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  numberText: {
    color: colors.ink,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  title: {
    ...type.body,
    fontSize: 14,
    fontWeight: '900',
  },
  body: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  collapsedTitle: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 8,
    letterSpacing: 0.4,
    marginTop: spacing.sm,
    textTransform: 'none',
  },
  dots: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: spacing.md,
  },
  dot: {
    backgroundColor: colors.line,
    borderRadius: 3,
    height: 5,
    width: 5,
  },
});
