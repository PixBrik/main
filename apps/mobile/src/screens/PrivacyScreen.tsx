import { LegalDocument, LegalPageFrame } from '../components/legal';
import {
  LEGAL_BACK_LABEL,
  PRIVACY_COPY,
  PRIVACY_METADATA,
  type LegalLocale,
} from '../legal/legalContent';
import { useLegalLocale } from '../legal/useLegalLocale';
import {
  evaluateLegalRelease,
  isLegalDraftPreviewAllowed,
  type LegalGateRequest,
} from '../legal/legalGovernance';

interface PrivacyScreenProps {
  allowDraftPreview?: boolean;
  locale?: LegalLocale;
  onBack?: () => void;
  onLocaleChange?: (locale: LegalLocale) => void;
  releaseContext?: Pick<LegalGateRequest, 'jurisdiction' | 'market' | 'productType'>;
}

export function PrivacyScreen({
  allowDraftPreview = true,
  locale: localeValue,
  onBack,
  onLocaleChange,
  releaseContext,
}: PrivacyScreenProps) {
  const [locale, setLocale] = useLegalLocale(localeValue, onLocaleChange);
  const copy = PRIVACY_COPY[locale];
  const releaseAllowed = releaseContext
    ? evaluateLegalRelease(PRIVACY_METADATA, {
        ...releaseContext,
        language: locale,
        use: 'public-page',
      }).allowed
    : false;
  const showSections = releaseAllowed || isLegalDraftPreviewAllowed(allowDraftPreview);

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
      <LegalDocument
        copy={copy}
        locale={locale}
        metadata={PRIVACY_METADATA}
        showSections={showSections}
      />
    </LegalPageFrame>
  );
}
