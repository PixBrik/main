import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LegalPageFrame } from '../components/legal';
import {
  isRtlLocale,
  LEGAL_BACK_LABEL,
  LEGAL_HUB_COPY,
  type LegalLocale,
  type LegalRoute,
} from '../legal/legalContent';
import { useLegalLocale } from '../legal/useLegalLocale';
import { colors, fonts, inkAlpha, radius, shadow, spacing } from '../theme/tokens';

interface LegalHubScreenProps {
  locale?: LegalLocale;
  onBack?: () => void;
  onLocaleChange?: (locale: LegalLocale) => void;
  onNavigate: (route: Exclude<LegalRoute, 'legal'>) => void;
}

export function LegalHubScreen({
  locale: localeValue,
  onBack,
  onLocaleChange,
  onNavigate,
}: LegalHubScreenProps) {
  const [locale, setLocale] = useLegalLocale(localeValue, onLocaleChange);
  const copy = LEGAL_HUB_COPY[locale];
  const rtl = isRtlLocale(locale);
  const textDirection = rtl ? styles.rtlText : styles.ltrText;
  const cards: ReadonlyArray<{
    description: string;
    id: string;
    route: Exclude<LegalRoute, 'legal'>;
    title: string;
  }> = [
    { description: copy.termsDescription, id: '01', route: 'terms', title: copy.termsTitle },
    { description: copy.privacyDescription, id: '02', route: 'privacy', title: copy.privacyTitle },
    { description: copy.contactDescription, id: '03', route: 'contact', title: copy.contactTitle },
  ];

  return (
    <LegalPageFrame
      backLabel={LEGAL_BACK_LABEL[locale]}
      eyebrow={copy.eyebrow}
      locale={locale}
      onBack={onBack}
      onLocaleChange={setLocale}
      subtitle={copy.subtitle}
      title={copy.title}
    >
      <View accessibilityRole="alert" style={styles.reviewNotice}>
        <Text style={[styles.reviewText, rtl && styles.arabicHeading, textDirection]}>
          {copy.counselReviewLabel}
        </Text>
      </View>

      <View style={styles.cards}>
        {cards.map((card) => (
          <Pressable
            accessibilityLabel={card.title}
            accessibilityRole="link"
            key={card.route}
            onPress={() => onNavigate(card.route)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardNumber}>{card.id}</Text>
              <Text style={[styles.cardArrow, textDirection]}>{rtl ? '←' : '→'}</Text>
            </View>
            <Text style={[styles.cardTitle, rtl && styles.arabicHeading, textDirection]}>
              {card.title}
            </Text>
            <Text style={[styles.cardDescription, rtl && styles.arabicBody, textDirection]}>
              {card.description}
            </Text>
          </Pressable>
        ))}
      </View>
    </LegalPageFrame>
  );
}

const styles = StyleSheet.create({
  reviewNotice: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  reviewText: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 13,
    lineHeight: 18,
  },
  cards: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  card: {
    ...shadow.card,
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    minHeight: 170,
    padding: spacing.xl,
  },
  cardPressed: {
    opacity: 0.72,
    transform: [{ translateY: 2 }],
  },
  cardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardNumber: {
    color: inkAlpha(0.46),
    fontFamily: fonts.display,
    fontSize: 11,
  },
  cardArrow: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '900',
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    marginTop: spacing.lg,
  },
  cardDescription: {
    color: inkAlpha(0.7),
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
    maxWidth: 580,
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
