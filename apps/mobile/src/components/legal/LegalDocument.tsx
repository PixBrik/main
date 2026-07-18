import { StyleSheet, Text, View } from 'react-native';

import {
  isRtlLocale,
  type LegalDocumentCopy,
  type LegalDocumentMetadata,
  type LegalLocale,
} from '../../legal/legalContent';
import { colors, fonts, inkAlpha, radius, spacing } from '../../theme/tokens';

interface LegalDocumentProps {
  copy: LegalDocumentCopy;
  locale: LegalLocale;
  metadata: LegalDocumentMetadata;
  showSections: boolean;
}

export function LegalDocument({ copy, locale, metadata, showSections }: LegalDocumentProps) {
  const rtl = isRtlLocale(locale);
  const textDirection = rtl ? styles.rtlText : styles.ltrText;

  return (
    <View>
      <View accessibilityRole="alert" style={styles.reviewNotice}>
        <Text style={[styles.reviewTitle, rtl && styles.arabicHeading, textDirection]}>
          {copy.counselReviewLabel}
        </Text>
        <Text style={[styles.reviewMeta, rtl && styles.arabicBody, textDirection]}>
          {copy.lastUpdatedLabel}: {metadata.version} · {metadata.status}
        </Text>
      </View>

      {showSections ? <View style={styles.sections}>
        {copy.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, rtl && styles.arabicHeading, textDirection]}
            >
              {section.heading}
            </Text>
            {section.paragraphs.map((paragraph) => (
              <Text
                key={paragraph}
                selectable
                style={[styles.paragraph, rtl && styles.arabicBody, textDirection]}
              >
                {paragraph}
              </Text>
            ))}
            {section.bullets?.map((bullet) => (
              <View key={bullet} style={styles.bulletRow}>
                <Text style={[styles.bulletMark, rtl && styles.arabicBody]}>•</Text>
                <Text selectable style={[styles.bulletText, rtl && styles.arabicBody, textDirection]}>
                  {bullet}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reviewNotice: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  reviewTitle: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 18,
  },
  reviewMeta: {
    color: 'rgba(255, 255, 255, 0.68)',
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 15,
    marginTop: spacing.xs,
  },
  sections: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  section: {
    backgroundColor: colors.white,
    borderColor: inkAlpha(0.18),
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.xl,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  paragraph: {
    color: inkAlpha(0.82),
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  bulletRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  bulletMark: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 22,
  },
  bulletText: {
    color: inkAlpha(0.82),
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 22,
  },
  ltrText: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  rtlText: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  arabicHeading: {
    fontFamily: undefined,
    fontWeight: '900',
    letterSpacing: 0,
  },
  arabicBody: {
    fontFamily: undefined,
    fontWeight: '500',
    lineHeight: 25,
  },
});
