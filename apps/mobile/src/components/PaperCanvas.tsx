import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '../theme/tokens';

export function PaperCanvas({ children }: PropsWithChildren) {
  return (
    <View style={styles.canvas}>
      <View accessibilityElementsHidden pointerEvents="none" style={styles.grid}>
        <View style={styles.gridVerticalOne} />
        <View style={styles.gridVerticalTwo} />
        <View style={styles.gridHorizontalOne} />
        <View style={styles.gridHorizontalTwo} />
      </View>
      <View accessibilityElementsHidden pointerEvents="none" style={styles.signalCorner} />
      <View accessibilityElementsHidden pointerEvents="none" style={styles.accentRail} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: colors.paper,
    flex: 1,
    overflow: 'hidden',
  },
  grid: {
    bottom: 0,
    opacity: 0.36,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 142,
  },
  gridVerticalOne: {
    backgroundColor: colors.line,
    bottom: 0,
    position: 'absolute',
    right: 47,
    top: 0,
    width: 1,
  },
  gridVerticalTwo: {
    backgroundColor: colors.line,
    bottom: 0,
    position: 'absolute',
    right: 94,
    top: 0,
    width: 1,
  },
  gridHorizontalOne: {
    backgroundColor: colors.line,
    height: 1,
    position: 'absolute',
    right: 0,
    top: 180,
    width: 142,
  },
  gridHorizontalTwo: {
    backgroundColor: colors.line,
    height: 1,
    position: 'absolute',
    right: 0,
    top: 360,
    width: 142,
  },
  signalCorner: {
    borderRightColor: colors.blue,
    borderRightWidth: 3,
    borderTopColor: colors.blue,
    borderTopWidth: 3,
    height: 72,
    opacity: 0.32,
    position: 'absolute',
    right: 18,
    top: 18,
    width: 72,
  },
  accentRail: {
    backgroundColor: colors.coral,
    height: 3,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 96,
  },
});
