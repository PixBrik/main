import { PRIVACY_METADATA, TERMS_METADATA } from '../legal/legalContent';
import {
  assertBuyerLegalLaunchApproved,
  isLegalDraftPreviewAllowed,
} from '../legal/legalGovernance';

/**
 * Legal drafts are visible during local development and explicitly enabled
 * preview builds only. Production becomes public automatically only after
 * both operative documents have been marked reviewed and publishable.
 */
function isBuyerLegalReleaseApproved(): boolean {
  try {
    assertBuyerLegalLaunchApproved(TERMS_METADATA, PRIVACY_METADATA);
    return true;
  } catch {
    return false;
  }
}

export const LEGAL_CONTENT_PUBLISHABLE = isBuyerLegalReleaseApproved();

export const LEGAL_CONTENT_AVAILABLE =
  LEGAL_CONTENT_PUBLISHABLE || isLegalDraftPreviewAllowed();
