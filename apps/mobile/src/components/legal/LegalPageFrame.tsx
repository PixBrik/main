import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { isRtlLocale, LEGAL_LOCALES, type LegalLocale } from '../../legal/legalContent';
import { colors, fonts, inkAlpha, radius, shadow, spacing } from '../../theme/tokens';
import { BrandMark } from '../BrandMark';

interface LegalPageFrameProps {
  backLabel: string;
  children: ReactNode;
  eyebrow: string;
  locale: LegalLocale;
  onBack?: () => void;
  onLocaleChange?: (locale: LegalLocale) => void;
  subtitle: string;
  title: string;
}

// RN Web compiles `writingDirection` to valid CSS `direction`, while native RN
// supports ViewStyle.direction. Select the platform spelling so web emits no
// invalid-style warning and native keeps a supported View style.
const LTR_VIEW_DIRECTION = Platform.select<ViewStyle>({
  web: { writingDirection: 'ltr' } as unknown as ViewStyle,
  default: { direction: 'ltr' },
})!;
const RTL_VIEW_DIRECTION = Platform.select<ViewStyle>({
  web: { writingDirection: 'rtl' } as unknown as ViewStyle,
  default: { direction: 'rtl' },
})!;

/**
 * A wider, reading-first shell for legal and support pages. It deliberately
 * does not depend on App navigation so it can also be mounted by a web router.
 */
export function LegalPageFrame({
  backLabel,
  children,
  eyebrow,
  locale,
  onBack,
  onLocaleChange,
  subtitle,
  title,
}: LegalPageFrameProps) {
  const rtl = isRtlLocale(locale);
  const textDirection = rtl ? styles.rtlText : styles.ltrText;

  return (
    <View style={[styles.frame, rtl ? RTL_VIEW_DIRECTION : LTR_VIEW_DIRECTION]}>
      <View style={styles.headerBorder}>
        <View style={styles.header}>
          <View style={LTR_VIEW_DIRECTION}>
            <BrandMark size={18} variant="full" />
          </View>
          {onBack ? (
            <Pressable
              accessibilityLabel={backLabel}
              accessibilityRole="button"
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <Text style={[styles.backArrow, textDirection]}>{rtl ? '→' : '←'}</Text>
              <Text style={[styles.backLabel, rtl && styles.arabicLabel, textDirection]}>{backLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View accessibilityLabel="Language" style={styles.localeRow}>
            {LEGAL_LOCALES.map((option) => {
              const selected = option.code === locale;
              return (
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !onLocaleChange, selected }}
                  disabled={!onLocaleChange}
                  key={option.code}
                  onPress={() => onLocaleChange?.(option.code)}
                  style={({ pressed }) => [
                    styles.localeButton,
                    selected && styles.localeButtonSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.localeLabel,
                      option.code === 'ar' && styles.arabicLabel,
                      selected && styles.localeLabelSelected,
                    ]}
                  >
                    {option.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.eyebrow, rtl && styles.arabicLabel, textDirection]}>{eyebrow}</Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, rtl && styles.arabicTitle, textDirection]}
          >
            {title}
          </Text>
          <Text style={[styles.subtitle, rtl && styles.arabicBody, textDirection]}>{subtitle}</Text>

          <View style={styles.body}>{children}</View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.saffron,
    flex: 1,
  },
  headerBorder: {
    borderBottomColor: inkAlpha(0.14),
    borderBottomWidth: 1,
  },
  header: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 800,
    minHeight: 64,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  backButton: {
    ...shadow.card,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  backArrow: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  backLabel: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 11,
  },
  pressed: {
    opacity: 0.68,
    transform: [{ scale: 0.98 }],
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    alignSelf: 'center',
    maxWidth: 800,
    paddingBottom: 72,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    width: '100%',
  },
  localeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  localeButton: {
    alignItems: 'center',
    borderColor: inkAlpha(0.42),
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
  },
  localeButtonSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  localeLabel: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  localeLabelSelected: {
    color: colors.saffron,
  },
  eyebrow: {
    color: inkAlpha(0.62),
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 44,
    letterSpacing: -1.5,
    lineHeight: 46,
    maxWidth: 680,
  },
  subtitle: {
    color: inkAlpha(0.72),
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 23,
    marginTop: spacing.md,
    maxWidth: 620,
  },
  body: {
    marginTop: spacing.xl,
  },
  ltrText: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  rtlText: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  arabicTitle: {
    fontFamily: undefined,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 58,
  },
  arabicBody: {
    fontFamily: undefined,
    fontWeight: '600',
    lineHeight: 26,
  },
  arabicLabel: {
    fontFamily: undefined,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'none',
  },
});
