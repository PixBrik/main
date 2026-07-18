import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadTypeScriptModule(relativePath) {
  const filename = path.join(appRoot, relativePath);
  const source = await readFile(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    loaded.exports,
    require,
    loaded,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
}

const discounts = await loadTypeScriptModule('src/lib/commerce/discounts.ts');
const recovery = await loadTypeScriptModule('src/lib/commerce/checkoutRecovery.ts');

const now = Date.parse('2026-07-18T12:00:00Z');

function discountDefinition(overrides = {}) {
  return {
    code: 'WELCOME12',
    enabled: true,
    id: 'discount_welcome_12',
    redemption: { mode: 'reusable' },
    validFrom: '2026-07-18T00:00:00Z',
    validUntil: '2026-07-20T00:00:00Z',
    value: { rateBasisPoints: 1_250, type: 'percentage' },
    ...overrides,
  };
}

function discountContext(overrides = {}) {
  return {
    buildCategoryIds: ['portrait'],
    completedOrderCount: 0,
    completedOrderCountCustomerKey: 'customer_1',
    customerKey: 'customer_1',
    customerSegments: ['new_customer'],
    marketCode: 'EU',
    nowEpochMs: now,
    subtotalEurMinor: 1_999,
    usage: {
      customerKey: 'customer_1',
      discountId: 'discount_welcome_12',
      successfulCustomerUses: 0,
      successfulGlobalUses: 0,
    },
    ...overrides,
  };
}

test('percentage and fixed EUR discounts use deterministic integer minor-unit arithmetic', () => {
  const percentage = discounts.evaluateDiscount(
    discountDefinition(),
    '  welcome12  ',
    discountContext(),
  );
  assert.equal(percentage.eligible, true);
  assert.equal(percentage.normalizedCode, 'WELCOME12');
  assert.equal(percentage.discountEurMinor, 250, '12.5% of EUR 19.99 rounds half-up to EUR 2.50');
  assert.equal(percentage.subtotalAfterDiscountEurMinor, 1_749);

  const capped = discounts.evaluateDiscount(
    discountDefinition({
      value: { maximumDiscountEurMinor: 175, rateBasisPoints: 5_000, type: 'percentage' },
    }),
    'WELCOME12',
    discountContext(),
  );
  assert.equal(capped.discountEurMinor, 175);

  const fixed = discounts.evaluateDiscount(
    discountDefinition({ value: { amountEurMinor: 5_000, type: 'fixed_eur' } }),
    'WELCOME12',
    discountContext({ subtotalEurMinor: 3_000 }),
  );
  assert.equal(fixed.discountEurMinor, 3_000, 'a discount can never make the subtotal negative');
  assert.equal(fixed.subtotalAfterDiscountEurMinor, 0);
});

test('validity, disabling, usage caps and customer policy are enforced from server snapshots', () => {
  const disabled = discounts.evaluateDiscount(
    discountDefinition({ enabled: false }),
    'WELCOME12',
    discountContext(),
  );
  assert.deepEqual(disabled.code, 'disabled');

  const startsAtBoundary = discounts.evaluateDiscount(
    discountDefinition(),
    'WELCOME12',
    discountContext({ nowEpochMs: Date.parse('2026-07-18T00:00:00Z') }),
  );
  assert.equal(startsAtBoundary.eligible, true);
  const expiresAtBoundary = discounts.evaluateDiscount(
    discountDefinition(),
    'WELCOME12',
    discountContext({ nowEpochMs: Date.parse('2026-07-20T00:00:00Z') }),
  );
  assert.equal(expiresAtBoundary.code, 'expired');

  const globallyUsed = discounts.evaluateDiscount(
    discountDefinition({ maxGlobalUses: 2 }),
    'WELCOME12',
    discountContext({
      usage: {
        customerKey: 'customer_1',
        discountId: 'discount_welcome_12',
        successfulCustomerUses: 0,
        successfulGlobalUses: 2,
      },
    }),
  );
  assert.equal(globallyUsed.code, 'global_limit_reached');

  const once = discountDefinition({ redemption: { mode: 'once_per_customer' } });
  assert.equal(
    discounts.evaluateDiscount(once, 'WELCOME12', discountContext({ customerKey: undefined })).code,
    'customer_identity_required',
  );
  assert.equal(
    discounts.evaluateDiscount(
      once,
      'WELCOME12',
      discountContext({
        usage: {
          customerKey: 'customer_1',
          discountId: 'discount_welcome_12',
          successfulCustomerUses: 1,
          successfulGlobalUses: 4,
        },
      }),
    ).code,
    'customer_limit_reached',
  );
  assert.equal(
    discounts.evaluateDiscount(
      once,
      'WELCOME12',
      discountContext({
        usage: {
          customerKey: 'customer_1',
          discountId: 'discount_welcome_12',
          successfulGlobalUses: 0,
        },
      }),
    ).code,
    'customer_usage_snapshot_required',
    'a missing authoritative customer count must never be treated as zero',
  );

  const reusableTwice = discountDefinition({
    redemption: { maxUsesPerCustomer: 2, mode: 'reusable' },
  });
  assert.equal(
    discounts.evaluateDiscount(
      reusableTwice,
      'WELCOME12',
      discountContext({
        usage: {
          customerKey: 'customer_1',
          discountId: 'discount_welcome_12',
          successfulCustomerUses: 2,
          successfulGlobalUses: 8,
        },
      }),
    ).code,
    'customer_limit_reached',
  );
  assert.equal(
    discounts.evaluateDiscount(
      reusableTwice,
      'WELCOME12',
      discountContext({
        usage: {
          customerKey: 'customer_1',
          discountId: 'discount_welcome_12',
          successfulGlobalUses: 0,
        },
      }),
    ).code,
    'customer_usage_snapshot_required',
  );
  assert.equal(
    discounts.evaluateDiscount(
      discountDefinition({ redemption: { mode: 'reusable' } }),
      'WELCOME12',
      discountContext({
        usage: { discountId: 'discount_welcome_12', successfulGlobalUses: 0 },
      }),
    ).eligible,
    true,
    'an unlimited reusable policy does not require a per-customer counter',
  );
  assert.equal(
    discounts.evaluateDiscount(
      once,
      'WELCOME12',
      discountContext({
        usage: {
          customerKey: 'another_customer',
          discountId: 'discount_welcome_12',
          successfulCustomerUses: 0,
          successfulGlobalUses: 0,
        },
      }),
    ).code,
    'usage_snapshot_mismatch',
  );
  assert.equal(
    discounts.evaluateDiscount(
      once,
      'WELCOME12',
      discountContext({
        usage: {
          customerKey: 'customer_1',
          discountId: 'another_discount',
          successfulCustomerUses: 0,
          successfulGlobalUses: 0,
        },
      }),
    ).code,
    'usage_snapshot_mismatch',
  );
  assert.equal(
    discounts.evaluateDiscount(
      once,
      'WELCOME12',
      discountContext({ customerKey: '   ' }),
    ).code,
    'customer_identity_required',
  );
});

test('eligibility rules reject ineligible customers without trusting presentation currency', () => {
  const definition = discountDefinition({
    eligibility: {
      allowedBuildCategoryIdsAny: ['portrait'],
      allowedCustomerSegmentsAny: ['vip'],
      allowedMarketCodes: ['EU', 'UK'],
      firstCompletedOrderOnly: true,
      minimumSubtotalEurMinor: 5_000,
    },
  });
  assert.equal(
    discounts.evaluateDiscount(definition, 'WELCOME12', discountContext()).code,
    'minimum_subtotal_not_met',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({ customerSegments: ['new_customer'], subtotalEurMinor: 6_000 }),
    ).code,
    'customer_segment_not_eligible',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({
        customerSegments: ['vip'],
        marketCode: 'US',
        subtotalEurMinor: 6_000,
      }),
    ).code,
    'market_not_eligible',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({
        buildCategoryIds: ['car'],
        customerSegments: ['vip'],
        subtotalEurMinor: 6_000,
      }),
    ).code,
    'build_category_not_eligible',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({
        completedOrderCount: 1,
        customerSegments: ['vip'],
        subtotalEurMinor: 6_000,
      }),
    ).code,
    'first_order_only',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({
        completedOrderCountCustomerKey: undefined,
        customerKey: undefined,
        customerSegments: ['vip'],
        subtotalEurMinor: 6_000,
      }),
    ).code,
    'customer_identity_required',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({
        completedOrderCountCustomerKey: 'another_customer',
        customerSegments: ['vip'],
        subtotalEurMinor: 6_000,
      }),
    ).code,
    'customer_activity_snapshot_required',
  );
  assert.equal(
    discounts.evaluateDiscount(
      definition,
      'WELCOME12',
      discountContext({ customerSegments: ['vip'], subtotalEurMinor: 6_000 }),
    ).eligible,
    true,
  );
  assert.throws(
    () => discounts.evaluateDiscount(definition, 'WELCOME12', discountContext({ subtotalEurMinor: 10.5 })),
    /safe integer/i,
  );
});

