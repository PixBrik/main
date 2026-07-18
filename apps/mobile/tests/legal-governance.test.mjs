import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleCache = new Map();

function loadTypeScriptModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  const cached = moduleCache.get(resolvedPath);
  if (cached) return cached.exports;

  const source = readFileSync(resolvedPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: resolvedPath,
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);

  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) throw new Error(`Unexpected test dependency: ${specifier}`);
    const base = path.resolve(path.dirname(resolvedPath), specifier);
    const dependency = existsSync(base) ? base : `${base}.ts`;
    return loadTypeScriptModule(dependency);
  };

  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(
    module.exports,
    localRequire,
    module,
    resolvedPath,
    path.dirname(resolvedPath),
  );
  return module.exports;
}

const governance = loadTypeScriptModule(
  path.join(root, 'src', 'legal', 'legalGovernance.ts'),
);
const content = loadTypeScriptModule(path.join(root, 'src', 'legal', 'legalContent.ts'));

const approveEvery = (record) =>
  Object.fromEntries(Object.keys(record).map((key) => [key, 'approved']));

const approvedReleaseScopes = (metadata) => {
  const uses =
    metadata.documentId === 'terms-of-sale'
      ? ['public-page', 'checkout-terms-agreement']
      : ['public-page', 'checkout-privacy-presentation'];
  return governance.LEGAL_JURISDICTIONS.flatMap((jurisdiction) =>
    governance.LEGAL_LANGUAGE_VERSIONS.flatMap((language) =>
      metadata.applicability.productTypes.map((productType) => ({
        language,
        market: governance.legalJurisdictionMarket(jurisdiction),
        jurisdiction,
        productType,
        permittedUses: uses,
        businessReview: 'approved',
        counselReview: 'approved',
        productSafetyReview:
          metadata.documentId === 'terms-of-sale' &&
          productType === 'personalised-physical-brick-kit'
            ? 'approved'
            : 'not-applicable',
        approvedAt: '2026-07-10T12:00:00.000Z',
        approvedBy: 'scope-counsel@example.test',
        approvedVersion: metadata.version,
      })),
    ),
  );
};

test('current terms and privacy drafts fail closed for their intended checkout uses', () => {
  const termsDecision = governance.evaluateLegalRelease(content.TERMS_METADATA, {
    jurisdiction: 'FR',
    language: 'en',
    market: 'eu',
    productType: 'personalised-physical-brick-kit',
    use: 'checkout-terms-agreement',
  });
  assert.equal(termsDecision.allowed, false);
  assert.ok(termsDecision.blockers.includes('document-not-publishable'));
  assert.ok(termsDecision.blockers.includes('counsel-review-incomplete'));
  assert.ok(termsDecision.blockers.includes('product-safety-review-incomplete'));
  assert.throws(
    () =>
      governance.assertLegalReleaseApproved(content.TERMS_METADATA, {
        jurisdiction: 'FR',
        language: 'en',
        market: 'eu',
        productType: 'personalised-physical-brick-kit',
        use: 'checkout-terms-agreement',
      }),
    /Legal release blocked/,
  );
  assert.throws(
    () => governance.assertBuyerLegalLaunchApproved(content.TERMS_METADATA, content.PRIVACY_METADATA),
    /Legal release blocked/,
  );
  assert.throws(() => governance.assertLegalLaunchApproved([]), /no launch requirements/);

  const privacyDecision = governance.evaluateLegalRelease(content.PRIVACY_METADATA, {
    jurisdiction: 'FR',
    language: 'en',
    market: 'eu',
    productType: 'personalised-physical-brick-kit',
    use: 'checkout-privacy-presentation',
  });
  assert.equal(privacyDecision.allowed, false);
  assert.equal(privacyDecision.blockers.includes('product-safety-review-incomplete'), false);
});

test('language versions are metadata translations, separate from market approval', () => {
  assert.deepEqual(content.TERMS_METADATA.applicability.languageVersions, [
    'en',
    'fr',
    'es',
    'it',
    'ar',
  ]);
  assert.deepEqual(content.TERMS_METADATA.applicability.intendedMarkets, [
    'eu',
    'uk',
    'us',
    'canada',
    'australia',
    'middle-east',
  ]);
  assert.equal(
    content.TERMS_METADATA.applicability.languageVersionsAreJurisdictionalVariants,
    false,
  );
  assert.equal(content.TERMS_METADATA.approval.marketReviews.eu, 'pending');
  assert.equal(content.TERMS_METADATA.approval.jurisdictionReviews.FR, 'pending');
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('US-CA'));
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('CA-QC'));
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('AU-NSW'));
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('AE'));
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('BH'));
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('OM'));
  assert.ok(content.TERMS_METADATA.applicability.intendedJurisdictions.includes('SA'));
  assert.deepEqual(content.TERMS_METADATA.applicability.productTypes, [
    'personalised-physical-brick-kit',
  ]);
});

