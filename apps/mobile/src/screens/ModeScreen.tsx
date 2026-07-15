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
      footer={<PrimaryButton label="Open camera" onPress={onContinue} />}
      onBack={onBack}
      progress={0.12}
      subtitle="One good photo is enough — straight on, decent light. Want the back captured too? Walk around it."
      title="One photo is all it takes."
    >
      <View accessibilityRole="radiogroup">
        <ChoiceStrip
          accent="coral"
          description="Fastest route for a compact interpretation."
          meta="FAST"
          onPress={() => onChange('photo')}
          selected={value === 'photo'}
          title="Single photo"
        />
        <ChoiceStrip
          accent="mint"
          description="Walk around it for a fuller, steadier 3D shape."
          meta="FULL MODEL"
          onPress={() => onChange('orbit')}
          selected={value === 'orbit'}
          title="360° capture"
        />
      </View>
    </ScreenFrame>
  );
}
