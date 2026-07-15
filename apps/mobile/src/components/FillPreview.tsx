import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import { colors, type } from '../theme/tokens';

/**
 * Cross-section diagram of a build: Full fills every cell, Hollow keeps only
 * the outer shell (empty inside). Communicates the difference at a glance,
 * since the two look identical from the outside.
 */
export function FillPreview({ hollow, color = '#E96632' }: { hollow: boolean; color?: string }) {
  const n = 6;
  const cell = 13;
  const size = n * cell;
  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const isShell = r === 0 || c === 0 || r === n - 1 || c === n - 1;
      const filled = hollow ? isShell : true;
      rects.push(
        <Rect
          key={`${r}-${c}`}
          x={c * cell + 0.5}
          y={r * cell + 0.5}
          width={cell - 1}
          height={cell - 1}
          fill={filled ? color : '#161A24'}
          stroke="#0A0C12"
          strokeWidth={0.6}
        />,
      );
      // Studs on the top row only.
      if (r === 0 && filled) {
        rects.push(
          <Circle key={`s-${c}`} cx={c * cell + cell / 2} cy={cell / 2} r={cell * 0.16} fill="rgba(255,255,255,0.35)" />,
        );
      }
    }
  }
  return (
    <View style={styles.wrap}>
      <Svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        {rects}
      </Svg>
      <Text style={styles.caption}>{hollow ? 'EMPTY INSIDE' : 'SOLID'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 4,
  },
  caption: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 8,
    letterSpacing: 0.8,
  },
});