test('usage statistics are derived from immutable successful-redemption facts', () => {
  const events = [
    {
      channel: 'checkout',
      customerKey: 'c1',
      discountEurMinor: 500,
      discountId: 'd1',
      id: 'r1',
      occurredAtEpochMs: now + 1_000,
      orderId: 'o1',
      subtotalAfterDiscountEurMinor: 4_500,
      subtotalBeforeDiscountEurMinor: 5_000,
    },
    {
      channel: 'abandoned_checkout_email',
      customerKey: 'c1',
      discountEurMinor: 1_000,
      discountId: 'd1',
      id: 'r2',
      occurredAtEpochMs: now + 3_000,
      orderId: 'o2',
      subtotalAfterDiscountEurMinor: 9_000,
      subtotalBeforeDiscountEurMinor: 10_000,
    },
    {
      channel: 'exit_intent_popup',
      customerKey: 'c2',
      discountEurMinor: 750,
      discountId: 'd1',
      id: 'r3',
      occurredAtEpochMs: now + 2_000,
      orderId: 'o3',
      subtotalAfterDiscountEurMinor: 6_750,
      subtotalBeforeDiscountEurMinor: 7_500,
    },
  ];
  const stats = discounts.summarizeDiscountUsage(events, 'd1');
  assert.equal(stats.successfulUses, 3);
  assert.equal(stats.uniqueCustomers, 2);
  assert.equal(stats.subtotalBeforeDiscountEurMinor, 22_500);
  assert.equal(stats.discountsGrantedEurMinor, 2_250);
  assert.equal(stats.subtotalAfterDiscountEurMinor, 20_250);
  assert.equal(stats.averageOrderValueBeforeDiscountEurMinor, 7_500);
  assert.equal(stats.usesByChannel.checkout, 1);
  assert.equal(stats.usesByChannel.abandoned_checkout_email, 1);
  assert.equal(stats.firstUsedAtEpochMs, now + 1_000);
  assert.equal(stats.lastUsedAtEpochMs, now + 3_000);
});

