/**
 * Release governance for legal copy.
 *
 * A translated document is not a jurisdiction-specific document.  Release
 * decisions are therefore made against an explicit market, product type and
 * use.  Keep this module free of React/React Native imports so CI and server
 * code can enforce the same gate as the buyer application.
 */

export const LEGAL_LANGUAGE_VERSIONS = ['en', 'fr', 'es', 'it', 'ar'] as const;
export type LegalLanguageVersion = (typeof LEGAL_LANGUAGE_VERSIONS)[number];

export const LEGAL_MARKETS = ['eu', 'uk', 'us', 'canada', 'australia', 'middle-east'] as const;
export type LegalMarket = (typeof LEGAL_MARKETS)[number];

const EU_JURISDICTIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;
const US_SUBDIVISIONS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN',
  'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
] as const;
const CANADA_SUBDIVISIONS = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
] as const;
const AUSTRALIA_SUBDIVISIONS = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;
const MIDDLE_EAST_JURISDICTIONS = ['AE', 'BH', 'OM', 'SA'] as const;

export type LegalJurisdiction =
  | (typeof EU_JURISDICTIONS)[number]
  | 'GB'
  | `US-${(typeof US_SUBDIVISIONS)[number]}`
  | `CA-${(typeof CANADA_SUBDIVISIONS)[number]}`
  | `AU-${(typeof AUSTRALIA_SUBDIVISIONS)[number]}`
  | (typeof MIDDLE_EAST_JURISDICTIONS)[number];

export const LEGAL_JURISDICTIONS: readonly LegalJurisdiction[] = [
  ...EU_JURISDICTIONS,
  'GB',
  ...US_SUBDIVISIONS.map((code) => `US-${code}` as const),
  ...CANADA_SUBDIVISIONS.map((code) => `CA-${code}` as const),
  ...AUSTRALIA_SUBDIVISIONS.map((code) => `AU-${code}` as const),
  ...MIDDLE_EAST_JURISDICTIONS,
];

export function legalJurisdictionMarket(jurisdiction: LegalJurisdiction): LegalMarket {
  if (jurisdiction === 'GB') return 'uk';
  if (jurisdiction.startsWith('US-')) return 'us';
  if (jurisdiction.startsWith('CA-')) return 'canada';
  if (jurisdiction.startsWith('AU-')) return 'australia';
  if ((MIDDLE_EAST_JURISDICTIONS as readonly string[]).includes(jurisdiction)) {
    return 'middle-east';
  }
  return 'eu';
}

export const PENDING_LEGAL_JURISDICTION_REVIEWS = Object.freeze(
  Object.fromEntries(LEGAL_JURISDICTIONS.map((jurisdiction) => [jurisdiction, 'pending'])) as Record<
    LegalJurisdiction,
    LegalReviewState
  >,
);

export const LEGAL_PRODUCT_TYPES = [
  'personalised-physical-brick-kit',
  'customer-upload-and-generation-service',
  'account-order-support',
] as const;
export type LegalProductType = (typeof LEGAL_PRODUCT_TYPES)[number];

export type LegalDocumentId = 'terms-of-sale' | 'privacy-notice';
export type LegalDocumentStatus = 'draft-counsel-review' | 'approved-for-release';
export type LegalReviewState = 'pending' | 'approved' | 'rejected' | 'not-applicable';
export type LegalReleaseUse =
  | 'public-page'
  | 'checkout-terms-agreement'
  | 'checkout-privacy-presentation';

export interface LegalApplicability {
  /** Markets this baseline is intended to cover after separate market review. */
  readonly intendedMarkets: readonly LegalMarket[];
  /** Country/subdivision legal scopes; never substitute a shipping zone here. */
  readonly intendedJurisdictions: readonly LegalJurisdiction[];
  readonly productTypes: readonly LegalProductType[];
  readonly languageVersions: readonly LegalLanguageVersion[];
  /** A language choice never selects governing law or proves market approval. */
  readonly languageVersionsAreJurisdictionalVariants: false;
  readonly scopeNote: string;
}

