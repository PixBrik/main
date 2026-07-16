import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { whenVisible } from '../lib/whenVisible';
import { colors, fonts, inkAlpha, radius, shadow, spacing, type, type SignalName } from '../theme/tokens';
import { BrandMark } from './BrandMark';

/**
 * Staggered reveal: each row fades in and rises, 60 ms apart. Content jumps
 * straight to its final state when the page loads hidden (rAF suspended).
 */
function useStagger(count: number) {
  const values = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    return whenVisible(
      () =>
        Animated.stagger(
          60,
          values.map((value) =>
            Animated.timing(value, {
              duration: 380,
              easing: Easing.out(Easing.cubic),
              toValue: 1,
              useNativeDriver: true,
            }),
          ),
        ).start(),
      () => values.forEach((value) => value.setValue(1)),
    );
  }, [values]);
  return values.map((value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
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
  /** Retired in Saffron Press — accepted for API compatibility. */
  accent?: SignalName;
}

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
}: ScreenFrameProps) {
  const [journeyIn, headIn, bodyIn] = useStagger(3);

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
    <View style={styles.brandRow}>
      <BrandMark size={18} variant="full" />
      {trailing ?? null}
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
              style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
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
                <Text style={styles.progressValue}>{Math.round(progress * 100)}%</Text>
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
                      width: fill.interpolate({ inputRange: [0, 1], outputRange: ['5%', '100%'] }),
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      <Animated.View style={headIn}>
        <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </Animated.View>
      <Animated.View style={[styles.body, bodyIn]}>{children}</Animated.View>
    </View>
  );

  return (
    <View style={styles.frame}>
      {/* Full-width hairlines delineate the pinned chrome from the
          scrolling content — the header and footer share the page colour,
          so without them the fixed bars visually bleed into the page. */}
      <View style={styles.brandBar}>{brandHeader}</View>
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
      {footer ? (
        <View style={styles.footerBar}>
          <View style={styles.footer}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.saffron,
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  brandBar: {
    backgroundColor: colors.saffron,
    borderBottomColor: inkAlpha(0.12),
    borderBottomWidth: 1,
    width: '100%',
  },
  brandRow: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 520,
    minHeight: 52,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  content: {
    alignSelf: 'center',
    maxWidth: 520,
    paddingBottom: spacing.huge,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    width: '100%',
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
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  backPressed: {
    transform: [{ scale: 0.96 }],
  },
  backText: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  backPlaceholder: {
    height: 46,
    width: 46,
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
    color: inkAlpha(0.55),
  },
  progressValue: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    backgroundColor: inkAlpha(0.14),
    borderRadius: radius.pill,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    height: '100%',
  },
  eyebrow: {
    ...type.micro,
    color: inkAlpha(0.55),
    marginBottom: spacing.md,
  },
  title: {
    ...type.title,
    color: colors.ink,
    maxWidth: 440,
    textTransform: 'uppercase',
  },
  subtitle: {
    ...type.body,
    color: inkAlpha(0.72),
    marginTop: spacing.md,
    maxWidth: 400,
  },
  body: {
    marginTop: spacing.xl,
  },
  footerBar: {
    backgroundColor: colors.saffron,
    borderTopColor: inkAlpha(0.12),
    borderTopWidth: 1,
    width: '100%',
  },
  footer: {
    alignSelf: 'center',
    maxWidth: 520,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
  },
});