function recoveryConfig(overrides = {}) {
  const base = {
    channels: {
      email: {
        consentPolicy: 'marketing_opt_in',
        defaultLocale: 'en',
        discountId: 'discount_recovery_10',
        enabled: true,
        fromAddress: 'PixBrik <hello@pixbrik.com>',
        replyToAddress: 'hello@pixbrik.com',
        sendAfterSeconds: [3_600, 86_400],
        stopAfterConversion: true,
        templateKeyByLocale: {
          ar: 'checkout-recovery-ar',
          en: 'checkout-recovery-en',
          es: 'checkout-recovery-es',
          fr: 'checkout-recovery-fr',
          it: 'checkout-recovery-it',
        },
      },
      exitIntentPopup: {
        blocksNavigation: false,
        bodyTranslationKey: 'checkout.recovery.popup.body',
        cooldownSeconds: 86_400,
        ctaTranslationKey: 'checkout.recovery.popup.resume',
        dismissible: true,
        dismissTranslationKey: 'checkout.recovery.popup.dismiss',
        discountId: 'discount_recovery_10',
        enabled: true,
        headlineTranslationKey: 'checkout.recovery.popup.headline',
        maxImpressionsPerSession: 1,
        minimumSessionAgeSeconds: 30,
        respectsPreviousDismissal: true,
      },
    },
    enabled: true,
    maxResumeCount: 5,
    priceLockSeconds: 3_600,
    stateRetentionSeconds: 31_536_000,
    tokenTtlSeconds: 259_200,
  };
  return {
    ...base,
    ...overrides,
    channels: {
      ...base.channels,
      ...(overrides.channels ?? {}),
    },
  };
}

function recoveryInput(tokenDigest, overrides = {}) {
  return {
    audience: { customerId: 'customer_1', mode: 'authenticated_customer' },
    build: {
      buildId: 'build_1',
      buildVersionId: 'build_version_7',
      configurationFingerprint: 'sha256:configuration',
      renderVersionId: 'render_version_4',
      sourceModelVersionId: 'model_version_3',
    },
    checkoutDraftId: 'checkout_draft_1',
    createdAtEpochMs: now,
    customerCurrency: 'GBP',
    id: 'recovery_1',
    locale: 'fr',
    marketCode: 'UK',
    quotedSubtotalEurMinor: 18_950,
    tokenDigest,
    ...overrides,
  };
}

