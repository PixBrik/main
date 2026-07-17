import { View } from 'react-native';

import { ChoiceStrip } from '../components/ChoiceStrip';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import type { CaptureMode } from '../types/navigation';

interface ModeScreenProps {
  value: CaptureMode;
  onChange: (value: CaptureMode) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function ModeScreen({ value, onChange, onBack, onContinue }: ModeScreenProps) {
  return (
    <ScreenFrame
      accent="coral"
      eyebrow="1 / Capture mode"
      footer={
        <PrimaryButton
          label={value === 'photo' ? 'Preview my photo' : 'Start 4 guided photos'}
          onPress={onContinue}
        />
      }
      onBack={onBack}
      progress={0.12}
      subtitle="One clear photo makes the most faithful front-facing panel. Four guided views give the 3D generator the sides and back too."
      title="Choose likeness or full 3D."
    >
      <View accessibilityRole="radiogroup">
        <ChoiceStrip
          accent="coral"
          description="A dense, buildable relief panel judged straight-on against your original photo."
          meta="BEST MATCH"
          onPress={() => onChange('photo')}
          selected={value === 'photo'}
          title="Photo panel"
        />
        <ChoiceStrip
          accent="mint"
          description="Capture the front, left, back and right for a fuller sculpture you approve before brick conversion."
          meta="FULL 3D"
          onPress={() => onChange('orbit')}
          selected={value === 'orbit'}
          title="4-view sculpture"
        />
      </View>
    </ScreenFrame>
  );
}
