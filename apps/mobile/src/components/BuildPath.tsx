import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Polygon } from 'react-native-svg';

import { getHeroObjects } from '../lib/voxelObjects';
import { buildRenderFaces } from '../lib/voxelRender';
import { colors, fonts, inkAlpha, saffronAlpha, spacing } from '../theme/tokens';

/**
 * Saffron Press hero: the model renders as an INK SCULPTURE on the saffron
 * world — monochrome bricks, saffron seam outlines, slow continuous yaw spin.
 * Cycles objects every 5 s (paused after a manual pick); four flat ticks
 * bottom-left switch objects; caption bottom-right names the model.
 */

const TAU = Math.PI * 2;
const SPIN_STEP = Math.PI / 90;
const SPIN_INTERVAL_MS = 90;
const OBJECT_INTERVAL_MS = 5000;
const INITIAL_YAW = 0.56;

/** Two ink tones keep the sculpture readable: lit faces vs shadow faces. */
function inkify(fill: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(fill)?.[1];
  if (!hex) return colors.ink;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.45 ? '#2C2513' : colors.ink;
}

export function BuildPath() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [yaw, setYaw] = useState(INITIAL_YAW);
  const [objectIndex, setObjectIndex] = useState(0);
  const holdUntil = useRef(0);
  const swap = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted && enabled) setReduceMotion(true);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const changeObject = (next: number | ((current: number) => number)) => {
    // Hidden tabs suspend rAF — swap instantly so the cycle can't freeze mid-fade.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      swap.setValue(1);
      setObjectIndex(next);
      return;
    }
    // Outgoing slides left and fades; incoming enters from the right.
    Animated.timing(swap, { duration: 200, toValue: 0, useNativeDriver: true }).start(() => {
      setObjectIndex(next);
      Animated.timing(swap, { duration: 220, toValue: 1, useNativeDriver: true }).start();
    });
  };

  useEffect(() => {
    if (reduceMotion) return;
    const spin = setInterval(() => {
      setYaw((current) => (current + SPIN_STEP) % TAU);
    }, SPIN_INTERVAL_MS);
    const objects = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      changeObject((current) => (current + 1) % getHeroObjects().length);
    }, OBJECT_INTERVAL_MS);
    return () => {
      clearInterval(spin);
      clearInterval(objects);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const heroObjects = getHeroObjects();
  const heroObject = heroObjects[objectIndex % heroObjects.length]!;
  const renderFaces = useMemo(
    () => buildRenderFaces(yaw, heroObject.accent, heroObject.model, heroObject.projection),
    [heroObject, yaw],
  );

  const heightCm = useMemo(() => {
    let minJ = Infinity;
    let maxJ = -Infinity;
    for (const voxel of heroObject.model.shell) {
      minJ = Math.min(minJ, voxel.j);
      maxJ = Math.max(maxJ, voxel.j);
    }
    return Math.max(1, Math.round((maxJ - minJ + 1) * 0.96));
  }, [heroObject]);

  const selectObject = (index: number) => {
    holdUntil.current = Date.now() + 12000;
    if (index !== objectIndex % heroObjects.length) changeObject(index);
  };

  return (
    <View
      accessibilityLabel={`Build showcase: a ${heroObject.model.brickCount}-brick ${heroObject.label.toLowerCase()} rendered as an ink sculpture. Use the ticks below to switch objects.`}
      style={styles.hero}
    >
      <Animated.View
        style={[
          styles.stage,
          {
            opacity: swap,
            transform: [
              { translateX: swap.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
            ],
          },
        ]}
      >
        <Svg height="100%" viewBox="0 0 320 212" width="100%">
          <G stroke={saffronAlpha(0.5)} strokeLinejoin="round" strokeWidth={0.5}>
            {renderFaces.map((face) => (
              <Polygon fill={inkify(face.fill)} key={face.id} points={face.points} />
            ))}
          </G>
        </Svg>
      </Animated.View>

      <View style={styles.footerRow}>
        <View
          accessibilityLabel="Choose a showcase object"
          accessibilityRole="tablist"
          style={styles.tickRow}
        >
          {heroObjects.map((item, index) => {
            const active = index === objectIndex % heroObjects.length;
            return (
              <Pressable
                accessibilityLabel={item.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                hitSlop={12}
                key={item.id}
                onPress={() => selectObject(index)}
                style={[styles.tick, active ? styles.tickActive : styles.tickIdle]}
              />
            );
          })}
        </View>
        <View style={styles.caption}>
          <Text style={styles.captionName}>{heroObject.label}</Text>
          <Text style={styles.captionMeta}>
            {heroObject.model.brickCount.toLocaleString('en-US')} BRICKS · {heightCm} CM
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginVertical: spacing.md,
    width: '100%',
  },
  stage: {
    aspectRatio: 320 / 212,
    width: '100%',
  },
  footerRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  tickRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
  },
  tick: {
    borderRadius: 2,
    height: 6,
  },
  tickActive: {
    backgroundColor: colors.ink,
    width: 22,
  },
  tickIdle: {
    backgroundColor: inkAlpha(0.3),
    width: 10,
  },
  caption: {
    alignItems: 'flex-end',
  },
  captionName: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 15,
    textTransform: 'uppercase',
  },
  captionMeta: {
    color: inkAlpha(0.66),
    fontFamily: fonts.extrabold,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.4,
    marginTop: 2,
  },
});
