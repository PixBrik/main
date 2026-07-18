import { StyleSheet, Text, View } from 'react-native';

import { OptionChips, type ChipOption } from '../components/OptionChips';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { TargetSize } from '../types/navigation';

interface PreferencesScreenProps {
  size: TargetSize;
  onSizeChange: (value: TargetSize) => void;
  onBack: () => void;
  onContinue: () => void;
}

const sizeOptions: readonly ChipOption<TargetSize>[] = [
  { id: 'desk', label: 'Mini · up to 16 cm' },
  { id: 'shelf', label: 'Classic · up to 26 cm' },
  { id: 'statement', label: 'Showcase · up to 38 cm' },
];

export type PreferenceVariantId = 'easy' | 'balanced' | 'detail';

/** Standard stud pitch ties silhouette resolution honestly to finished size. */
export function variantForPreferences(size: TargetSize): PreferenceVariantId {
  return ({ desk: 'easy', shelf: 'balanced', statement: 'detail' } as const)[size];
}

const PROFILE_LABEL: Record<PreferenceVariantId, string> = {
  easy: 'Mini',
  balanced: 'Classic',
  detail: 'Showcase',
};

export function PreferencesScreen({
  size,
  onSizeChange,
  onBack,
  onContinue,
}: PreferencesScreenProps) {
  const initialProfile = variantForPreferences(size);
  return (
    <ScreenFrame
      eyebrow="3 / Tune the build"
      footer={<PrimaryButton label="Open my preview" onPress={onContinue} />}
      onBack={onBack}
      progress={0.38}
      subtitle="Choose a real finished size. Standard 8 mm studs mean a larger sculpture can carry more likeness detail; the next screen shows exact dimensions, parts and price."
      title="Make it yours."
    >
      <OptionChips accent="coral" label="Finished size" onChange={onSizeChange} options={sizeOptions} value={size} />
      <View style={styles.recipe}>
        <Text style={styles.recipeLabel}>OPENS FIRST</Text>
        <Text style={styles.recipeTitle}>{PROFILE_LABEL[initialProfile]} profile</Text>
        <Text style={styles.recipeBody}>
          Your selected colours stay unchanged. Compare every real size with hollow and solid pricing next.
        </Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  recipe: {
    backgroundColor: colors.panelDark,
    borderLeftColor: colors.saffron,
    borderLeftWidth: 5,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  recipeLabel: {
    ...type.micro,
    color: colors.saffron,
    letterSpacing: 1,
  },
  recipeTitle: {
    ...type.heading,
    color: colors.white,
    marginTop: spacing.xs,
    textTransform: 'capitalize',
  },
  recipeBody: {
    ...type.body,
    color: '#C5CAD3',
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
});
