import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, signals, spacing, type, type SignalName } from '../theme/tokens';

export interface ChipOption<T extends string> {
  id: T;
  label: string;
}

interface OptionChipsProps<T extends string> {
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accent?: SignalName;
}

export function OptionChips<T extends string>({
  label,
  options,
  value,
  onChange,
  accent = 'indigo',
}: OptionChipsProps<T>) {
  const signal = signals[accent];

  return (
    <View accessibilityRole="radiogroup" style={styles.group}>
      <View style={styles.labelRow}>
        <View style={[styles.labelTick, { backgroundColor: signal.main }]} />
        <Text style={styles.label}>{label.toUpperCase()}</Text>
      </View>
      <View style={styles.row}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.id}
              onPress={() => onChange(option.id)}
              style={({ pressed }) => [
                styles.chip,
                selected && { backgroundColor: signal.deep, borderColor: colors.ink },
                pressed && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    marginBottom: spacing.xl,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  labelTick: {
    borderRadius: 1,
    height: 9,
    width: 9,
  },
  label: {
    ...type.label,
    color: colors.inkSoft,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chipPressed: {
    opacity: 0.72,
  },
  chipText: {
    ...type.body,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 17,
  },
  chipTextSelected: {
    color: colors.white,
  },
});
