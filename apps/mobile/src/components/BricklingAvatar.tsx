import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import { bricklingDesign } from '../lib/brickling';

interface BricklingAvatarProps {
  decorative?: boolean;
  label: string;
  seed: string;
  size?: number;
}

export function BricklingAvatar({ decorative = false, label, seed, size = 38 }: BricklingAvatarProps) {
  const design = bricklingDesign(seed);
  const studWidth = 20 / design.studCount;
  const leftEye = 24 - design.eyeGap / 2;
  const rightEye = 24 + design.eyeGap / 2;

  return (
    <View
      accessibilityLabel={decorative ? undefined : `${label}'s Brickling avatar`}
      accessibilityRole={decorative ? undefined : 'image'}
      accessible={!decorative}
      importantForAccessibility={decorative ? 'no' : 'auto'}
      style={[styles.frame, { backgroundColor: design.background, height: size, width: size }]}
    >
      <Svg accessible={false} height="100%" viewBox="0 0 48 48" width="100%">
        {Array.from({ length: design.studCount }, (_, index) => (
          <Rect
            fill={design.face}
            height={5}
            key={index}
            rx={1.5}
            width={Math.max(4, studWidth - 2)}
            x={14 + index * studWidth}
            y={8}
          />
        ))}
        <Rect fill={design.face} height={27} rx={4} width={30} x={9} y={12} />
        <Circle cx={leftEye} cy={24} fill="#17130A" r={2.25} />
        <Circle cx={rightEye} cy={24} fill="#17130A" r={2.25} />
        <Rect
          fill="#17130A"
          height={3}
          rx={1.5}
          width={design.mouthWidth}
          x={24 - design.mouthWidth / 2 + design.mouthOffset}
          y={31}
        />
        <Circle cx={15} cy={17} fill="rgba(255,255,255,0.42)" r={2.4} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    borderColor: '#17130A',
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
