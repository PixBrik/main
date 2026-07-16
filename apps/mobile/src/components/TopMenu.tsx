import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppNavigation } from '../lib/navigationContext';
import { colors, fonts, radius, saffronAlpha, shadow, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

const MENU_ITEMS: ReadonlyArray<{ label: string; screen: DemoScreen }> = [
  { label: 'HOME', screen: 'home' },
  { label: 'CREATE A BUILD', screen: 'mode' },
  { label: 'OBJECT LIBRARY', screen: 'library' },
  { label: 'MY KIT', screen: 'purchase' },
];

/**
 * Global top-right chrome: account icon + hamburger. The menu is an ink
 * dropdown; the account entry is honest about being device-local for now.
 */
export function TopMenu() {
  const navigate = useAppNavigation();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const closeAll = () => {
    setOpen(false);
    setAccountOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel="My account"
          accessibilityRole="button"
          onPress={() => {
            setAccountOpen((current) => !current);
            setOpen(false);
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
            setAccountOpen(false);
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

      {accountOpen ? (
        <View style={styles.dropdown}>
          <Text style={styles.accountTitle}>MY ACCOUNT</Text>
          <Text style={styles.accountBodyText}>
            Sign-in is coming soon. For now your builds, feedback and kit details live safely on
            this device — nothing is uploaded.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              closeAll();
              navigate('home');
            }}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          >
            <Text style={styles.menuItemText}>MY BUILDS →</Text>
          </Pressable>
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
  accountTitle: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  accountBodyText: {
    ...type.body,
    color: saffronAlpha(0.75),
    fontSize: 12,
    lineHeight: 17,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
});
