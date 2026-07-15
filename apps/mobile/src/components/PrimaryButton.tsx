import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts, radius, spacing } from '../theme/tokens';

/**
 * Slab button (Saffron Press): flat, loud, scales on press — geometry only,
 * no colour change, except the outline variant which inverts to ink.
 * Legacy variant names map onto the new kit: blue → ink, paper → outline.
 */
type ButtonVariant = 'ink' | 'saffron' | 'outline' | 'blue' | 'paper';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  compact?: boolean;
}

function resolveVariant(variant: ButtonVariant): 'ink' | 'saffron' | 'outline' {
  if (variant === 'blue') return 'ink';
  if (variant === 'paper') return 'outline';
  return variant;
}

export function PrimaryButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  variant = 'ink',
  compact = false,
}: PrimaryButtonProps) {
  const kind = resolveVariant(variant);
  const press = useRef(new Animated.Value(0)).current;
  const [pressed, setPressed] = useState(false);
  const animateTo = (toValue: number) =>
    Animated.spring(press, { friction: 6, tension: 300, toValue, useNativeDriver: true }).start();

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const inverted = kind === 'outline' && pressed;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, disabled && styles.disabled]}>
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          animateTo(1);
        }}
        onPressOut={() => {
          setPressed(false);
          animateTo(0);
        }}
        style={[
          styles.slab,
          compact && styles.compact,
          kind === 'ink' && styles.ink,
          kind === 'saffron' && styles.saffron,
          kind === 'outline' && styles.outline,
          inverted && styles.ink,
        ]}
      >
        <Text
          style={[
            styles.label,
            compact && styles.labelCompact,
            { color: kind === 'saffron' && !inverted ? colors.ink : kind === 'outline' && !inverted ? colors.ink : colors.saffron },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slab: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.xl,
  },
  compact: {
    alignSelf: 'flex-start',
    minHeight: 46,
    paddingHorizontal: spacing.lg,
  },
  ink: {
    backgroundColor: colors.ink,
  },
  saffron: {
    backgroundColor: colors.saffron,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: colors.ink,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  disabled: {
    opacity: 0.3,
  },
  label: {
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: -0.3,
    textTransform: 'uppercase',
  },
  labelCompact: {
    fontSize: 14,
  },
});
