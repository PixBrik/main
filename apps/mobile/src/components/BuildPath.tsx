import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg';

import {
  HOME_MOSAIC_ALPHABET,
  HOME_MOSAIC_EMPTY,
  HOME_MOSAIC_GRID,
  HOME_MOSAICS,
} from '../data/homeShowcases.generated';
import { colors, fonts, inkAlpha, shadow, spacing } from '../theme/tokens';

type ShowcaseId = keyof typeof HOME_MOSAICS;

interface Showcase {
  alt: string;
  id: ShowcaseId;
  label: string;
  source: ImageSourcePropType;
}

interface BuildPathProps {
  onStart: () => void;
  onStart3D?: () => void;
}

const SHOWCASES: readonly Showcase[] = [
  {
    alt: 'Front-facing portrait of a woman with dark curly hair',
    id: 'portrait',
    label: 'PORTRAIT',
    source: require('../../assets/home/portrait-source.png'),
  },
  {
    alt: 'Front-facing portrait of a golden dog',
    id: 'pet',
    label: 'PET',
    source: require('../../assets/home/pet-source.png'),
  },
  {
    alt: 'Front-facing photograph of a classic dark sports car',
    id: 'car',
    label: 'CAR',
    source: require('../../assets/home/car-source.png'),
  },
] as const;

interface MosaicProps {
  compact?: boolean;
  id: ShowcaseId;
}

/**
 * A high-detail catalog-colour subject, rendered as one SVG path per colour.
 * Empty cells never receive a fill or stud pattern, so the result reads as a
 * clean brick silhouette instead of a white rectangular backing plate.
 */
function BrickMosaic({ compact = false, id }: MosaicProps) {
  const data = HOME_MOSAICS[id];
  const { paths, silhouette, viewBox } = useMemo(() => {
    const grouped = data.palette.map(() => '');
    let subject = '';
    const visibleX: number[] = [];
    const visibleY: number[] = [];
    data.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === HOME_MOSAIC_EMPTY) continue;
        const paletteIndex = HOME_MOSAIC_ALPHABET.indexOf(row[x]!);
        if (paletteIndex >= 0) {
          const cell = `M${x} ${y}h1v1h-1z`;
          grouped[paletteIndex] += cell;
          subject += cell;
          visibleX.push(x);
          visibleY.push(y);
        }
      }
    });
    const padding = compact ? 1.5 : 2.5;
    const minX = Math.min(...visibleX) - padding;
    const minY = Math.min(...visibleY) - padding;
    const width = Math.max(...visibleX) - Math.min(...visibleX) + 1 + padding * 2;
    const height = Math.max(...visibleY) - Math.min(...visibleY) + 1 + padding * 2;
    return {
      paths: grouped,
      silhouette: subject,
      viewBox: `${minX} ${minY} ${width} ${height}`,
    };
  }, [compact, data]);
  const patternId = `home-studs-${id}-${compact ? 'small' : 'large'}`;

  return (
    <Svg height="100%" preserveAspectRatio="xMidYMid meet" viewBox={viewBox} width="100%">
      <Defs>
        <Pattern
          height="1"
          id={patternId}
          patternUnits="userSpaceOnUse"
          width="1"
          x="0"
          y="0"
        >
          <Rect
            fill="transparent"
            height="0.94"
            stroke={colors.ink}
            strokeOpacity={compact ? 0.2 : 0.34}
            strokeWidth={compact ? 0.04 : 0.055}
            width="0.94"
            x="0.03"
            y="0.03"
          />
          <Circle cx="0.46" cy="0.43" fill={colors.white} opacity={compact ? 0.08 : 0.16} r="0.27" />
          <Circle cx="0.54" cy="0.57" fill={colors.ink} opacity={compact ? 0.06 : 0.11} r="0.25" />
        </Pattern>
      </Defs>
      {paths.map((path, index) => (
        <Path d={path} fill={data.palette[index]} key={`${id}-${data.palette[index]}`} />
      ))}
      <Path d={silhouette} fill={`url(#${patternId})`} />
    </Svg>
  );
}

