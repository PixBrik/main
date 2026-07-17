import { StyleSheet, Text, View } from 'react-native';

import { OptionChips, type ChipOption } from '../components/OptionChips';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DetailLevel, TargetSize } from '../types/navigation';

interface PreferencesScreenProps {
  size: TargetSize;
  detail: DetailLevel;
  onSizeChange: (value: TargetSize) => void;
  onDetailChange: (value: DetailLevel) => void;
  onBack: () => void;
  onContinue: () => void;
}

const sizeOptions: readonly ChipOption<TargetSize>[] = [
  { id: 'desk', label: 'Desk · 12 cm' },
  { id: 'shelf', label: 'Shelf · 18 cm' },
  { id: 'statement', label: 'Large · 32 cm' },
];

const detailOptions: readonly ChipOption<DetailLevel>[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'intricate', label: 'High detail' },
];

export type PreferenceVariantId = 'easy' | 'balanced' | 'detail';

/** Size sets the baseline; detail nudges it one real engine profile. */
export function variantForPreferences(
  size: TargetSize,
  detail: DetailLevel,
): PreferenceVariantId {
  const sizeIndex: Record<TargetSize, number> = { desk: 0, shelf: 1, statement: 2 };
  const detailOffset: Record<DetailLevel, number> = { simple: -1, balanced: 0, intricate: 1 };
  const index = Math.max(0, Math.min(2, sizeIndex[size] + detailOffset[detail]));
  return (['easy', 'balanced', 'detail'] as const)[index]!;
}

const PROFILE_LABEL: Record<PreferenceVariantId, string> = {
  easy: 'Efficient',
  balanced: 'Balanced',
  detail: 'Detailed',
};

export function PreferencesScreen({
  size,
  detail,
  onSizeChange,
  onDetailChange,
  onBack,
  onContinue,
}: PreferencesScreenProps) {
  const initialProfile = variantForPreferences(size, detail);
  return (
    <ScreenFrame
      eyebrow="3 / Tune the build"
      footer={<PrimaryButton label="Open my preview" onPress={onContinue} />}
      onBack={onBack}
      progress={0.38}
      subtitle="Choose the starting size and piece detail. Your preview is already built, and the next screen compares all three real profiles."
      title="Make it yours."
    >
      <OptionChips accent="coral" label="Finished size" onChange={onSizeChange} options={sizeOptions} value={size} />
      <OptionChips accent="indigo" label="Piece detail" onChange={onDetailChange} options={detailOptions} value={detail} />
      <View style={styles.recipe}>
        <Text style={styles.recipeLabel}>OPENS FIRST</Text>
        <Text style={styles.recipeTitle}>{PROFILE_LABEL[initialProfile]} profile</Text>
        <Text style={styles.recipeBody}>
          Your selected style stays unchanged. Compare all profiles with actual part counts and prices next.
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
