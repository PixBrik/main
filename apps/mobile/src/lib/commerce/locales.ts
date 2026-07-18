export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'it', 'ar'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type TextDirection = 'ltr' | 'rtl';

export interface LocaleMetadata {
  code: SupportedLocale;
  /** BCP 47 language tag used by Intl and the document `lang` attribute. */
  languageTag: string;
  englishName: string;
  nativeName: string;
  direction: TextDirection;
}

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_METADATA: Readonly<Record<SupportedLocale, LocaleMetadata>> = {
  en: {
    code: 'en',
    languageTag: 'en',
    englishName: 'English',
    nativeName: 'English',
    direction: 'ltr',
  },
  fr: {
    code: 'fr',
    languageTag: 'fr',
    englishName: 'French',
    nativeName: 'Français',
    direction: 'ltr',
  },
  es: {
    code: 'es',
    languageTag: 'es',
    englishName: 'Spanish',
    nativeName: 'Español',
    direction: 'ltr',
  },
  it: {
    code: 'it',
    languageTag: 'it',
    englishName: 'Italian',
    nativeName: 'Italiano',
    direction: 'ltr',
  },
  ar: {
    code: 'ar',
    languageTag: 'ar',
    englishName: 'Arabic',
    nativeName: 'العربية',
    direction: 'rtl',
  },
};

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves browser-style tags such as `fr-FR` and `ar_SA` to a launch locale.
 * Unknown or empty values use the supplied fallback rather than leaking an
 * unsupported locale into URLs, emails, invoices, or persisted orders.
 */
export function resolveLocale(
  value: string | null | undefined,
  fallback: SupportedLocale = DEFAULT_LOCALE,
): SupportedLocale {
  const language = value?.trim().toLowerCase().replace('_', '-').split('-')[0] ?? '';
  return isSupportedLocale(language) ? language : fallback;
}

export function localeMetadata(locale: SupportedLocale): LocaleMetadata {
  return LOCALE_METADATA[locale];
}

export function isRtlLocale(locale: SupportedLocale): boolean {
  return LOCALE_METADATA[locale].direction === 'rtl';
}
