import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppNavigation } from '../lib/navigationContext';
import { LEGAL_CONTENT_AVAILABLE } from '../lib/legalAvailability';
import { colors, fonts, radius, shadow, spacing } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

const MENU_ITEMS: ReadonlyArray<{ label: string; screen: DemoScreen }> = [
  { label: 'HOME', screen: 'home' },
  { label: 'CREATE A BUILD', screen: 'mode' },
  { label: 'OBJECT LIBRARY', screen: 'library' },
  { label: 'MY KIT', screen: 'purchase' },
  { label: 'MODEL LAB (BETA)', screen: 'lab' },
  ...(LEGAL_CONTENT_AVAILABLE
    ? ([{ label: 'LEGAL & CONTACT', screen: 'legal' }] as const)
    : ([{ label: 'CONTACT', screen: 'contact' }] as const)),
];

/**
 * Global top-right chrome: account icon + hamburger. The menu is an ink
 * dropdown; the profile icon opens the persistent orders/account screen.
 */
export function TopMenu() {
  const navigate = useAppNavigation();
  const [open, setOpen] = useState(false);

  const closeAll = () => {
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel="My account"
          accessibilityRole="button"
          onPress={() => {
            setOpen(false);
            navigate('account');
          }}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          {/* Head + shoulders glyph, pure Views. */}
          <View style={styles.accountHead} />
          <View style={styles.accountBody} />
        </Pressable>
        <Pressable
          accessibilityLabel="Menu"
          accessibilityRole="button"
          onPress={() => {
            setOpen((current) => !current);
          }}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
        </Pressable>
      </View>

      {open ? (
        <View style={styles.dropdown}>
          {MENU_ITEMS.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.screen}
              onPress={() => {
                closeAll();
                navigate(item.screen);
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            >
              <Text style={styles.menuItemText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    zIndex: 40,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    gap: 3,
    height: 40,
    justifyContent: 'center',
    width: 40,
    ...shadow.card,
  },
  pressed: {
    transform: [{ scale: 0.94 }],
  },
  accountHead: {
    backgroundColor: colors.ink,
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  accountBody: {
    backgroundColor: colors.ink,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    height: 7,
    width: 16,
  },
  burgerBar: {
    backgroundColor: colors.ink,
    borderRadius: 2,
    height: 2.5,
    width: 16,
  },
  dropdown: {
    ...shadow.dock,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    minWidth: 220,
    padding: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 48,
    zIndex: 50,
  },
  menuItem: {
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  menuItemPressed: {
    backgroundColor: '#241E10',
  },
  menuItemText: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
