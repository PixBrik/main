import { StyleSheet, Text, View } from 'react-native';

import { ChoiceStrip } from '../components/ChoiceStrip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import type { CaptureMode } from '../types/navigation';
import { colors, radius, spacing, type } from '../theme/tokens';

interface ModeScreenProps {
  value: CaptureMode;
  onChange: (value: CaptureMode) => void;
  onBack: () => void;
  onContinue: () => void;
  full3DAvailable: boolean;
}

export function ModeScreen({ value, onChange, onBack, onContinue, full3DAvailable }: ModeScreenProps) {
  return (
    <ScreenFrame
      accent="coral"
      eyebrow="1 / Capture mode"
      footer={
        <PrimaryButton
          disabled={value === 'orbit' && !full3DAvailable}
          label={
            value === 'photo'
              ? 'Create my flat panel'
              : full3DAvailable
                ? 'Start 4 guided photos'
                : 'True 3D is unavailable here'
          }
          onPress={onContinue}
        />
      }
      onBack={onBack}
      progress={0.12}
      subtitle="These are two different products: a photo-faithful flat panel, or a provider-generated 3D mesh that is approved before we turn it into bricks."
      title="Choose flat or true 3D."
    >
      <View accessibilityRole="radiogroup">
        <ChoiceStrip
          accent="coral"
          description="One photo becomes a dense, two-layer colour mosaic. No shape guessing; this is the closest match to the original image."
          meta="FLAT · BEST LIKENESS"
          onPress={() => onChange('photo')}
          selected={value === 'photo'}
          title="Flat photo panel"
        />
        <ChoiceStrip
          accent="mint"
          description="Four real views are required for people and give objects the highest accuracy. They replace one-photo hidden-side guesses with front, left, back and right evidence."
          disabled={!full3DAvailable}
          meta={full3DAvailable ? 'API MESH · ALL SIDES' : 'API NOT CONFIGURED'}
          onPress={() => onChange('orbit')}
          selected={value === 'orbit'}
          title="True 3D sculpture"
        />
      </View>
      <View style={[styles.pipeline, value === 'orbit' && styles.pipeline3D]}>
        <Text style={styles.pipelineLabel}>{value === 'photo' ? 'FLAT PIPELINE' : 'TRUE 3D PIPELINE'}</Text>
        <Text style={styles.pipelineText}>
          {value === 'photo'
            ? 'PHOTO  →  COLOUR GRID  →  CATALOG BRICKS'
            : '4 PHOTOS  →  TRIPO MULTIVIEW MESH  →  APPROVE  →  CATALOG BRICKS'}
        </Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  pipeline: {
    backgroundColor: colors.coralSoft,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginTop: spacing.sm,
    padding: spacing.lg,
  },
  pipeline3D: {
    backgroundColor: colors.mintSoft,
  },
  pipelineLabel: {
    ...type.micro,
    color: colors.inkSoft,
    letterSpacing: 1,
  },
  pipelineText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 20,
    marginTop: spacing.sm,
  },
});
