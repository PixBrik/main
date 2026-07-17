import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BrandMark } from '../components/BrandMark';
import { BuildPath } from '../components/BuildPath';
import { TopMenu } from '../components/TopMenu';
import { listBuilds, type SavedBuild } from '../lib/buildGallery';
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

export function HomeScreen({ onStart, onOpenBuild, onOpenLibrary }: HomeScreenProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const [builds] = useState<SavedBuild[]>(() => listBuilds());
  const [showAll, setShowAll] = useState(false);
  const wide = viewportWidth >= 920;
  const pageGutter = wide ? spacing.xxl : spacing.xl;
  const pageWidth = Math.max(260, Math.min(viewportWidth - pageGutter * 2, wide ? 1180 : 472));
  const headlineSize = wide ? 42 : Math.max(34, Math.min(42, pageWidth / 7.5));

  const headline = (text: string) => (
    <View style={styles.lineBox}>
      <Text
        style={[styles.headline, { fontSize: headlineSize, lineHeight: headlineSize * 0.98 }]}
      >
        {text}
        <Text style={styles.headlineStop}>.</Text>
      </Text>
    </View>
  );

  const visibleBuilds = showAll ? builds : builds.slice(0, 2);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { width: pageWidth }, wide && styles.scrollWide]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <BrandMark animated={false} size={20} />
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

        <View style={[styles.heroGrid, wide && styles.heroGridWide]}>
          <View style={[styles.introColumn, wide && styles.introColumnWide]}>
            {headline('YOUR PHOTO')}
            {wide ? headline('BUILT IN BRICKS') : (
              <>
                {headline('BUILT IN')}
                {headline('BRICKS')}
              </>
            )}

            <Text style={styles.sub}>
              Preview a buildable brick portrait from your photo on this device, inspect every
              detail, and decide before you order.
            </Text>

            {wide ? (
              <View style={styles.desktopActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onStart}
                  style={({ pressed }) => [styles.desktopPrimary, pressed && styles.pressedSlab]}
                >
                  <Text style={styles.desktopPrimaryText}>PREVIEW MY PHOTO</Text>
                </Pressable>
                {onOpenLibrary ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={onOpenLibrary}
                    style={({ pressed }) => [styles.desktopLibrary, pressed && styles.pressedPill]}
                  >
                    <Text style={styles.desktopLibraryText}>OR EXPLORE THE LIBRARY →</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {wide ? (
              <Text style={styles.valueLine}>
                PANEL PREVIEW FIRST · FULL 3D WITH 4 GUIDED PHOTOS · PARTS MATCHED TO OUR CATALOG
              </Text>
            ) : null}
          </View>

          <View style={[styles.showcaseColumn, wide && styles.showcaseColumnWide]}>
            <BuildPath onStart={onStart} />
          </View>
        </View>

        {!wide ? (
          <Text style={styles.valueLine}>
            PANEL PREVIEW FIRST · FULL 3D WITH 4 GUIDED PHOTOS · PARTS MATCHED TO OUR CATALOG
          </Text>
        ) : null}

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
      <View style={styles.dockWrap}>
        <View style={[styles.dock, { width: Math.min(viewportWidth - spacing.xl, 488) }]}>
        <View style={styles.dockGlyph}>
          <StudGlyph color={colors.saffron} size={6} />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onStart}
          style={({ pressed }) => [styles.dockSlab, pressed && styles.pressedSlab]}
        >
          <Text numberOfLines={1} style={styles.dockSlabText}>PREVIEW MY PHOTO</Text>
        </Pressable>
        {onOpenLibrary ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenLibrary}
            style={({ pressed }) => [styles.dockOutline, pressed && styles.pressedSlab]}
          >
            <Text style={styles.dockOutlineText}>EXPLORE{'\n'}LIBRARY</Text>
          </Pressable>
        ) : null}
        </View>
      </View>
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
    paddingBottom: 130,
    paddingTop: spacing.md,
  },
  scrollWide: {
    paddingTop: spacing.lg,
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
  heroGrid: {
    width: '100%',
  },
  heroGridWide: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.huge,
  },
  introColumn: {
    width: '100%',
  },
  introColumnWide: {
    flexBasis: 430,
    flexGrow: 0,
    flexShrink: 0,
    paddingTop: spacing.huge,
  },
  showcaseColumn: {
    width: '100%',
  },
  showcaseColumnWide: {
    flex: 1,
    minWidth: 0,
  },
  lineBox: {
    overflow: 'hidden',
  },
  headline: {
    ...type.display,
    color: colors.ink,
    letterSpacing: -1.8,
  },
  headlineStop: {
    color: colors.alarm,
  },
  sub: {
    ...type.body,
    color: inkAlpha(0.72),
    fontFamily: fonts.bold,
    marginTop: spacing.lg,
    maxWidth: 430,
  },
  desktopActions: {
    alignItems: 'flex-start',
    marginTop: spacing.xxl,
  },
  desktopPrimary: {
    ...shadow.card,
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderColor: colors.white,
    borderWidth: 4,
    justifyContent: 'center',
    minHeight: 66,
    paddingHorizontal: spacing.xxl,
  },
  desktopPrimaryText: {
    color: colors.white,
    fontFamily: fonts.display,
    fontSize: 18,
    letterSpacing: 0.1,
  },
  desktopLibrary: {
    borderBottomColor: colors.ink,
    borderBottomWidth: 2,
    marginLeft: spacing.lg,
    marginTop: spacing.lg,
    paddingBottom: 3,
  },
  desktopLibraryText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  valueLine: {
    ...type.micro,
    color: inkAlpha(0.55),
    lineHeight: 16,
    marginBottom: spacing.md,
    marginTop: spacing.lg,
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
    fontSize: 14,
    letterSpacing: -0.2,
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
