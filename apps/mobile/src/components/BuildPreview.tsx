import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Polygon, Rect } from 'react-native-svg';

import { colors, radius, spacing, type } from '../theme/tokens';

interface BuildPreviewProps {
  accent?: string;
  step?: number;
  label?: string;
}

export function BuildPreview({ accent = colors.blue, step = 4, label }: BuildPreviewProps) {
  return (
    <View
      accessibilityLabel={label ?? 'Block-built Signal Fox preview'}
      accessibilityRole="image"
      style={styles.shell}
    >
      <View style={styles.signalTag}>
        <Text style={styles.signalTagText}>{label ?? 'BUILDABLE'}</Text>
      </View>
      <Svg height="100%" viewBox="0 0 340 260" width="100%">
        <Polygon fill="#2A3040" points="28,211 172,151 314,208 171,254" />
        <G stroke={colors.ink} strokeLinejoin="round" strokeWidth="3">
          <Polygon fill={colors.saffron} points="223,137 276,115 303,130 249,153" />
          <Polygon fill="#D59D35" points="249,153 303,130 303,150 249,174" />
          <Polygon fill="#EDB84C" points="223,137 249,153 249,174 223,158" />
          {step >= 2 ? (
            <>
              <Polygon fill={accent} points="103,143 174,111 237,137 167,171" />
              <Polygon fill="#3347B5" points="167,171 237,137 237,180 167,214" />
              <Polygon fill="#6D7FF2" points="103,143 167,171 167,214 103,185" />
              <Polygon fill={colors.coral} points="120,120 167,98 209,115 164,137" />
              <Polygon fill="#CB5147" points="164,137 209,115 209,145 164,167" />
              <Polygon fill="#F38578" points="120,120 164,137 164,167 120,149" />
            </>
          ) : null}
          {step >= 3 ? (
            <>
              <Polygon fill={colors.white} points="135,91 171,75 207,89 170,106" />
              <Polygon fill={colors.paperDeep} points="170,106 207,89 207,120 170,137" />
              <Polygon fill={colors.white} points="135,91 170,106 170,137 135,122" />
              <Polygon fill={colors.coral} points="137,87 143,51 164,80" />
              <Polygon fill={colors.saffron} points="177,78 200,49 201,90" />
            </>
          ) : null}
          {step >= 4 ? (
            <>
              <Circle cx="157" cy="101" fill={colors.ink} r="4" stroke="none" />
              <Circle cx="184" cy="97" fill={colors.ink} r="4" stroke="none" />
              <Rect fill={colors.mint} height="12" rx="4" transform="rotate(27 112 174)" width="30" x="97" y="168" />
              <Rect fill={colors.lilac} height="12" rx="4" transform="rotate(-24 218 183)" width="30" x="203" y="177" />
            </>
          ) : null}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    aspectRatio: 1.22,
    backgroundColor: colors.panelDark,
    borderColor: '#31384D',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  signalTag: {
    backgroundColor: colors.saffron,
    borderBottomColor: '#31384D',
    borderBottomWidth: 1,
    borderRightColor: '#31384D',
    borderRightWidth: 1,
    borderTopLeftRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    zIndex: 1,
  },
  signalTagText: {
    ...type.micro,
    color: colors.ink,
    letterSpacing: 1,
  },
});
