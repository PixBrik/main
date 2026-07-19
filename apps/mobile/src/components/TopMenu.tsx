import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BricklingAvatar } from './BricklingAvatar';
import { useAppNavigation } from '../lib/navigationContext';
import { LEGAL_CONTENT_AVAILABLE } from '../lib/legalAvailability';
import { usePixBrikAuth } from '../lib/pixbrikAuth';
import { colors, fonts, radius, shadow, spacing } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

const MENU_ITEMS: ReadonlyArray<{ label: string; screen: DemoScreen }> = [
  { label: 'HOME', screen: 'home' },
  { label: 'CREATE A BUILD', screen: 'mode' },
  { label: 'OBJECT LIBRARY', screen: 'library' },
  ...(LEGAL_CONTENT_AVAILABLE
    ? ([{ label: 'LEGAL & CONTACT', screen: 'legal' }] as const)
    : ([{ label: 'CONTACT', screen: 'contact' }] as const)),
];

/**
 * Global top-right chrome: explicit sign-in or Brickling identity + menu.
 * The identity control opens the account and device-local order screen.
 */
export function TopMenu({ disabled = false }: { disabled?: boolean }) {
  const navigate = useAppNavigation();
  const auth = usePixBrikAuth();
  const [open, setOpen] = useState(false);
  const shortName =
    auth.user?.displayName.trim().split(/\s+/)[0] ||
    auth.user?.email?.split('@')[0] ||
    'Builder';

  const closeAll = () => {
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={
            auth.loaded && auth.isSignedIn
              ? `Open account for ${auth.user?.displayName ?? 'PixBrik builder'}`
              : 'Open account'
          }
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            setOpen(false);
            navigate('account');
          }}
          style={({ pressed }) => [styles.accountButton, auth.isSignedIn && styles.accountButtonSignedIn, pressed && styles.pressed]}
        >
          {auth.loaded && auth.isSignedIn && auth.user ? (
            <>
              <BricklingAvatar
                decorative
                label={auth.user.displayName}
                seed={auth.user.id}
                size={28}
              />
              <Text numberOfLines={1} style={styles.accountName}>{shortName}</Text>
            </>
          ) : (
            <Text style={styles.signInText}>
              {!auth.configured ? 'ACCOUNT' : auth.loaded ? 'SIGN IN' : 'ACCOUNT…'}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Menu"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            setOpen((current) => !current);
          }}
          style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
        >
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
        </Pressable>
      </View>

      {open && !disabled ? (
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
  accountButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 40,
    justifyContent: 'center',
    minWidth: 84,
    paddingHorizontal: spacing.md,
    ...shadow.card,
  },
  accountButtonSignedIn: {
    justifyContent: 'flex-start',
    maxWidth: 156,
    paddingLeft: 5,
  },
  menuButton: {
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
  signInText: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  accountName: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 11,
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
