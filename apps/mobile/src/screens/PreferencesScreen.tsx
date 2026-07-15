import { StyleSheet, Text, View } from 'react-native';

import { OptionChips, type ChipOption } from '../components/OptionChips';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DetailLevel, PaletteMode, TargetSize } from '../types/navigation';

interface PreferencesScreenProps {
  size: TargetSize;
  detail: DetailLevel;
  palette: PaletteMode;
  onSizeChange: (value: TargetSize) => void;
  onDetailChange: (value: DetailLevel) => void;
  onPaletteChange: (value: PaletteMode) => void;
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

const paletteOptions: readonly ChipOption<PaletteMode>[] = [
  { id: 'true', label: 'Source colours' },
  { id: 'calm', label: 'Neutral' },
  { id: 'bold', label: 'High contrast' },
];

export function PreferencesScreen({
  size,
  detail,
  palette,
  onSizeChange,
  onDetailChange,
  onPaletteChange,
  onBack,
  onContinue,
}: PreferencesScreenProps) {
  return (
    <ScreenFrame
      eyebrow="3 / Tune the build"
      footer={<PrimaryButton label="Generate build" onPress={onContinue} />}
      onBack={onBack}
      progress={0.38}
      subtitle="These settings guide the first result. You can compare alternate profiles before sourcing."
      title="Set the build profile."
    >
      <OptionChips accent="coral" label="Finished size" onChange={onSizeChange} options={sizeOptions} value={size} />
      <OptionChips accent="indigo" label="Piece detail" onChange={onDetailChange} options={detailOptions} value={detail} />
      <OptionChips accent="mint" label="Colour energy" onChange={onPaletteChange} options={paletteOptions} value={palette} />
      <View style={styles.recipe}>
        <Text style={styles.recipeLabel}>BUILD PROFILE</Text>
        <Text style={styles.recipeTitle}>{size} + {detail} + {palette}</Text>
        <Text style={styles.recipeBody}>Estimated 290–1,400 parts · 2–6 hours by profile</Text>
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
