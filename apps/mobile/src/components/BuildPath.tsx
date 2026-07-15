import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path, Polygon } from 'react-native-svg';

import { getHeroObjects } from '../lib/voxelObjects';
import { buildRenderFaces } from '../lib/voxelRender';
import { colors, radius, spacing, type } from '../theme/tokens';

/**
 * Home-screen hero slideshow: demo objects spin live on the graphite stage.
 * The tabs under the stage are explicit slideshow controls (tap to switch);
 * the product steps live in their own section outside this panel so the two
 * are never confused. All animation pauses under reduced motion.
 */

const TAU = Math.PI * 2;
const SPIN_STEP = Math.PI / 90;
const SPIN_INTERVAL_MS = 90;
const OBJECT_INTERVAL_MS = 5200;
const INITIAL_YAW = 0.56;

export function BuildPath() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [yaw, setYaw] = useState(INITIAL_YAW);
  const [objectIndex, setObjectIndex] = useState(0);
  const holdUntil = useRef(0);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted && enabled) {
          setReduceMotion(true);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const spin = setInterval(() => {
      setYaw((current) => (current + SPIN_STEP) % TAU);
    }, SPIN_INTERVAL_MS);
    const objects = setInterval(() => {
      // Respect a recent manual selection before auto-advancing again.
      if (Date.now() < holdUntil.current) return;
      setObjectIndex((current) => (current + 1) % getHeroObjects().length);
    }, OBJECT_INTERVAL_MS);
    return () => {
      clearInterval(spin);
      clearInterval(objects);
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { duration: 900, toValue: 0.25, useNativeDriver: false }),
        Animated.timing(pulse, { duration: 900, toValue: 1, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  const heroObjects = getHeroObjects();
  const heroObject = heroObjects[objectIndex % heroObjects.length]!;
  const renderFaces = useMemo(
    () => buildRenderFaces(yaw, heroObject.accent, heroObject.model, heroObject.projection),
    [heroObject, yaw],
  );

  const selectObject = (index: number) => {
    holdUntil.current = Date.now() + 12000;
    setObjectIndex(index);
  };

  return (
    <View
      accessibilityLabel={`Build showcase: rotating brick-built objects. Currently a ${heroObject.model.brickCount}-brick ${heroObject.label.toLowerCase()}${heroObject.tag === 'FROM A PHOTO' ? ', generated from a photo by the engine' : ''}. Use the tabs below the stage to switch objects.`}
      style={styles.panel}
    >
      <View style={styles.header}>
        <View style={styles.liveMark}>
          <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
          <Text style={styles.headerTitle}>BUILD SHOWCASE</Text>
        </View>
        <Text style={[styles.tag, heroObject.tag === 'FROM A PHOTO' && styles.tagPhoto]}>
          {heroObject.tag}
        </Text>
      </View>

      <View style={styles.stage}>
        <Svg height="100%" viewBox="0 0 320 212" width="100%">
          <G opacity={0.14} stroke="#8DF5E5" strokeWidth="0.8">
            <Path d="M14 170 L152 128 L306 170" />
            <Path d="M14 192 L152 142 L306 192" />
            <Path d="M60 210 L152 142 L252 210" />
            <Path d="M152 142 L152 212" />
          </G>
          <Polygon fill="#05070B" opacity={0.55} points="52,186 148,156 268,184 162,208" />
          <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth={0.55}>
            {renderFaces.map((face) => (
              <Polygon fill={face.fill} key={face.id} points={face.points} />
            ))}
          </G>
        </Svg>
        <View pointerEvents="none" style={styles.countChip}>
          <Text style={styles.countText}>{heroObject.model.brickCount} BRICKS</Text>
        </View>
      </View>

      <View accessibilityLabel="Choose a showcase object" accessibilityRole="tablist" style={styles.objectRow}>
        {heroObjects.map((item, index) => {
          const active = index === objectIndex % heroObjects.length;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.id}
              onPress={() => selectObject(index)}
              style={({ pressed }) => [
                styles.objectTab,
                active && { backgroundColor: item.accent },
                pressed && styles.objectTabPressed,
              ]}
            >
              <Text style={[styles.objectTabText, active && styles.objectTabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panelDark,
    borderColor: '#31384D',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginVertical: spacing.lg,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#282E40',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  liveMark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  liveDot: {
    backgroundColor: colors.saffron,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  headerTitle: {
    ...type.micro,
    color: '#AEB5C7',
    fontSize: 9,
    letterSpacing: 1.6,
  },
  tag: {
    ...type.micro,
    color: '#8E98B3',
    fontSize: 8,
    letterSpacing: 1,
  },
  tagPhoto: {
    color: colors.saffron,
  },
  stage: {
    aspectRatio: 320 / 212,
    backgroundColor: '#0B0E16',
    position: 'relative',
    width: '100%',
  },
  countChip: {
    backgroundColor: 'rgba(11, 14, 22, 0.82)',
    borderColor: '#384158',
    borderRadius: radius.pill,
    borderWidth: 1,
    bottom: spacing.sm,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    position: 'absolute',
  },
  countText: {
    ...type.micro,
    color: '#C6CDDE',
    fontSize: 8,
    letterSpacing: 1.1,
  },
  objectRow: {
    borderTopColor: '#282E40',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: spacing.sm,
  },
  objectTab: {
    alignItems: 'center',
    backgroundColor: colors.panelRaise,
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 4,
  },
  objectTabPressed: {
    opacity: 0.75,
  },
  objectTabText: {
    ...type.micro,
    color: '#AEB5C7',
    fontSize: 9,
    letterSpacing: 0.9,
  },
  objectTabTextActive: {
    color: colors.ink,
    fontWeight: '900',
  },
});
