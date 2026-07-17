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
  onStart?: () => void;
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
 * A real 52×52 catalog-colour panel, rendered as one SVG path per colour.
 * The grouped paths keep all 2,704 visible cells without mounting thousands
 * of React elements. A single repeating overlay supplies the plate seams and
 * stud highlight.
 */
function BrickMosaic({ compact = false, id }: MosaicProps) {
  const data = HOME_MOSAICS[id];
  const paths = useMemo(() => {
    const grouped = data.palette.map(() => '');
    data.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const paletteIndex = HOME_MOSAIC_ALPHABET.indexOf(row[x]!);
        if (paletteIndex >= 0) grouped[paletteIndex] += `M${x} ${y}h1v1h-1z`;
      }
    });
    return grouped;
  }, [data]);
  const patternId = `home-studs-${id}-${compact ? 'small' : 'large'}`;

  return (
    <Svg height="100%" viewBox={`0 0 ${HOME_MOSAIC_GRID} ${HOME_MOSAIC_GRID}`} width="100%">
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
      <Rect fill="#FFFFFA" height={HOME_MOSAIC_GRID} width={HOME_MOSAIC_GRID} />
      {paths.map((path, index) => (
        <Path d={path} fill={data.palette[index]} key={`${id}-${data.palette[index]}`} />
      ))}
      <Rect fill={`url(#${patternId})`} height={HOME_MOSAIC_GRID} width={HOME_MOSAIC_GRID} />
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

export function BuildPath({ onStart }: BuildPathProps) {
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
        accessibilityLabel={`${active.label.toLowerCase()} example. Source photo beside a deterministic ${HOME_MOSAIC_GRID} by ${HOME_MOSAIC_GRID} panel preview using catalog colours.`}
        accessibilityRole="image"
        style={styles.comparisonCard}
      >
        <View style={styles.comparisonHeader}>
          <View style={styles.headerHalf}>
            <Text numberOfLines={1} style={styles.headerLabel}>PHOTO</Text>
          </View>
          <View style={[styles.headerHalf, styles.headerHalfRight]}>
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
          <View style={[styles.stageHalf, styles.stageHalfRight]}>
            <BrickMosaic id={active.id} />
          </View>
        </Animated.View>

        <View style={styles.comparisonFooter}>
          <Text numberOfLines={1} style={styles.footerPrimary}>
            CLOSEST LIKENESS · FRONT-FACING PANEL
          </Text>
          <Text numberOfLines={1} style={styles.footerSecondary}>
            {HOME_MOSAIC_GRID} × {HOME_MOSAIC_GRID} STUDS · CATALOG COLOURS
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
                <View style={styles.selectorHalf}>
                  <BrickMosaic compact id={showcase.id} />
                </View>
              </View>
              <Text numberOfLines={1} style={styles.selectorLabel}>{showcase.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.guidance}>
        <View style={styles.guidanceLine}>
          <View style={styles.infoMark}>
            <Text style={styles.infoMarkText}>i</Text>
          </View>
          <Text style={styles.guidanceText}>For the closest likeness, choose a clear front-facing photo.</Text>
        </View>
        {onStart ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onStart}
            style={({ pressed }) => [styles.dimensionLink, pressed && styles.selectorPressed]}
          >
            <Text style={styles.dimensionLinkText}>WANT FULL 3D? USE 4 GUIDED PHOTOS →</Text>
          </Pressable>
        ) : null}
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
    ...shadow.card,
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderWidth: 3,
    overflow: 'hidden',
  },
  comparisonHeader: {
    borderBottomColor: colors.ink,
    borderBottomWidth: 2,
    flexDirection: 'row',
  },
  headerHalf: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },
  headerHalfRight: {
    borderLeftColor: colors.ink,
    borderLeftWidth: 2,
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
    width: '100%',
  },
  stageHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  stageHalfRight: {
    borderLeftColor: colors.ink,
    borderLeftWidth: 2,
  },
  photoFrame: {
    backgroundColor: '#F4EEDC',
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
    borderTopColor: colors.ink,
    borderTopWidth: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  footerPrimary: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 9,
    letterSpacing: 0.4,
  },
  footerSecondary: {
    color: inkAlpha(0.58),
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
  dimensionLink: {
    alignSelf: 'flex-start',
    borderBottomColor: colors.ink,
    borderBottomWidth: 1,
    marginLeft: 30,
    marginTop: spacing.md,
    paddingBottom: 2,
  },
  dimensionLinkText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.35,
  },
});