function SourcePhoto({ alt, id, source }: Pick<Showcase, 'alt' | 'id' | 'source'>) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.photoFrame}>
      <Image
        fadeDuration={0}
        resizeMode="cover"
        source={{ uri: HOME_MOSAICS[id].fallbackUri }}
        style={styles.fallbackImage}
      />
      {!failed ? (
        <Image
          accessibilityLabel={alt}
          accessibilityRole="image"
          defaultSource={{ uri: HOME_MOSAICS[id].fallbackUri }}
          fadeDuration={0}
          onError={() => setFailed(true)}
          resizeMode="cover"
          source={source}
          style={styles.sourceImage}
        />
      ) : null}
      {failed ? (
        <View style={styles.failureBadge}>
          <Text style={styles.failureBadgeText}>LOCAL PREVIEW</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Tiny embedded source preview; inactive tabs do not download full photos. */
function SourceThumbnail({ alt, id }: Pick<Showcase, 'alt' | 'id'>) {
  return (
    <Image
      accessibilityLabel={alt}
      accessibilityRole="image"
      fadeDuration={0}
      resizeMode="cover"
      source={{ uri: HOME_MOSAICS[id].fallbackUri }}
      style={styles.sourceImage}
    />
  );
}

export function BuildPath({ onStart, onStart3D }: BuildPathProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const reveal = useRef(new Animated.Value(1)).current;
  const active = SHOWCASES[activeIndex]!;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  const selectShowcase = (index: number) => {
    if (index === activeIndex) return;
    reveal.stopAnimation();
    setActiveIndex(index);
    if (reduceMotion) {
      reveal.setValue(1);
      return;
    }
    reveal.setValue(0);
    Animated.timing(reveal, {
      duration: 220,
      toValue: 1,
      useNativeDriver: false,
    }).start();
  };

  return (
    <View style={styles.hero}>
      <View
        accessibilityLabel={`${active.label.toLowerCase()} example. Source photo beside a subject-only ${HOME_MOSAIC_GRID} by ${HOME_MOSAIC_GRID} detail grid using catalog colours, with the studio background removed.`}
        accessibilityRole="image"
        style={styles.comparisonCard}
      >
        <View style={styles.comparisonHeader}>
          <View style={styles.headerHalf}>
            <Text numberOfLines={1} style={styles.headerLabel}>PHOTO</Text>
          </View>
          <View style={styles.headerHalf}>
            <Text numberOfLines={1} style={styles.headerLabel}>BRICK PREVIEW</Text>
          </View>
        </View>

        <Animated.View
          style={[
            styles.comparisonStage,
            {
              opacity: reveal,
              transform: [
                { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.stageHalf}>
            <SourcePhoto alt={active.alt} id={active.id} key={active.id} source={active.source} />
          </View>
          <View style={[styles.stageHalf, styles.brickStage]}>
            <BrickMosaic id={active.id} />
          </View>
        </Animated.View>

        <View style={styles.comparisonFooter}>
          <Text numberOfLines={1} style={styles.footerPrimary}>
            SUBJECT ISOLATED · FRONT-FACING PANEL
          </Text>
          <Text numberOfLines={1} style={styles.footerSecondary}>
            {HOME_MOSAIC_GRID} × {HOME_MOSAIC_GRID} DETAIL GRID ·{' '}
            {HOME_MOSAICS[active.id].occupiedCells.toLocaleString()} CATALOG-COLOUR STUDS
          </Text>
        </View>
      </View>

      <View accessibilityLabel="Choose a sample" accessibilityRole="tablist" style={styles.selectorRow}>
        {SHOWCASES.map((showcase, index) => {
          const selected = index === activeIndex;
          return (
            <Pressable
              accessibilityLabel={`Show ${showcase.label.toLowerCase()} comparison`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
              key={showcase.id}
              onPress={() => selectShowcase(index)}
              style={({ pressed }) => [
                styles.selector,
                selected && styles.selectorActive,
                pressed && styles.selectorPressed,
              ]}
            >
              <View style={styles.selectorPreview}>
                <View style={styles.selectorHalf}>
                  <SourceThumbnail alt={showcase.alt} id={showcase.id} />
                </View>
                <View style={[styles.selectorHalf, styles.brickStage]}>
                  <BrickMosaic compact id={showcase.id} />
                </View>
              </View>
              <Text numberOfLines={1} style={styles.selectorLabel}>{showcase.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View accessibilityLabel="Choose flat panel or true 3D" style={styles.productRail}>
        <Pressable
          accessibilityRole="button"
          onPress={onStart}
          style={({ pressed }) => [
            styles.productCard,
            styles.flatProduct,
            pressed && styles.selectorPressed,
          ]}
        >
          <Text style={styles.flatProductKicker}>FLAT PANEL · ONE PHOTO</Text>
          <Text style={styles.flatProductTitle}>CLOSEST LIKENESS</Text>
          <Text style={styles.flatProductBody}>
            People, pets, or objects. Only the subject becomes catalog-colour bricks.
          </Text>
          <Text style={styles.flatProductAction}>PREVIEW FLAT →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onStart3D ?? onStart}
          style={({ pressed }) => [
            styles.productCard,
            styles.true3DProduct,
            pressed && styles.selectorPressed,
          ]}
        >
          <Text style={styles.true3DProductKicker}>TRUE 3D · ALL SIDES</Text>
          <Text style={styles.true3DProductTitle}>REAL SCULPTURE</Text>
          <Text style={styles.true3DProductBody}>
            Objects: one photo, with hidden sides completed by AI.{`\n`}
            People: four guided views, so the back comes from a real photo.
          </Text>
          <Text style={styles.true3DProductAction}>START TRUE 3D →</Text>
        </Pressable>
      </View>

      <View style={styles.guidance}>
        <View style={styles.guidanceLine}>
          <View style={styles.infoMark}>
            <Text style={styles.infoMarkText}>i</Text>
          </View>
          <Text style={styles.guidanceText}>For the closest likeness, choose a clear front-facing photo.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginBottom: spacing.lg,
    marginTop: spacing.xl,
    width: '100%',
  },
  comparisonCard: {
    overflow: 'visible',
  },
  comparisonHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  headerHalf: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },
  headerLabel: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 13,
    letterSpacing: -0.2,
  },
  comparisonStage: {
    aspectRatio: 2,
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  stageHalf: {
    flex: 1,
  },
  brickStage: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  photoFrame: {
    ...shadow.card,
    backgroundColor: '#F4EEDC',
    borderColor: colors.ink,
    borderWidth: 3,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  sourceImage: {
    height: '100%',
    width: '100%',
  },
  fallbackImage: {
    bottom: 0,
    height: '100%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  failureBadge: {
    backgroundColor: colors.ink,
    bottom: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    position: 'absolute',
    right: spacing.xs,
  },
  failureBadgeText: {
    color: colors.white,
    fontFamily: fonts.extrabold,
    fontSize: 7,
    letterSpacing: 0.8,
  },
  comparisonFooter: {
    backgroundColor: colors.ink,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  footerPrimary: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 9,
    letterSpacing: 0.4,
  },
  footerSecondary: {
    color: 'rgba(255, 255, 255, 0.68)',
    fontFamily: fonts.extrabold,
    fontSize: 8,
    letterSpacing: 0.55,
    marginTop: 3,
  },
  selectorRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  selector: {
    backgroundColor: colors.white,
    borderColor: inkAlpha(0.38),
    borderWidth: 2,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  selectorActive: {
    ...shadow.card,
    borderColor: colors.ink,
    borderWidth: 3,
  },
  selectorPressed: {
    opacity: 0.7,
    transform: [{ translateY: 1 }],
  },
  selectorPreview: {
    aspectRatio: 1.7,
    backgroundColor: colors.saffron,
    borderBottomColor: colors.ink,
    borderBottomWidth: 1,
    flexDirection: 'row',
    width: '100%',
  },
  selectorHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  selectorLabel: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 11,
    paddingHorizontal: 2,
    paddingVertical: 7,
    textAlign: 'center',
  },
  productRail: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  productCard: {
    ...shadow.card,
    borderColor: colors.ink,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'flex-start',
    minHeight: 180,
    minWidth: 0,
    padding: spacing.md,
  },
  flatProduct: {
    backgroundColor: colors.ink,
  },
  flatProductKicker: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 8,
    letterSpacing: 0.6,
    lineHeight: 11,
  },
  flatProductTitle: {
    color: colors.white,
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  flatProductBody: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 13,
    marginTop: spacing.sm,
  },
  flatProductAction: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 9,
    letterSpacing: 0.35,
    marginTop: spacing.md,
  },
  true3DProduct: {
    backgroundColor: colors.white,
  },
  true3DProductKicker: {
    color: colors.alarm,
    fontFamily: fonts.extrabold,
    fontSize: 8,
    letterSpacing: 0.6,
    lineHeight: 11,
  },
  true3DProductTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  true3DProductBody: {
    color: inkAlpha(0.72),
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 13,
    marginTop: spacing.sm,
  },
  true3DProductAction: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 9,
    letterSpacing: 0.35,
    marginTop: spacing.md,
  },
  guidance: {
    marginTop: spacing.lg,
  },
  guidanceLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  infoMark: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  infoMarkText: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 12,
  },
  guidanceText: {
    color: inkAlpha(0.78),
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 16,
  },
});