test('the gate accepts a fully reviewed matching document and rejects a mismatched use', () => {
  const approvedTerms = {
    ...content.TERMS_METADATA,
    status: 'approved-for-release',
    publishable: true,
    effectiveAt: '2026-07-11T00:00:00.000Z',
    approval: {
      ...content.TERMS_METADATA.approval,
      approvedAt: '2026-07-10T12:00:00.000Z',
      approvedBy: 'counsel@example.test',
      approvedVersion: content.TERMS_METADATA.version,
      businessReview: 'approved',
      counselReview: 'approved',
      languageReviews: approveEvery(content.TERMS_METADATA.approval.languageReviews),
      jurisdictionReviews: approveEvery(content.TERMS_METADATA.approval.jurisdictionReviews),
      marketReviews: approveEvery(content.TERMS_METADATA.approval.marketReviews),
      productTypeReviews: approveEvery(content.TERMS_METADATA.approval.productTypeReviews),
      productSafetyReview: 'approved',
      permittedUses: ['public-page', 'checkout-terms-agreement'],
      releaseScopes: approvedReleaseScopes(content.TERMS_METADATA),
    },
  };

  assert.equal(
    governance.evaluateLegalRelease(approvedTerms, {
      evaluatedAt: '2026-07-18T12:00:00.000Z',
      jurisdiction: 'FR',
      language: 'en',
      market: 'eu',
      productType: 'personalised-physical-brick-kit',
      use: 'checkout-terms-agreement',
    }).allowed,
    true,
  );

  const mismatch = governance.evaluateLegalRelease(approvedTerms, {
    evaluatedAt: '2026-07-18T12:00:00.000Z',
    jurisdiction: 'FR',
    language: 'en',
    market: 'eu',
    productType: 'personalised-physical-brick-kit',
    use: 'checkout-privacy-presentation',
  });
  assert.equal(mismatch.allowed, false);
  assert.ok(mismatch.blockers.includes('release-use-document-mismatch'));

  const futureDocument = governance.evaluateLegalRelease(
    { ...approvedTerms, effectiveAt: '2026-08-01T00:00:00.000Z' },
    {
      evaluatedAt: '2026-07-18T12:00:00.000Z',
      jurisdiction: 'FR',
      language: 'en',
      market: 'eu',
      productType: 'personalised-physical-brick-kit',
      use: 'checkout-terms-agreement',
    },
  );
  assert.equal(futureDocument.allowed, false);
  assert.ok(futureDocument.blockers.includes('document-not-effective'));

  const approvedPrivacy = {
    ...content.PRIVACY_METADATA,
    status: 'approved-for-release',
    publishable: true,
    effectiveAt: '2026-07-11T00:00:00.000Z',
    approval: {
      ...content.PRIVACY_METADATA.approval,
      approvedAt: '2026-07-10T12:00:00.000Z',
      approvedBy: 'privacy-counsel@example.test',
      approvedVersion: content.PRIVACY_METADATA.version,
      businessReview: 'approved',
      counselReview: 'approved',
      languageReviews: approveEvery(content.PRIVACY_METADATA.approval.languageReviews),
      jurisdictionReviews: approveEvery(content.PRIVACY_METADATA.approval.jurisdictionReviews),
      marketReviews: approveEvery(content.PRIVACY_METADATA.approval.marketReviews),
      productTypeReviews: approveEvery(content.PRIVACY_METADATA.approval.productTypeReviews),
      permittedUses: ['public-page', 'checkout-privacy-presentation'],
      releaseScopes: approvedReleaseScopes(content.PRIVACY_METADATA),
    },
  };
  assert.doesNotThrow(() =>
    governance.assertBuyerLegalLaunchApproved(approvedTerms, approvedPrivacy),
  );
});