export interface LegalApprovalRecord {
  readonly businessReview: LegalReviewState;
  readonly counselReview: LegalReviewState;
  readonly marketReviews: Readonly<Record<LegalMarket, LegalReviewState>>;
  readonly languageReviews: Readonly<Record<LegalLanguageVersion, LegalReviewState>>;
  readonly jurisdictionReviews: Readonly<Record<LegalJurisdiction, LegalReviewState>>;
  readonly permittedUses: readonly LegalReleaseUse[];
  readonly productSafetyReview: LegalReviewState;
  readonly productTypeReviews: Readonly<Record<LegalProductType, LegalReviewState>>;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  /** Must exactly match metadata.version; editing copy requires a new review. */
  readonly approvedVersion: string | null;
  /** Exact approvals; the independent review summaries above never authorise release alone. */
  readonly releaseScopes: readonly LegalReleaseScopeApproval[];
}

export interface LegalReleaseScopeApproval {
  readonly language: LegalLanguageVersion;
  readonly market: LegalMarket;
  readonly jurisdiction: LegalJurisdiction;
  readonly productType: LegalProductType;
  readonly permittedUses: readonly LegalReleaseUse[];
  readonly businessReview: LegalReviewState;
  readonly counselReview: LegalReviewState;
  readonly productSafetyReview: LegalReviewState;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedVersion: string | null;
}

export interface LegalDocumentMetadata {
  readonly documentId: LegalDocumentId;
  readonly documentOwner: 'PixBrik';
  readonly status: LegalDocumentStatus;
  readonly version: string;
  readonly revision: number;
  readonly lastEditedAt: string;
  readonly effectiveAt: string | null;
  readonly supersedesVersion: string | null;
  readonly publishable: boolean;
  readonly applicability: LegalApplicability;
  readonly approval: LegalApprovalRecord;
  readonly sourceUrls: readonly string[];
  readonly reviewFlags: readonly string[];
}

export type LegalGateBlocker =
  | 'invalid-evaluation-date'
  | 'document-not-approved'
  | 'document-not-publishable'
  | 'missing-effective-date'
  | 'invalid-effective-date'
  | 'document-not-effective'
  | 'missing-approval-record'
  | 'invalid-approval-date'
  | 'approval-version-mismatch'
  | 'business-review-incomplete'
  | 'counsel-review-incomplete'
  | 'market-out-of-scope'
  | 'market-review-incomplete'
  | 'jurisdiction-out-of-scope'
  | 'jurisdiction-market-mismatch'
  | 'jurisdiction-review-incomplete'
  | 'language-version-out-of-scope'
  | 'language-review-incomplete'
  | 'product-type-out-of-scope'
  | 'product-type-review-incomplete'
  | 'product-safety-review-incomplete'
  | 'release-scope-not-approved'
  | 'release-scope-approval-incomplete'
  | 'release-scope-approval-date-invalid'
  | 'release-scope-version-mismatch'
  | 'release-scope-safety-review-incomplete'
  | 'release-use-document-mismatch'
  | 'release-use-not-approved';

export interface LegalGateRequest {
  /** ISO timestamp override for deterministic CI/tests; defaults to now. */
  evaluatedAt?: string;
  jurisdiction: LegalJurisdiction;
  language: LegalLanguageVersion;
  market: LegalMarket;
  productType: LegalProductType;
  use: LegalReleaseUse;
}

export interface LegalGateDecision {
  allowed: boolean;
  blockers: readonly LegalGateBlocker[];
  documentId: LegalDocumentId;
  version: string;
}

