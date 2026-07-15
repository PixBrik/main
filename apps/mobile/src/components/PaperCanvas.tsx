import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '../theme/tokens';

/** Saffron Press: the world is one solid saturated saffron. No ornament. */
export function PaperCanvas({ children }: PropsWithChildren) {
  return <View style={styles.canvas}>{children}</View>;
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: colors.saffron,
    flex: 1,
    overflow: 'hidden',
  },
});
