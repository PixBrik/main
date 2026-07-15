import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, shadow, spacing, type } from '../theme/tokens';

type ButtonVariant = 'blue' | 'ink' | 'paper';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  compact?: boolean;
}

const variantStyles = {
  blue: {
    button: { backgroundColor: colors.blue },
    text: { color: colors.white },
    badge: { backgroundColor: colors.saffron },
    arrow: { color: colors.ink },
    glow: colors.blue,
  },
  ink: {
    button: { backgroundColor: colors.ink },
    text: { color: colors.white },
    badge: { backgroundColor: colors.coral },
    arrow: { color: colors.ink },
    glow: colors.ink,
  },
  paper: {
    button: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1.5 },
    text: { color: colors.ink },
    badge: { backgroundColor: colors.ink },
    arrow: { color: colors.white },
    glow: colors.ink,
  },
} as const;

/** Springy CTA: scales down on press while the arrow badge nudges forward. */
export function PrimaryButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  variant = 'blue',
  compact = false,
}: PrimaryButtonProps) {
  const press = useRef(new Animated.Value(0)).current;
  const animateTo = (toValue: number) =>
    Animated.spring(press, { friction: 6, tension: 260, toValue, useNativeDriver: true }).start();

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  const arrowShift = press.interpolate({ inputRange: [0, 1], outputRange: [0, 4] });
  const styleSet = variantStyles[variant];

  return (
    <Animated.View
      style={[
        { transform: [{ scale }] },
        !disabled && { ...shadow.cta, shadowColor: styleSet.glow },
        disabled && styles.disabled,
      ]}
    >
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animateTo(1)}
        onPressOut={() => animateTo(0)}
        style={[styles.button, compact && styles.compactButton, styleSet.button]}
      >
        <Text style={[styles.label, styleSet.text]}>{label}</Text>
        <Animated.View
          style={[styles.arrowBadge, styleSet.badge, { transform: [{ translateX: arrowShift }] }]}
        >
          <Text style={[styles.arrow, styleSet.arrow]}>→</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
  },
  compactButton: {
    alignSelf: 'flex-start',
    minHeight: 46,
    paddingLeft: spacing.lg,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    ...type.body,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
  arrowBadge: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 36,
    justifyContent: 'center',
    marginLeft: spacing.lg,
    width: 36,
  },
  arrow: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
});
