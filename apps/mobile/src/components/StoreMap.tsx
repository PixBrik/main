import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors, radius } from '../theme/tokens';

export function StoreMap() {
  return (
    <View accessibilityLabel="Demo map showing three nearby stores" style={styles.map}>
      <Svg height="100%" viewBox="0 0 340 190" width="100%">
        <Rect fill={colors.blueSoft} height="190" width="340" />
        <Path d="M-30 164 C45 101 81 143 148 96 C207 55 232 103 370 37" fill="none" stroke={colors.white} strokeWidth="25" />
        <Path d="M41 -20 C58 41 79 60 105 79 C143 108 193 131 229 211" fill="none" stroke={colors.paper} strokeWidth="15" />
        <Path d="M-20 43 C72 65 104 33 171 43 C247 54 270 79 360 93" fill="none" stroke={colors.mint} strokeDasharray="4 5" strokeWidth="4" />
        <Circle cx="159" cy="85" fill={colors.coral} r="16" stroke={colors.ink} strokeWidth="3" />
        <Circle cx="248" cy="58" fill={colors.saffron} r="14" stroke={colors.ink} strokeWidth="3" />
        <Circle cx="84" cy="139" fill={colors.mint} r="13" stroke={colors.ink} strokeWidth="3" />
        <Circle cx="159" cy="85" fill={colors.white} r="5" />
        <Circle cx="248" cy="58" fill={colors.white} r="4" />
        <Circle cx="84" cy="139" fill={colors.white} r="4" />
        <SvgText fill={colors.ink} fontSize="10" fontWeight="900" x="179" y="89">YOU</SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    aspectRatio: 1.75,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
});
