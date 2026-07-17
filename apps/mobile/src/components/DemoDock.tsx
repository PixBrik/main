import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface DemoDockProps {
  active: DemoScreen;
  /** Keep the current Result tab available while downstream build data is pending. */
  downstreamDisabled?: boolean;
  onNavigate: (screen: DemoScreen) => void;
}

const items: ReadonlyArray<{ screen: DemoScreen; label: string; mark: string; accent: string }> = [
  { screen: 'result', label: '3D', mark: '◫', accent: colors.blueBright },
  { screen: 'bom', label: 'Parts', mark: '≡', accent: colors.coral },
  { screen: 'purchase', label: 'Source', mark: '↗', accent: colors.mint },
  { screen: 'instructions', label: 'Build', mark: '///', accent: colors.saffron },
];

export function DemoDock({ active, downstreamDisabled = false, onNavigate }: DemoDockProps) {
  return (
    <View accessibilityLabel="Build navigation" accessibilityRole="tablist" style={styles.dock}>
      {items.map((item) => {
        const selected = item.screen === active || (active === 'stores' && item.screen === 'purchase');
        const disabled = downstreamDisabled && item.screen !== 'result';
        return (
          <Pressable
            aria-disabled={disabled}
            aria-selected={selected}
            accessibilityRole="tab"
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            key={item.screen}
            onPress={() => onNavigate(item.screen)}
            style={({ pressed }) => [
              styles.item,
              selected && [styles.itemSelected, { borderBottomColor: item.accent }],
              disabled && styles.itemDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.mark, selected && { color: item.accent }]}>{item.mark}</Text>
            <Text style={[styles.label, selected && styles.labelSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: colors.panelDark,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 2,
    padding: spacing.xs,
  },
  item: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    flex: 1,
    justifyContent: 'center',
    minHeight: 53,
    paddingVertical: 5,
  },
  itemSelected: {
    backgroundColor: colors.panelRaise,
  },
  itemDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.75,
  },
  mark: {
    color: '#AEB5C7',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  label: {
    ...type.micro,
    color: '#AEB5C7',
    marginTop: 2,
  },
  labelSelected: {
    color: colors.white,
  },
});
