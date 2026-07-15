import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface DemoDockProps {
  active: DemoScreen;
  onNavigate: (screen: DemoScreen) => void;
}

const items: ReadonlyArray<{ screen: DemoScreen; label: string; mark: string; accent: string }> = [
  { screen: 'result', label: '3D', mark: '◫', accent: colors.blueBright },
  { screen: 'bom', label: 'Parts', mark: '≡', accent: colors.coral },
  { screen: 'purchase', label: 'Source', mark: '↗', accent: colors.mint },
  { screen: 'instructions', label: 'Build', mark: '///', accent: colors.saffron },
];

export function DemoDock({ active, onNavigate }: DemoDockProps) {
  return (
    <View accessibilityLabel="Build navigation" accessibilityRole="tablist" style={styles.dock}>
      {items.map((item) => {
        const selected = item.screen === active || (active === 'stores' && item.screen === 'purchase');
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item.screen}
            onPress={() => onNavigate(item.screen)}
            style={({ pressed }) => [
              styles.item,
              selected && [styles.itemSelected, { borderBottomColor: item.accent }],
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