test('recovery tokens require 256-bit entropy and persist only a keyed digest', async () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const minted = await recovery.mintCheckoutRecoveryToken(
    bytes,
    async () => 'd'.repeat(64),
  );
  assert.match(minted.rawToken, /^pbr_1_[A-Za-z0-9_-]{43}$/);
  assert.equal(minted.tokenDigest, 'd'.repeat(64));
  assert.throws(() => recovery.encodeCheckoutRecoveryToken(new Uint8Array(31)), /32-64 bytes/);

  const state = recovery.createCheckoutRecoveryState(
    recoveryInput(minted.tokenDigest),
    recoveryConfig(),
  );
  assert.equal(state.tokenDigest, minted.tokenDigest);
  assert.equal(JSON.stringify(state).includes(minted.rawToken), false);
  assert.deepEqual(state.build, recoveryInput(minted.tokenDigest).build);
  assert.equal(state.expiresAtEpochMs, now + 259_200_000);
  assert.equal(state.priceLockUntilEpochMs, now + 3_600_000);
});

test('resume validation preserves the exact build revision and revalidates identity, status and pricing', () => {
  const digest = 'a'.repeat(64);
  const config = recoveryConfig();
  const state = recovery.createCheckoutRecoveryState(recoveryInput(digest), config);
  const allowed = recovery.validateCheckoutRecoveryResume(
    state,
    {
      buildAvailability: 'available',
      expectedBuildVersionId: 'build_version_7',
      identity: { customerId: 'customer_1', mode: 'authenticated_customer' },
      nowEpochMs: now + 60_000,
      presentedTokenDigest: digest,
    },
    config,
  );
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.build.buildVersionId, 'build_version_7');
  assert.equal(allowed.build.renderVersionId, 'render_version_4');
  assert.equal(allowed.build.sourceModelVersionId, 'model_version_3');
  assert.equal(allowed.customerCurrency, 'GBP');
  assert.equal(allowed.pricingAction, 'locked_snapshot_requires_server_verification');

  const reprice = recovery.validateCheckoutRecoveryResume(
    state,
    {
      buildAvailability: 'available',
      identity: { customerId: 'customer_1', mode: 'authenticated_customer' },
      nowEpochMs: now + 3_600_000,
      presentedTokenDigest: digest,
    },
    config,
  );
  assert.equal(reprice.pricingAction, 'reprice_required');

  const baseContext = {
    buildAvailability: 'available',
    identity: { customerId: 'customer_1', mode: 'authenticated_customer' },
    nowEpochMs: now + 60_000,
    presentedTokenDigest: digest,
  };
  assert.equal(
    recovery.validateCheckoutRecoveryResume(
      state,
      { ...baseContext, presentedTokenDigest: 'b'.repeat(64) },
      config,
    ).code,
    'token_mismatch',
  );
  assert.equal(
    recovery.validateCheckoutRecoveryResume(
      state,
      {
        ...baseContext,
        identity: { customerId: 'customer_2', mode: 'authenticated_customer' },
      },
      config,
    ).code,
    'identity_mismatch',
  );
  assert.equal(
    recovery.validateCheckoutRecoveryResume(
      state,
      { ...baseContext, buildAvailability: 'withdrawn' },
      config,
    ).code,
    'build_unavailable',
  );
  assert.equal(
    recovery.validateCheckoutRecoveryResume(
      state,
      { ...baseContext, expectedBuildVersionId: 'tampered_version' },
      config,
    ).code,
    'build_reference_mismatch',
  );
  assert.equal(
    recovery.validateCheckoutRecoveryResume(
      state,
      { ...baseContext, nowEpochMs: state.expiresAtEpochMs },
      config,
    ).code,
    'expired',
  );

  const resumed = recovery.markCheckoutRecoveryResumed(state, now + 60_000, config);
  assert.equal(resumed.status, 'resumed');
  assert.equal(resumed.resumeCount, 1);
  const converted = recovery.markCheckoutRecoveryConverted(resumed, 'order_9', now + 120_000);
  assert.equal(converted.status, 'converted');
  assert.equal(converted.completedOrderId, 'order_9');
  assert.equal(
    recovery.validateCheckoutRecoveryResume(converted, baseContext, config).code,
    'already_converted',
  );
});

