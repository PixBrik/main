import { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

import { getVoxelModel, type BuildProfile, type VoxelModel } from '../lib/voxelFox';
import { buildRenderFaces, type Projection } from '../lib/voxelRender';

interface RotatableBuildPreviewProps {
  accent?: string;
  initialYaw?: number;
  label?: string;
  profile?: BuildProfile;
  sourceUri?: string | null;
  /** Photo-derived model; when set it replaces the built-in demo object. */
  modelOverride?: VoxelModel | null;
}

const TAU = Math.PI * 2;
const ROTATION_STEP = Math.PI / 8;
/** Rendering is quantised to 2° steps so drags reuse memoised geometry between steps. */
const RENDER_STEP = Math.PI / 90;
const VIEWBOX_WIDTH = 360;
const VIEWBOX_HEIGHT = 320;

const PROJECTION: Projection = { baseY: 277, centerX: 158, scale: 36 };

function normalizeAngle(value: number) {
  return ((value % TAU) + TAU) % TAU;
}

function formatCount(value: number) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function RotatableBuildPreview({
  accent = '#7367FF',
  initialYaw = 0.56,
  label = 'Generated fox build',
  profile = 'balanced',
  sourceUri = null,
  modelOverride = null,
}: RotatableBuildPreviewProps) {
  const [yaw, setYaw] = useState(() => normalizeAngle(initialYaw));
  const yawRef = useRef(yaw);
  const gestureStartYaw = useRef(yaw);
  yawRef.current = yaw;

  const rotateBy = (amount: number) => {
    setYaw((currentYaw) => normalizeAngle(currentYaw + amount));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          gestureStartYaw.current = yawRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          setYaw(normalizeAngle(gestureStartYaw.current + gesture.dx * 0.012));
        },
      }),
    [],
  );

  const model = useMemo(() => modelOverride ?? getVoxelModel(profile), [modelOverride, profile]);
  const renderYaw = Math.round(yaw / RENDER_STEP) * RENDER_STEP;
  const renderFaces = useMemo(
    () => buildRenderFaces(renderYaw, accent, model, PROJECTION),
    [accent, model, renderYaw],
  );
  const angleInDegrees = Math.round((yaw * 180) / Math.PI) % 360;
  const strokeWidth = model.size >= 0.4 ? 1.1 : model.size >= 0.3 ? 0.75 : 0.55;

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.liveMark}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>3D // LIVE</Text>
        </View>
        <Text style={styles.brickCount}>{formatCount(model.brickCount)} BRICKS</Text>
        <Text style={styles.angleText}>{angleInDegrees.toString().padStart(3, '0')}°</Text>
      </View>

      <View
        accessibilityActions={[
          { name: 'decrement', label: 'Rotate left' },
          { name: 'increment', label: 'Rotate right' },
          { name: 'activate', label: 'Reset view' },
        ]}
        accessibilityHint="Swipe horizontally, or use the rotation controls below."
        accessibilityLabel={`${label}, interactive 3D preview, ${model.brickCount} bricks`}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: `${angleInDegrees} degrees` }}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') {
            rotateBy(ROTATION_STEP);
          } else if (event.nativeEvent.actionName === 'decrement') {
            rotateBy(-ROTATION_STEP);
          } else if (event.nativeEvent.actionName === 'activate') {
            setYaw(normalizeAngle(initialYaw));
          }
        }}
        style={styles.stage}
        {...panResponder.panHandlers}
      >
        <Svg height="100%" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} width="100%">
          <Defs>
            <LinearGradient id="stageGlow" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#1B2030" />
              <Stop offset="0.55" stopColor="#10131D" />
              <Stop offset="1" stopColor="#090B11" />
            </LinearGradient>
          </Defs>
          <Rect fill="url(#stageGlow)" height={VIEWBOX_HEIGHT} width={VIEWBOX_WIDTH} />
          <Circle cx="176" cy="202" fill={accent} opacity={0.11} r="118" />
          <G opacity={0.16} stroke="#8DF5E5" strokeWidth="0.8">
            <Path d="M20 258 L178 202 L340 258" />
            <Path d="M20 282 L178 220 L340 282" />
            <Path d="M58 310 L178 220 L302 310" />
            <Path d="M110 310 L178 220 L250 310" />
            <Path d="M178 220 L178 316" />
          </G>
          <Polygon fill="#05070B" opacity={0.58} points="66,273 173,235 303,270 184,310" />
          <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth={strokeWidth}>
            {renderFaces.map((face) => (
              <Polygon fill={face.fill} key={face.id} points={face.points} />
            ))}
          </G>
          <Path d="M24 26 H61" stroke={accent} strokeWidth="3" />
          <Path d="M299 294 H336" stroke="#8DF5E5" strokeWidth="3" />
        </Svg>
        {sourceUri ? (
          <View pointerEvents="none" style={styles.sourceChip}>
            <Image
              accessibilityLabel="Source photo used for this build"
              source={{ uri: sourceUri }}
              style={styles.sourceImage}
            />
            <Text style={styles.sourceLabel}>SOURCE</Text>
          </View>
        ) : null}
        <View pointerEvents="none" style={styles.dragHint}>
          <Text style={styles.dragGlyph}>↔</Text>
          <Text style={styles.dragText}>DRAG TO ORBIT</Text>
        </View>
      </View>

      <View accessibilityRole="toolbar" style={styles.controls}>
        <Pressable
          accessibilityLabel="Rotate preview left"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => rotateBy(-ROTATION_STEP)}
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
        >
          <Text style={styles.controlIcon}>←</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Reset preview rotation"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => setYaw(normalizeAngle(initialYaw))}
          style={({ pressed }) => [styles.resetButton, pressed && styles.controlPressed]}
        >
          <Text style={styles.resetText}>RESET VIEW</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Rotate preview right"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => rotateBy(ROTATION_STEP)}
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
        >
          <Text style={styles.controlIcon}>→</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#10131D',
    borderColor: '#31384D',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#282E40',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  liveMark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  liveDot: {
    backgroundColor: '#8DF5E5',
    borderRadius: 4,
    height: 7,
    shadowColor: '#8DF5E5',
    shadowOpacity: 0.7,
    shadowRadius: 6,
    width: 7,
  },
  liveText: {
    color: '#D9FFF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.7,
  },
  brickCount: {
    color: '#FFC800',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  angleText: {
    color: '#8E98B3',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  stage: {
    aspectRatio: 1.13,
    backgroundColor: '#17130A',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  sourceChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 22, 0.82)',
    borderColor: '#384158',
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    position: 'absolute',
    right: 12,
    top: 12,
  },
  sourceImage: {
    borderRadius: 7,
    height: 56,
    width: 56,
  },
  sourceLabel: {
    color: '#C6CDDE',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginTop: 3,
  },
  dragHint: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 22, 0.82)',
    borderColor: '#384158',
    borderRadius: 999,
    borderWidth: 1,
    bottom: 12,
    flexDirection: 'row',
    gap: 7,
    left: 12,
    paddingHorizontal: 11,
    paddingVertical: 7,
    position: 'absolute',
  },
  dragGlyph: {
    color: '#8DF5E5',
    fontSize: 15,
    fontWeight: '800',
  },
  dragText: {
    color: '#C6CDDE',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.25,
  },
  controls: {
    alignItems: 'center',
    borderTopColor: '#282E40',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    padding: 11,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: '#1A1F2D',
    borderColor: '#3A435A',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 48,
  },
  controlIcon: {
    color: '#F6F7FB',
    fontSize: 19,
    fontWeight: '700',
  },
  resetButton: {
    alignItems: 'center',
    backgroundColor: '#7367FF',
    borderRadius: 10,
    flex: 1,
    height: 44,
    justifyContent: 'center',
    maxWidth: 154,
  },
  resetText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.35,
  },
  controlPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
});
