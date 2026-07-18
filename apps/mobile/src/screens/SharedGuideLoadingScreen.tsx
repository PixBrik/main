import { StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, spacing, type } from '../theme/tokens';

interface SharedGuideLoadingScreenProps {
  error?: string;
  onBack: () => void;
}

export function SharedGuideLoadingScreen({ error, onBack }: SharedGuideLoadingScreenProps) {
  return (
    <ScreenFrame
      eyebrow="Phone build guide"
      footer={error ? <PrimaryButton label="Back to PixBrik" onPress={onBack} /> : undefined}
      onBack={onBack}
      progress={error ? 0 : 0.7}
      subtitle={
        error
          ? 'The guide link may have expired or the published build is unavailable.'
          : 'Loading the frozen catalog pieces and the exact one-piece-at-a-time plan. No local order history is required.'
      }
      title={error ? 'This guide could not open.' : 'Opening your build.'}
    >
      {error ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorTitle}>GUIDE UNAVAILABLE</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <InkLoader dots progress={0.7} size={52} stage="Loading phone guide" />
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  errorCard: {
    backgroundColor: colors.white,
    borderColor: colors.alarm,
    borderWidth: 2,
    padding: spacing.xl,
  },
  errorTitle: { ...type.label, color: colors.alarm },
  errorText: { ...type.body, color: colors.ink, marginTop: spacing.sm },
});