test('privacy copy records presentation, not acceptance or mandatory acknowledgement', () => {
  const finalParagraph = (locale) => content.PRIVACY_COPY[locale].sections.at(-1).paragraphs.at(-1);

  assert.match(finalParagraph('en'), /notice presented at checkout/);
  assert.doesNotMatch(finalParagraph('en'), /notice version accepted/i);
  assert.doesNotMatch(finalParagraph('en'), /acknowledg/i);
  assert.match(finalParagraph('fr'), /avis présentée lors du paiement/);
  assert.doesNotMatch(finalParagraph('fr'), /avis acceptée/i);
  assert.doesNotMatch(finalParagraph('fr'), /prise de connaissance/i);
  assert.match(finalParagraph('es'), /aviso presentada al pagar/);
  assert.doesNotMatch(finalParagraph('es'), /aviso aceptada/i);
  assert.doesNotMatch(finalParagraph('es'), /lectura/i);
  assert.match(finalParagraph('it'), /informativa presentata al checkout/);
  assert.doesNotMatch(finalParagraph('it'), /versione accettata/i);
  assert.doesNotMatch(finalParagraph('it'), /presa visione/i);
  assert.match(finalParagraph('ar'), /الإشعار التي عُرضت عند الدفع/);
  assert.doesNotMatch(finalParagraph('ar'), /الإشعار المقبولة/);
  assert.doesNotMatch(finalParagraph('ar'), /الإقرار بالاطلاع/);
});

test('known translation-equivalence defects stay corrected', () => {
  assert.match(content.TERMS_COPY.ar.sections[1].paragraphs[1], /مستوى التعبئة/);
  assert.match(content.PRIVACY_COPY.ar.sections[1].bullets[3], /ملفات تعريف الارتباط/);
  assert.match(content.TERMS_COPY.es.sections[2].paragraphs[0], /proveedores de servicios identificados/);
  assert.match(content.TERMS_COPY.fr.sections[3].paragraphs[0], /confirme qu’elle a accepté/);
  assert.match(content.TERMS_COPY.it.sections[3].paragraphs[0], /conferma di avere accettato/);
  assert.match(
    content.PRIVACY_COPY.it.sections[3].paragraphs[0],
    /responsabili e sub-responsabili del trattamento/,
  );
  assert.match(content.TERMS_COPY.en.sections[5].paragraphs[2], /not offered by PixBrik/);
});

test('legal frame isolates RTL layout without reversing the PixBrik wordmark', () => {
  const frameSource = readFileSync(
    path.join(root, 'src', 'components', 'legal', 'LegalPageFrame.tsx'),
    'utf8',
  );
  assert.match(frameSource, /Platform\.select<ViewStyle>/);
  assert.match(frameSource, /LTR_VIEW_DIRECTION/);
  assert.match(frameSource, /writingDirection:\s*['"]ltr['"]/);
  assert.match(frameSource, /writingDirection:\s*['"]rtl['"]/);
});

test('draft preview flag cannot unlock a public production deployment', () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    deploymentEnv: process.env.EXPO_PUBLIC_DEPLOYMENT_ENV,
    draftsEnabled: process.env.EXPO_PUBLIC_LEGAL_DRAFTS_ENABLED,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_LEGAL_DRAFTS_ENABLED = '1';
    process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = 'production';
    assert.equal(governance.isLegalDraftPreviewAllowed(), false);

    process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = 'preview';
    assert.equal(governance.isLegalDraftPreviewAllowed(), true);
    assert.equal(governance.isLegalDraftPreviewAllowed(false), false);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.deploymentEnv === undefined) delete process.env.EXPO_PUBLIC_DEPLOYMENT_ENV;
    else process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = previous.deploymentEnv;
    if (previous.draftsEnabled === undefined) delete process.env.EXPO_PUBLIC_LEGAL_DRAFTS_ENABLED;
    else process.env.EXPO_PUBLIC_LEGAL_DRAFTS_ENABLED = previous.draftsEnabled;
  }
});

test('contact remains public while unapproved legal documents stay gated', () => {
  const appSource = readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const menuSource = readFileSync(
    path.join(root, 'src', 'components', 'TopMenu.tsx'),
    'utf8',
  );
  const availabilitySource = readFileSync(
    path.join(root, 'src', 'lib', 'legalAvailability.ts'),
    'utf8',
  );

  const legalScreenDeclaration = appSource.match(
    /const LEGAL_DOCUMENT_SCREENS = new Set<DemoScreen>\(\[([^\]]*)\]\);/,
  );
  assert.ok(legalScreenDeclaration);
  assert.match(legalScreenDeclaration[1], /'legal'/);
  assert.match(legalScreenDeclaration[1], /'terms'/);
  assert.match(legalScreenDeclaration[1], /'privacy'/);
  assert.doesNotMatch(legalScreenDeclaration[1], /'contact'/);
  assert.match(appSource, /if \(candidate === 'contact'\) return candidate/);
  assert.match(menuSource, /label: 'CONTACT', screen: 'contact'/);
  assert.match(availabilitySource, /assertBuyerLegalLaunchApproved/);
});
