import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '../components/BrandMark';
import { BuildPath } from '../components/BuildPath';
import { TopMenu } from '../components/TopMenu';
import { listBuilds, type SavedBuild } from '../lib/buildGallery';
import { whenVisible } from '../lib/whenVisible';
import { colors, fonts, inkAlpha, radius, saffronAlpha, shadow, spacing, type } from '../theme/tokens';

interface HomeScreenProps {
  onStart: () => void;
  onOpenBuild?: (build: SavedBuild) => void;
  onOpenLibrary?: () => void;
}

/** 2×2 stud glyph — the brand ornament, used in pills and the dock. */
function StudGlyph({ color, size = 5 }: { color: string; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size * 0.7, width: size * 2.7 }}>
      {[0, 1, 2, 3].map((index) => (
        <View
          key={index}
          style={{ backgroundColor: color, borderRadius: size, height: size, width: size }}
        />
      ))}
    </View>
  );
}

/** Headline lines rise from clipped line-boxes, staggered. */
function useLineRise(count: number) {
  const values = useRef(Array.from({ length: count }, () => new Animated.Value(1))).current;
  useEffect(() => {
    return whenVisible(
      () =>
        Animated.stagger(
          90,
          values.map((value) =>
            Animated.timing(value, {
              duration: 420,
              easing: Easing.bezier(0.22, 1, 0.36, 1),
              toValue: 0,
              useNativeDriver: true,
            }),
          ),
        ).start(),
      () => values.forEach((value) => value.setValue(0)),
    );
  }, [values]);
  return values;
}

export function HomeScreen({ onStart, onOpenBuild, onOpenLibrary }: HomeScreenProps) {
  const [builds] = useState<SavedBuild[]>(() => listBuilds());
  const [showAll, setShowAll] = useState(false);
  const lineRise = useLineRise(2);
  const dockIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return whenVisible(
      () =>
        Animated.spring(dockIn, {
          damping: 20,
          delay: 260,
          stiffness: 180,
          toValue: 1,
          useNativeDriver: true,
        }).start(),
      () => dockIn.setValue(1),
    );
  }, [dockIn]);

  const headline = (text: string, index: number) => (
    <View style={styles.lineBox}>
      <Animated.View
        style={{
          transform: [
            {
              translateY: lineRise[index]!.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 70],
              }),
            },
          ],
        }}
      >
        <Text style={styles.headline}>
          {text}
          <Text style={styles.headlineStop}>.</Text>
        </Text>
      </Animated.View>
    </View>
  );

  const visibleBuilds = showAll ? builds : builds.slice(0, 2);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <BrandMark size={20} />
          <View style={styles.topActions}>
            {builds.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowAll((current) => !current)}
                style={({ pressed }) => [styles.buildsPill, pressed && styles.pressedPill]}
              >
                <Text style={styles.buildsPillText}>MY BUILDS</Text>
              </Pressable>
            ) : null}
            <TopMenu />
          </View>
        </View>

        {headline('SHOOT IT', 0)}
        {headline('BUILD IT', 1)}

        <Text style={styles.sub}>
          The gift they'll never see coming: a photo of their car, their cat, their face — turned
          into a brick sculpture they build themselves.
        </Text>

        <BuildPath />

        <Text style={styles.valueLine}>
          EVERY KIT: ALL BRICKS, SORTED · PRINTED STEP-BY-STEP GUIDE · SHIPS GIFT-READY
        </Text>

        {builds.length > 0 && onOpenBuild ? (
          <View style={styles.buildsBlock}>
            <Text style={styles.buildsLabel}>YOUR BUILDS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.buildsRow}>
                {visibleBuilds.map((build) => (
                  <Pressable
                    accessibilityRole="button"
                    key={build.id}
                    onPress={() => onOpenBuild(build)}
                    style={({ pressed }) => [styles.buildPill, pressed && styles.pressedPill]}
                  >
                    <StudGlyph color={colors.ink} />
                    <Text style={styles.buildPillText}>{build.name.toUpperCase()}</Text>
                  </Pressable>
                ))}
                {builds.length > 2 && !showAll ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShowAll(true)}
                    style={({ pressed }) => [styles.buildPill, pressed && styles.pressedPill]}
                  >
                    <Text style={styles.buildPillText}>ALL →</Text>
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>

      {/* The dock — the only persistent navigation. */}
      <Animated.View
        style={[
          styles.dockWrap,
          {
            opacity: dockIn,
            transform: [
              { translateY: dockIn.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.dock}>
        <View style={styles.dockGlyph}>
          <StudGlyph color={colors.saffron} size={6} />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onStart}
          style={({ pressed }) => [styles.dockSlab, pressed && styles.pressedSlab]}
        >
          <Text style={styles.dockSlabText}>CREATE A BUILD</Text>
        </Pressable>
        {onOpenLibrary ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenLibrary}
            style={({ pressed }) => [styles.dockOutline, pressed && styles.pressedSlab]}
          >
            <Text style={styles.dockOutlineText}>NO PHOTO?{'\n'}LIBRARY</Text>
          </Pressable>
        ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    alignSelf: 'center',
    flexGrow: 1,
    maxWidth: 520,
    paddingBottom: 130,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    width: '100%',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 30,
    marginBottom: spacing.xl,
    minHeight: 48,
  },
  topActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buildsPill: {
    ...shadow.card,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  buildsPillText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  pressedPill: {
    transform: [{ scale: 0.96 }],
  },
  lineBox: {
    overflow: 'hidden',
  },
  headline: {
    ...type.display,
    color: colors.ink,
  },
  headlineStop: {
    color: colors.alarm,
  },
  sub: {
    ...type.body,
    color: inkAlpha(0.72),
    fontFamily: fonts.bold,
    marginTop: spacing.lg,
    maxWidth: 320,
  },
  valueLine: {
    ...type.micro,
    color: inkAlpha(0.55),
    lineHeight: 16,
    marginBottom: spacing.md,
  },
  buildsBlock: {
    marginTop: spacing.md,
  },
  buildsLabel: {
    ...type.micro,
    color: inkAlpha(0.55),
    marginBottom: spacing.sm,
  },
  buildsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buildPill: {
    ...shadow.card,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  buildPillText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 12,
  },
  dockWrap: {
    alignItems: 'center',
    bottom: 20,
    left: 0,
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    right: 0,
  },
  dock: {
    ...shadow.dock,
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.xl,
    flexDirection: 'row',
    gap: spacing.md,
    maxWidth: 520 - spacing.lg * 2,
    padding: 14,
    width: '100%',
  },
  dockGlyph: {
    paddingHorizontal: 8,
  },
  dockSlab: {
    alignItems: 'center',
    backgroundColor: colors.saffron,
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 56,
  },
  dockSlabText: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  pressedSlab: {
    transform: [{ scale: 0.97 }],
  },
  dockOutline: {
    alignItems: 'center',
    borderColor: saffronAlpha(0.4),
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  dockOutlineText: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 15,
    textAlign: 'center',
  },
});