test('exit-intent offers require a genuine signal and remain dismissible, non-blocking and rate-limited', () => {
  const popup = recoveryConfig().channels.exitIntentPopup;
  const context = {
    checkoutAlreadyConverted: false,
    exitSignalObserved: true,
    hasRecoverableCheckout: true,
    impressionsThisSession: 0,
    marketCode: 'EU',
    nowEpochMs: now,
    sessionId: 'session_1',
    sessionStartedAtEpochMs: now - 60_000,
  };
  const offer = recovery.evaluateExitIntentOffer(popup, context);
  assert.equal(offer.present, true);
  assert.equal(offer.impressionIdempotencyKey, 'checkout-recovery:session_1:exit-intent');
  assert.equal(offer.translationKeys.dismiss, 'checkout.recovery.popup.dismiss');
  assert.equal(
    recovery.evaluateExitIntentOffer(popup, { ...context, exitSignalObserved: false }).code,
    'no_exit_signal',
  );
  assert.equal(
    recovery.evaluateExitIntentOffer(popup, { ...context, impressionsThisSession: 1 }).code,
    'session_limit_reached',
  );
  assert.equal(
    recovery.evaluateExitIntentOffer(popup, { ...context, lastDismissedAtEpochMs: now - 1_000 }).code,
    'dismissal_cooldown',
  );
  assert.throws(
    () => recovery.evaluateExitIntentOffer({ ...popup, blocksNavigation: true }, context),
    /non-blocking/i,
  );
});

test('recovery email scheduling requires consent, respects suppression and returns idempotent localized work', () => {
  const config = recoveryConfig();
  const state = recovery.createCheckoutRecoveryState(recoveryInput('c'.repeat(64)), config);
  const base = {
    deliverability: 'deliverable',
    nowEpochMs: now + 3_600_000,
    permission: 'marketing_opt_in',
    sent: [],
  };
  assert.equal(
    recovery.evaluateRecoveryEmailDelivery(config, state, { ...base, permission: 'none' }).code,
    'consent_required',
  );
  assert.equal(
    recovery.evaluateRecoveryEmailDelivery(config, state, { ...base, nowEpochMs: now + 10_000 }).code,
    'not_due',
  );
  assert.equal(
    recovery.evaluateRecoveryEmailDelivery(config, state, { ...base, deliverability: 'complained' }).code,
    'recipient_suppressed',
  );
  const first = recovery.evaluateRecoveryEmailDelivery(config, state, base);
  assert.equal(first.send, true);
  assert.equal(first.sequence, 1);
  assert.equal(first.templateKey, 'checkout-recovery-fr');
  assert.equal(first.fromAddress, 'PixBrik <hello@pixbrik.com>');
  assert.equal(first.idempotencyKey, 'checkout-recovery:recovery_1:email:1');

  const firstFact = {
    providerMessageId: 'resend_1',
    recoveryId: state.id,
    sentAtEpochMs: now + 3_600_000,
    sequence: 1,
  };
  assert.equal(
    recovery.evaluateRecoveryEmailDelivery(config, state, { ...base, sent: [firstFact] }).code,
    'not_due',
  );
  const second = recovery.evaluateRecoveryEmailDelivery(config, state, {
    ...base,
    nowEpochMs: now + 86_400_000,
    sent: [firstFact],
  });
  assert.equal(second.send, true);
  assert.equal(second.sequence, 2);

  const converted = recovery.markCheckoutRecoveryConverted(state, 'order_1', now + 4_000_000);
  assert.equal(
    recovery.evaluateRecoveryEmailDelivery(config, converted, base).code,
    'checkout_closed',
  );
});

test('invalid campaign configuration is rejected before it can create unsafe recovery state', () => {
  const invalidPopup = recoveryConfig({
    channels: {
      exitIntentPopup: {
        ...recoveryConfig().channels.exitIntentPopup,
        blocksNavigation: true,
        cooldownSeconds: 10,
        dismissible: false,
        maxImpressionsPerSession: 4,
      },
    },
  });
  const issues = recovery.validateCheckoutRecoveryConfig(invalidPopup);
  assert.ok(issues.some((issue) => /maxImpressionsPerSession/.test(issue)));
  assert.ok(issues.some((issue) => /non-blocking/.test(issue)));
  assert.ok(issues.some((issue) => /6 hours/.test(issue)));

  const invalidEmail = recoveryConfig({
    channels: {
      email: {
        ...recoveryConfig().channels.email,
        sendAfterSeconds: [3_600, 3_600],
      },
    },
  });
  assert.ok(
    recovery.validateCheckoutRecoveryConfig(invalidEmail).some((issue) => /unique, increasing/.test(issue)),
  );

  const injectedSender = recoveryConfig({
    channels: {
      email: {
        ...recoveryConfig().channels.email,
        fromAddress: 'PixBrik <hello@pixbrik.com>\r\nBcc: attacker@example.com',
      },
    },
  });
  assert.ok(
    recovery.validateCheckoutRecoveryConfig(injectedSender).some((issue) => /fromAddress is invalid/.test(issue)),
  );
});
