import { SignIn } from '@clerk/expo/web';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme/tokens';

export function ClerkAuthPanel() {
  return (
    <View accessibilityLabel="Sign in or create a PixBrik account" style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>SIGN IN OR CREATE AN ACCOUNT</Text>
      <Text style={styles.note}>
        Signing in identifies you securely. Existing builds and demo orders below remain device-only
        until server sync is implemented.
      </Text>
      <View style={styles.clerkSurface}>
        <SignIn
          fallback={<Text style={styles.loading}>Loading secure sign-in…</Text>}
          fallbackRedirectUrl="/account"
          path="/account"
          routing="path"
          signUpFallbackRedirectUrl="/account"
          withSignUp
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.lg,
  },
  heading: { ...type.heading, color: colors.ink, fontSize: 18 },
  note: { ...type.body, color: colors.inkSoft, fontSize: 13, marginTop: spacing.sm },
  clerkSurface: { alignItems: 'center', marginTop: spacing.lg, minHeight: 280 },
  loading: { ...type.body, color: colors.inkSoft, padding: spacing.xl },
});
