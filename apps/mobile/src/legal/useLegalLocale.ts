import { useState } from 'react';

import type { LegalLocale } from './legalContent';

export function useLegalLocale(
  value?: LegalLocale,
  onChange?: (locale: LegalLocale) => void,
) {
  const [internalValue, setInternalValue] = useState<LegalLocale>(value ?? 'en');
  const locale = value ?? internalValue;

  const setLocale = (nextLocale: LegalLocale) => {
    if (value === undefined) setInternalValue(nextLocale);
    onChange?.(nextLocale);
  };

  return [locale, setLocale] as const;
}
