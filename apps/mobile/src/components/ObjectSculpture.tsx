import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { G, Polygon, Rect } from 'react-native-svg';

import { getVoxelModel } from '../lib/voxelFox';
import { buildRenderFaces, type Projection } from '../lib/voxelRender';
import { colors, radius } from '../theme/tokens';

interface ObjectSculptureProps {
  scanLines?: boolean;
}

const PROJECTION: Projection = { baseY: 215, centerX: 145, scale: 26 };
const YAW = 0.56;

/**
 * Pre-scan placeholder: a real brick rendering of the sample object (the
 * demo fox), so what you see before scanning is the same kind of thing the
 * product actually produces — bricks, not an illustration.
 */
export function ObjectSculpture({ scanLines = false }: ObjectSculptureProps) {
  const model = useMemo(() => getVoxelModel('efficient'), []);
  const renderFaces = useMemo(
    () => buildRenderFaces(YAW, colors.alarm, model, PROJECTION),
    [model],
  );

  return (
    <View accessibilityLabel="Brick-built fox — the sample object" style={styles.frame}>
      <Svg height="100%" viewBox="0 0 320 240" width="100%">
        <Rect fill={colors.ink} height="240" width="320" />
        <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth={1}>
          {renderFaces.map((face) => (
            <Polygon fill={face.fill} key={face.id} points={face.points} />
          ))}
        </G>
        {scanLines ? (
          <G opacity={0.5}>
            <Rect fill={colors.saffron} height="1.5" opacity="0.6" width="290" x="15" y="76" />
            <Rect fill={colors.saffron} height="1.5" opacity="0.6" width="290" x="15" y="132" />
            <Rect fill={colors.saffron} height="1.5" opacity="0.6" width="290" x="15" y="188" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 1.35,
    backgroundColor: colors.ink,
    borderColor: '#31384D',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
});
