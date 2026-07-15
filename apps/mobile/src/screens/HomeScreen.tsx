import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BuildPath } from '../components/BuildPath';
import { HowItWorks } from '../components/HowItWorks';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { listBuilds, type SavedBuild } from '../lib/buildGallery';
import { colors, radius, spacing, type } from '../theme/tokens';

interface HomeScreenProps {
  onStart: () => void;
  onOpenBuild?: (build: SavedBuild) => void;
  onOpenLibrary?: () => void;
}

export function HomeScreen({ onStart, onOpenBuild, onOpenLibrary }: HomeScreenProps) {
  const [builds] = useState<SavedBuild[]>(() => listBuilds());
  return (
    <ScreenFrame
      eyebrow="PixBrik / Object → Build"
      footer={
        <PrimaryButton
          accessibilityHint="Starts the sample object-to-build journey"
          label="Create a build"
          onPress={onStart}
        />
      }
      title="Shoot it. Build it."
      trailing={
        <View accessibilityLabel="Interactive demo ready" style={styles.status}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>DEMO LIVE</Text>
        </View>
      }
    >
      <Text style={styles.intro}>
        Turn real photos — your car, your house, a portrait, any object — into buildable brick art
        with a full parts list and sourcing for your country.
      </Text>
      <BuildPath />

      {onOpenLibrary ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenLibrary}
          style={({ pressed }) => [styles.libraryCta, pressed && styles.libraryCtaPressed]}
        >
          <View style={styles.libraryCopy}>
            <Text style={styles.libraryTitle}>No photo? Pick from the library</Text>
            <Text style={styles.libraryBody}>Popular cars and objects, ready to build in your colour</Text>
          </View>
          <Text style={styles.libraryArrow}>→</Text>
        </Pressable>
      ) : null}

      <HowItWorks />

      {builds.length > 0 && onOpenBuild ? (
        <View style={styles.gallery}>
          <Text style={styles.galleryLabel}>PREVIOUS BUILDS</Text>
          {builds.slice(0, 4).map((build) => (
            <Pressable
              accessibilityRole="button"
              key={build.id}
              onPress={() => onOpenBuild(build)}
              style={({ pressed }) => [styles.galleryRow, pressed && styles.galleryPressed]}
            >
              <View style={styles.gallerySwatches}>
                {build.palette.slice(0, 3).map((hex, index) => (
                  <View key={index} style={[styles.gallerySwatch, { backgroundColor: hex }]} />
                ))}
              </View>
              <View style={styles.galleryCopy}>
                <Text style={styles.galleryName}>{build.name}</Text>
                <Text style={styles.galleryMeta}>
                  {build.brickCount} bricks · {new Date(build.savedAt).toLocaleDateString()}
                </Text>
              </View>
              <Text style={styles.galleryArrow}>→</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  status: {
    alignItems: 'center',
    backgroundColor: colors.panelDark,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  statusDot: {
    backgroundColor: colors.saffron,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusText: {
    ...type.micro,
    color: colors.white,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  intro: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 17,
    lineHeight: 25,
    maxWidth: 440,
  },
  libraryCta: {
    alignItems: 'center',
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
  },
  libraryCtaPressed: {
    opacity: 0.8,
  },
  libraryCopy: {
    flex: 1,
  },
  libraryTitle: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  libraryBody: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 10,
    marginTop: 2,
  },
  libraryArrow: {
    color: colors.blue,
    fontSize: 20,
    fontWeight: '900',
  },
  gallery: {
    marginTop: spacing.xl,
  },
  galleryLabel: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  galleryRow: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  galleryPressed: {
    backgroundColor: colors.blueSoft,
  },
  gallerySwatches: {
    flexDirection: 'row',
    gap: 3,
  },
  gallerySwatch: {
    borderColor: colors.ink,
    borderRadius: 3,
    borderWidth: 1,
    height: 14,
    width: 14,
  },
  galleryCopy: {
    flex: 1,
  },
  galleryName: {
    ...type.body,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  galleryMeta: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
  },
  galleryArrow: {
    color: colors.blue,
    fontSize: 17,
    fontWeight: '900',
  },
});
