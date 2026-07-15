import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

import { colors, radius } from '../theme/tokens';

interface ObjectSculptureProps {
  scanLines?: boolean;
}

export function ObjectSculpture({ scanLines = false }: ObjectSculptureProps) {
  return (
    <View accessibilityLabel="Abstract fox-shaped object preview" style={styles.frame}>
      <Svg height="100%" viewBox="0 0 320 240" width="100%">
        <Defs>
          <LinearGradient id="body" x1="0" x2="1" y1="0" y2="1">
            <Stop offset="0" stopColor={colors.coral} />
            <Stop offset="1" stopColor="#D95362" />
          </LinearGradient>
        </Defs>
        <Rect fill={colors.panelDark} height="240" width="320" />
        <Path d="M36 198 C82 174 245 174 286 200 L270 218 L53 218 Z" fill="#2A3040" />
        <Path
          d="M103 162 C81 141 78 102 99 76 C121 49 173 50 204 74 C232 96 240 143 218 174 C186 201 129 195 103 162Z"
          fill="url(#body)"
          stroke={colors.ink}
          strokeWidth="3"
        />
        <Polygon
          fill={colors.coral}
          points="108,80 105,35 142,67"
          stroke={colors.ink}
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <Polygon
          fill={colors.saffron}
          points="174,66 207,32 207,84"
          stroke={colors.ink}
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <Path
          d="M212 155 C275 139 278 90 239 74 C289 73 310 125 280 163 C259 189 230 193 206 183"
          fill={colors.saffron}
          stroke={colors.ink}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <Circle cx="137" cy="113" fill={colors.mint} r="4" />
        <Circle cx="186" cy="109" fill={colors.mint} r="4" />
        <Circle cx="163" cy="132" fill={colors.ink} r="4" />
        <Path d="M106 165 L125 174 L113 193 L90 180 Z" fill={colors.mint} stroke={colors.ink} strokeLinejoin="round" strokeWidth="3" />
        <Path d="M190 173 L215 164 L228 184 L201 195 Z" fill={colors.lilac} stroke={colors.ink} strokeLinejoin="round" strokeWidth="3" />
        {scanLines ? (
          <>
            <Rect fill={colors.mint} height="1.5" opacity="0.6" width="250" x="35" y="72" />
            <Rect fill={colors.mint} height="1.5" opacity="0.6" width="250" x="35" y="119" />
            <Rect fill={colors.mint} height="1.5" opacity="0.6" width="250" x="35" y="166" />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 1.35,
    backgroundColor: colors.panelDark,
    borderColor: '#31384D',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
});