function isApproved(state: LegalReviewState) {
  return state === 'approved';
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Evaluate every release condition. Never use `publishable` alone as an
 * approval signal.
 */
export function evaluateLegalRelease(
  metadata: LegalDocumentMetadata,
  request: LegalGateRequest,
): LegalGateDecision {
  const blockers: LegalGateBlocker[] = [];
  const requestedEvaluationTime = parseTimestamp(request.evaluatedAt);
  if (request.evaluatedAt && requestedEvaluationTime === null) {
    blockers.push('invalid-evaluation-date');
  }
  const evaluatedAt = requestedEvaluationTime ?? Date.now();
  const effectiveAt = parseTimestamp(metadata.effectiveAt);

  if (metadata.status !== 'approved-for-release') blockers.push('document-not-approved');
  if (!metadata.publishable) blockers.push('document-not-publishable');
  if (!metadata.effectiveAt) blockers.push('missing-effective-date');
  else if (effectiveAt === null) blockers.push('invalid-effective-date');
  else if (effectiveAt > evaluatedAt) blockers.push('document-not-effective');
  if (!metadata.approval.approvedAt || !metadata.approval.approvedBy?.trim()) {
    blockers.push('missing-approval-record');
  }
  const globalApprovedAt = parseTimestamp(metadata.approval.approvedAt);
  if (
    metadata.approval.approvedAt &&
    (globalApprovedAt === null || globalApprovedAt > evaluatedAt)
  ) {
    blockers.push('invalid-approval-date');
  }
  if (metadata.approval.approvedVersion !== metadata.version) {
    blockers.push('approval-version-mismatch');
  }
  if (!isApproved(metadata.approval.businessReview)) blockers.push('business-review-incomplete');
  if (!isApproved(metadata.approval.counselReview)) blockers.push('counsel-review-incomplete');

  if (!metadata.applicability.intendedMarkets.includes(request.market)) {
    blockers.push('market-out-of-scope');
  } else if (!isApproved(metadata.approval.marketReviews[request.market])) {
    blockers.push('market-review-incomplete');
  }

  if (!metadata.applicability.intendedJurisdictions.includes(request.jurisdiction)) {
    blockers.push('jurisdiction-out-of-scope');
  } else {
    if (legalJurisdictionMarket(request.jurisdiction) !== request.market) {
      blockers.push('jurisdiction-market-mismatch');
    }
    if (!isApproved(metadata.approval.jurisdictionReviews[request.jurisdiction])) {
      blockers.push('jurisdiction-review-incomplete');
    }
  }

  if (!metadata.applicability.languageVersions.includes(request.language)) {
    blockers.push('language-version-out-of-scope');
  } else if (!isApproved(metadata.approval.languageReviews[request.language])) {
    blockers.push('language-review-incomplete');
  }

  if (!metadata.applicability.productTypes.includes(request.productType)) {
    blockers.push('product-type-out-of-scope');
  } else if (!isApproved(metadata.approval.productTypeReviews[request.productType])) {
    blockers.push('product-type-review-incomplete');
  }

  if (
    metadata.documentId === 'terms-of-sale' &&
    request.productType === 'personalised-physical-brick-kit' &&
    !isApproved(metadata.approval.productSafetyReview)
  ) {
    blockers.push('product-safety-review-incomplete');
  }

  const useMatchesDocument =
    request.use === 'public-page' ||
    (metadata.documentId === 'terms-of-sale' && request.use === 'checkout-terms-agreement') ||
    (metadata.documentId === 'privacy-notice' &&
      request.use === 'checkout-privacy-presentation');
  if (!useMatchesDocument) blockers.push('release-use-document-mismatch');

  if (!metadata.approval.permittedUses.includes(request.use)) {
    blockers.push('release-use-not-approved');
  }

  const scopeApproval = metadata.approval.releaseScopes.find(
    (scope) =>
      scope.language === request.language &&
      scope.market === request.market &&
      scope.jurisdiction === request.jurisdiction &&
      scope.productType === request.productType &&
      scope.permittedUses.includes(request.use),
  );
  if (!scopeApproval) {
    blockers.push('release-scope-not-approved');
  } else {
    if (
      !isApproved(scopeApproval.businessReview) ||
      !isApproved(scopeApproval.counselReview) ||
      !scopeApproval.approvedAt ||
      !scopeApproval.approvedBy?.trim()
    ) {
      blockers.push('release-scope-approval-incomplete');
    }
    const scopeApprovedAt = parseTimestamp(scopeApproval.approvedAt);
    if (
      scopeApproval.approvedAt &&
      (scopeApprovedAt === null || scopeApprovedAt > evaluatedAt)
    ) {
      blockers.push('release-scope-approval-date-invalid');
    }
    if (scopeApproval.approvedVersion !== metadata.version) {
      blockers.push('release-scope-version-mismatch');
    }
    if (
      metadata.documentId === 'terms-of-sale' &&
      request.productType === 'personalised-physical-brick-kit' &&
      !isApproved(scopeApproval.productSafetyReview)
    ) {
      blockers.push('release-scope-safety-review-incomplete');
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    documentId: metadata.documentId,
    version: metadata.version,
  };
}

/** Fail-closed CI/server helper. */
export function assertLegalReleaseApproved(
  metadata: LegalDocumentMetadata,
  request: LegalGateRequest,
): void {
  const decision = evaluateLegalRelease(metadata, request);
  if (!decision.allowed) {
    throw new Error(
      `Legal release blocked for ${decision.documentId}@${decision.version}: ${decision.blockers.join(', ')}`,
    );
  }
}

export interface LegalLaunchRequirement {
  readonly document: LegalDocumentMetadata;
  readonly request: LegalGateRequest;
}

export function assertLegalLaunchApproved(requirements: readonly LegalLaunchRequirement[]): void {
  if (requirements.length === 0) {
    throw new Error('Legal release blocked: no launch requirements were supplied');
  }
  for (const requirement of requirements) {
    assertLegalReleaseApproved(requirement.document, requirement.request);
  }
}

/**
 * Build the complete buyer-app matrix. CI should prefer this helper so a new
 * market or product type cannot be silently omitted from the release check.
 */
export function buildBuyerLegalLaunchRequirements(
  terms: LegalDocumentMetadata,
  privacy: LegalDocumentMetadata,
): readonly LegalLaunchRequirement[] {
  const requirements: LegalLaunchRequirement[] = [];

  for (const jurisdiction of LEGAL_JURISDICTIONS) {
    const market = legalJurisdictionMarket(jurisdiction);
    for (const language of LEGAL_LANGUAGE_VERSIONS) {
      for (const productType of LEGAL_PRODUCT_TYPES) {
        if (terms.applicability.productTypes.includes(productType)) {
          requirements.push(
            {
              document: terms,
              request: { jurisdiction, language, market, productType, use: 'public-page' },
            },
            {
              document: terms,
              request: {
                jurisdiction,
                language,
                market,
                productType,
                use: 'checkout-terms-agreement',
              },
            },
          );
        }
        if (privacy.applicability.productTypes.includes(productType)) {
          requirements.push(
            {
              document: privacy,
              request: { jurisdiction, language, market, productType, use: 'public-page' },
            },
            {
              document: privacy,
              request: {
                jurisdiction,
                language,
                market,
                productType,
                use: 'checkout-privacy-presentation',
              },
            },
          );
        }
      }
    }
  }

  return requirements;
}

export function assertBuyerLegalLaunchApproved(
  terms: LegalDocumentMetadata,
  privacy: LegalDocumentMetadata,
): void {
  assertLegalLaunchApproved(buildBuyerLegalLaunchRequirements(terms, privacy));
}

/**
 * Draft copy is visible locally and in an explicitly labelled preview
 * deployment only. A public production build cannot be unlocked by the draft
 * flag alone.
 */
export function isLegalDraftPreviewAllowed(requested = true): boolean {
  if (!requested) return false;
  if (process.env.NODE_ENV !== 'production') return true;
  return (
    process.env.EXPO_PUBLIC_DEPLOYMENT_ENV === 'preview' &&
    process.env.EXPO_PUBLIC_LEGAL_DRAFTS_ENABLED === '1'
  );
}
