import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, signals, spacing, type, type SignalName } from '../theme/tokens';
import { BrandMark } from './BrandMark';

/**
 * Staggered reveal: returns one animated style per row — each fades in and
 * rises 14px, 70ms after the previous (skiper-ui style sequential entrance).
 */
function useStagger(count: number) {
  const values = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      70,
      values.map((value) =>
        Animated.timing(value, {
          duration: 380,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [values]);
  return values.map((value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  }));
}

interface ScreenFrameProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  progress?: number;
  trailing?: ReactNode;
  scroll?: boolean;
  accent?: SignalName;
}

const railSegments: readonly SignalName[] = ['coral', 'indigo', 'mint', 'saffron'];

export function ScreenFrame({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  onBack,
  progress,
  trailing,
  scroll = true,
  accent = 'indigo',
}: ScreenFrameProps) {
  const signal = signals[accent];

  const [journeyIn, headIn, titleIn, bodyIn] = useStagger(4);

  // Progress fill eases toward the current value on every change.
  const fill = useRef(new Animated.Value(progress ?? 0)).current;
  useEffect(() => {
    if (progress === undefined) return;
    Animated.timing(fill, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
      toValue: progress,
      useNativeDriver: false,
    }).start();
  }, [fill, progress]);

  const brandHeader = (
    <View style={styles.brandHeader}>
      <View style={styles.brandRow}>
        <BrandMark size={onBack ? 36 : 40} variant="full" />
        {trailing ?? <Text style={styles.edition}>DEMO / 01</Text>}
      </View>
      <View accessibilityElementsHidden pointerEvents="none" style={styles.signalRail}>
        {railSegments.map((name) => (
          <View
            key={name}
            style={[
              styles.signalSegment,
              { backgroundColor: signals[name].main },
              name === accent && styles.signalSegmentActive,
            ]}
          />
        ))}
      </View>
    </View>
  );

  const content = (
    <View style={styles.content}>
      {onBack || progress !== undefined ? (
        <Animated.View style={[styles.journeyRow, journeyIn]}>
          {onBack ? (
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onBack}
              style={({ pressed }) => [
                styles.back,
                pressed && { backgroundColor: signal.soft },
              ]}
            >
              <Text style={styles.backText}>←</Text>
            </Pressable>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
          {progress !== undefined ? (
            <View style={styles.progressGroup}>
              <View style={styles.progressMeta}>
                <Text style={styles.progressLabel}>BUILD FLOW</Text>
                <Text style={[styles.progressValue, { color: signal.deep }]}>
                  {Math.round(progress * 100)}%
                </Text>
              </View>
              <View
                accessibilityLabel={`Journey ${Math.round(progress * 100)} percent complete`}
                accessibilityRole="progressbar"
                style={styles.progressTrack}
              >
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: signal.deep,
                      width: fill.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['5%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      <Animated.View style={headIn}>
        <View style={[styles.eyebrowChip, { backgroundColor: signal.soft }]}>
          <View style={[styles.eyebrowTick, { backgroundColor: signal.main }]} />
          <Text style={[styles.eyebrow, { color: signal.deep }]}>{eyebrow.toUpperCase()}</Text>
        </View>
      </Animated.View>
      <Animated.View style={titleIn}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <View
          accessibilityElementsHidden
          pointerEvents="none"
          style={[styles.titleSignal, { backgroundColor: signal.main }]}
        />
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </Animated.View>
      <Animated.View style={[styles.body, bodyIn]}>{children}</Animated.View>
    </View>
  );

  return (
    <View style={styles.frame}>
      {brandHeader}
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  brandHeader: {
    backgroundColor: colors.paper,
    width: '100%',
  },
  signalRail: {
    flexDirection: 'row',
    height: 3,
    width: '100%',
  },
  signalSegment: {
    flex: 1,
    opacity: 0.55,
  },
  signalSegmentActive: {
    flex: 2.4,
    opacity: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 520,
    paddingBottom: spacing.huge,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    width: '100%',
  },
  brandRow: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 520,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  edition: {
    ...type.micro,
    color: colors.inkSoft,
    fontVariant: ['tabular-nums'],
    letterSpacing: 1.2,
  },
  journeyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  back: {
    ...shadow.card,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  backText: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  backPlaceholder: {
    height: 44,
    width: 44,
  },
  progressGroup: {
    flex: 1,
  },
  progressMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  progressValue: {
    ...type.micro,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    backgroundColor: colors.paperDeep,
    borderRadius: radius.pill,
    height: 5,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: radius.pill,
    height: '100%',
  },
  eyebrowChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  eyebrowTick: {
    borderRadius: 1,
    height: 8,
    width: 8,
  },
  eyebrow: {
    ...type.label,
  },
  title: {
    ...type.title,
    color: colors.ink,
    maxWidth: 440,
  },
  titleSignal: {
    borderRadius: 2,
    height: 5,
    marginTop: spacing.md,
    width: 56,
  },
  subtitle: {
    ...type.body,
    color: colors.inkSoft,
    marginTop: spacing.md,
    maxWidth: 440,
  },
  body: {
    marginTop: spacing.xl,
  },
  footer: {
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    maxWidth: 520,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    width: '100%',
  },
});
