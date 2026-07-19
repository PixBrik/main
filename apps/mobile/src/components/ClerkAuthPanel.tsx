import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme/tokens';

/** Native prebuilt Clerk UI requires a new development build; fail honestly in Expo Go. */
export function ClerkAuthPanel() {
  return (
    <View accessibilityRole="alert" style={styles.card}>
      <Text style={styles.title}>NATIVE SIGN-IN ISN'T IN THIS BUILD YET</Text>
      <Text style={styles.body}>
        Use the PixBrik web app to sign in for now. This native app build also has no local build or
        demo-order storage; use the web app for browser-local saving.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: spacing.lg,
  },
  title: { ...type.label, color: colors.ink },
  body: { ...type.body, color: colors.inkSoft, fontSize: 13, marginTop: spacing.sm },
});
