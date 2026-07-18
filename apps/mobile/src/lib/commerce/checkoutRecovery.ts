/**
 * Framework-neutral abandoned-checkout recovery contracts.
 *
 * Recovery links point to opaque, high-entropy tokens. Persist only a keyed
 * digest (for example HMAC-SHA-256 with a server secret), never the raw token.
 * The database remains authoritative for the checkout, build and pricing.
 */

export const CHECKOUT_RECOVERY_VERSION = 1;
export const CHECKOUT_RECOVERY_TOKEN_PREFIX = 'pbr_1_';
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 64;

export type RecoveryEmailConsentPolicy =
  | 'marketing_opt_in'
  | 'documented_soft_opt_in';

export interface RecoveryEmailChannelConfig {
  enabled: boolean;
  fromAddress: string;
  replyToAddress?: string;
  defaultLocale: string;
  /** Resend/React Email template key per locale, not user-editable HTML. */
  templateKeyByLocale: Readonly<Record<string, string>>;
  /** Strictly increasing offsets from checkout creation; maximum three reminders. */
  sendAfterSeconds: readonly number[];
  consentPolicy: RecoveryEmailConsentPolicy;
  discountId?: string;
  stopAfterConversion: true;
}

export interface ExitIntentPopupConfig {
  enabled: boolean;
  discountId?: string;
  allowedMarketCodes?: readonly string[];
  minimumSessionAgeSeconds: number;
  cooldownSeconds: number;
  maxImpressionsPerSession: 1;
  /** Accessibility and anti-dark-pattern invariants. */
  dismissible: true;
  blocksNavigation: false;
  respectsPreviousDismissal: true;
  headlineTranslationKey: string;
  bodyTranslationKey: string;
  ctaTranslationKey: string;
  dismissTranslationKey: string;
}

export interface CheckoutRecoveryConfig {
  enabled: boolean;
  tokenTtlSeconds: number;
  /** Retention may exceed link validity for attribution/audit purposes. */
  stateRetentionSeconds: number;
  /** A resumed checkout is repriced after this interval. Zero means always reprice. */
  priceLockSeconds: number;
  maxResumeCount: number;
  channels: {
    email: RecoveryEmailChannelConfig;
    exitIntentPopup: ExitIntentPopupConfig;
  };
}

export interface CheckoutBuildReference {
  buildId: string;
  /** Immutable approved build revision. */
  buildVersionId: string;
  /** Exact customer-approved brick rendering revision. */
  renderVersionId: string;
  /** Exact source 3D asset revision, when the build came from a 3D workflow. */
  sourceModelVersionId?: string;
  /** Server-generated hash of size, fill, palette and catalog selections. */
  configurationFingerprint: string;
}

export type RecoveryAudience =
  | {
      mode: 'authenticated_customer';
      customerId: string;
    }
  | {
      mode: 'verified_email';
      /** Keyed, normalized email fingerprint; never a raw email address. */
      emailFingerprint: string;
    };

export type CheckoutRecoveryStatus =
  | 'active'
  | 'resumed'
  | 'converted'
  | 'revoked'
  | 'expired';

export interface CheckoutRecoveryState {
  version: typeof CHECKOUT_RECOVERY_VERSION;
  id: string;
  checkoutDraftId: string;
  /** Digest of the raw URL token. The raw token must never be persisted. */
  tokenDigest: string;
  status: CheckoutRecoveryStatus;
  audience: RecoveryAudience;
  build: CheckoutBuildReference;
  locale: string;
  customerCurrency: string;
  marketCode: string;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
  retainUntilEpochMs: number;
  priceLockUntilEpochMs: number;
  quotedSubtotalEurMinor: number;
  appliedDiscountId?: string;
  resumeCount: number;
  lastResumedAtEpochMs?: number;
  convertedAtEpochMs?: number;
  completedOrderId?: string;
  revokedAtEpochMs?: number;
  revocationReason?: string;
}

export interface CreateCheckoutRecoveryInput {
  id: string;
  checkoutDraftId: string;
  tokenDigest: string;
  audience: RecoveryAudience;
  build: CheckoutBuildReference;
  locale: string;
  customerCurrency: string;
  marketCode: string;
  createdAtEpochMs: number;
  quotedSubtotalEurMinor: number;
  appliedDiscountId?: string;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function looksLikeAddressSpec(value: string): boolean {
  if (value.length > 254 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator !== value.indexOf('@')) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
  ) {
    return false;
  }
  if (domain.length > 253 || !domain.includes('.')) return false;
  return domain.split('.').every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

/** Accepts a single raw mailbox or a safe `Display Name <mailbox>` value. */
function looksLikeMailbox(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 320 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  if (looksLikeAddressSpec(value)) return true;

  const displayMailbox = /^([^<>]+?)\s*<([^<>]+)>$/.exec(value);
  if (!displayMailbox) return false;
  const displayName = displayMailbox[1]?.trim() ?? '';
  const address = displayMailbox[2]?.trim() ?? '';
  return (
    /^[\p{L}\p{N}][\p{L}\p{N} .,'’&()_-]{0,126}$/u.test(displayName) &&
    looksLikeAddressSpec(address)
  );
}

function addSeconds(epochMs: number, seconds: number): number {
  const result = epochMs + seconds * 1_000;
  if (!Number.isSafeInteger(result)) throw new Error('Recovery timestamp exceeds safe precision');
  return result;
}

function validateExitIntentPopup(config: ExitIntentPopupConfig, issues: string[]): void {
  if (!isPositiveInteger(config.minimumSessionAgeSeconds) || config.minimumSessionAgeSeconds < 15) {
    issues.push('exit popup minimumSessionAgeSeconds must be at least 15');
  }
  if (!isPositiveInteger(config.cooldownSeconds) || config.cooldownSeconds < 21_600) {
    issues.push('exit popup cooldownSeconds must be at least 21_600 (6 hours)');
  }
  if (config.maxImpressionsPerSession !== 1) {
    issues.push('exit popup maxImpressionsPerSession must be exactly 1');
  }
  if (!config.dismissible || config.blocksNavigation || !config.respectsPreviousDismissal) {
    issues.push('exit popup must be dismissible, non-blocking and respect dismissal');
  }
  for (const [field, value] of Object.entries({
    bodyTranslationKey: config.bodyTranslationKey,
    ctaTranslationKey: config.ctaTranslationKey,
    dismissTranslationKey: config.dismissTranslationKey,
    headlineTranslationKey: config.headlineTranslationKey,
  })) {
    if (!nonEmpty(value)) issues.push(`exit popup ${field} is required`);
  }
  if (
    config.allowedMarketCodes !== undefined &&
    (config.allowedMarketCodes.length === 0 || config.allowedMarketCodes.some((code) => !nonEmpty(code)))
  ) {
    issues.push('exit popup allowedMarketCodes must contain non-empty values');
  }
}

/** Returns admin-facing configuration validation errors. */
export function validateCheckoutRecoveryConfig(
  config: CheckoutRecoveryConfig,
): readonly string[] {
  const issues: string[] = [];
  if (
    !isPositiveInteger(config.tokenTtlSeconds) ||
    config.tokenTtlSeconds < 900 ||
    config.tokenTtlSeconds > 2_592_000
  ) {
    issues.push('tokenTtlSeconds must be between 900 and 2_592_000 (30 days)');
  }
  if (
    !isPositiveInteger(config.stateRetentionSeconds) ||
    config.stateRetentionSeconds < config.tokenTtlSeconds ||
    config.stateRetentionSeconds > 63_072_000
  ) {
    issues.push('stateRetentionSeconds must cover token TTL and be at most two years');
  }
  if (
    !isNonNegativeInteger(config.priceLockSeconds) ||
    config.priceLockSeconds > config.tokenTtlSeconds
  ) {
    issues.push('priceLockSeconds must be non-negative and no longer than the token TTL');
  }
  if (!isPositiveInteger(config.maxResumeCount) || config.maxResumeCount > 100) {
    issues.push('maxResumeCount must be an integer from 1 to 100');
  }

  const email = config.channels.email;
  if (email.enabled) {
    if (!looksLikeMailbox(email.fromAddress)) issues.push('email fromAddress is invalid');
    if (email.replyToAddress !== undefined && !looksLikeMailbox(email.replyToAddress)) {
      issues.push('email replyToAddress is invalid');
    }
    if (!nonEmpty(email.defaultLocale)) issues.push('email defaultLocale is required');
    const templates = Object.entries(email.templateKeyByLocale);
    if (templates.length === 0 || templates.some(([locale, key]) => !nonEmpty(locale) || !nonEmpty(key))) {
      issues.push('email templateKeyByLocale must contain non-empty locale/template pairs');
    }
    if (!nonEmpty(email.templateKeyByLocale[email.defaultLocale] ?? '')) {
      issues.push('email defaultLocale must have a template');
    }
    if (email.sendAfterSeconds.length === 0 || email.sendAfterSeconds.length > 3) {
      issues.push('email sendAfterSeconds must contain one to three reminders');
    }
    let previous = 0;
    for (const delay of email.sendAfterSeconds) {
      if (
        !isPositiveInteger(delay) ||
        delay < 900 ||
        delay <= previous ||
        delay >= config.tokenTtlSeconds
      ) {
        issues.push('email reminder delays must be unique, increasing, at least 900 and before expiry');
        break;
      }
      previous = delay;
    }
    if (!email.stopAfterConversion) issues.push('email reminders must stop after conversion');
  }

  if (config.channels.exitIntentPopup.enabled) {
    validateExitIntentPopup(config.channels.exitIntentPopup, issues);
  }
  return issues;
}

export function assertValidCheckoutRecoveryConfig(config: CheckoutRecoveryConfig): void {
  const issues = validateCheckoutRecoveryConfig(config);
  if (issues.length > 0) throw new Error(`Invalid checkout recovery config: ${issues.join('; ')}`);
}

function base64UrlEncode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    if (first === undefined) break;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      result += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) result += alphabet[third & 63];
  }
  return result;
}

/**
 * Encodes caller-provided CSPRNG bytes as an opaque URL token.
 * Callers must obtain the bytes from a cryptographically secure server RNG.
 */
export function encodeCheckoutRecoveryToken(randomBytes: Uint8Array): string {
  if (randomBytes.length < MIN_TOKEN_BYTES || randomBytes.length > MAX_TOKEN_BYTES) {
    throw new Error(`Recovery token entropy must be ${MIN_TOKEN_BYTES}-${MAX_TOKEN_BYTES} bytes`);
  }
  return `${CHECKOUT_RECOVERY_TOKEN_PREFIX}${base64UrlEncode(randomBytes)}`;
}

export type RecoveryTokenDigester = (rawToken: string) => Promise<string>;

/**
 * Returns the one-time raw token plus its persistence-safe digest. The digester
 * must be a server-side keyed cryptographic digest (HMAC-SHA-256 or stronger).
 */
export async function mintCheckoutRecoveryToken(
  randomBytes: Uint8Array,
  digest: RecoveryTokenDigester,
): Promise<{ rawToken: string; tokenDigest: string }> {
  const rawToken = encodeCheckoutRecoveryToken(randomBytes);
  const tokenDigest = await digest(rawToken);
  if (!/^[\x21-\x7e]{43,256}$/.test(tokenDigest)) {
    throw new Error('Recovery token digester returned an invalid digest');
  }
  return { rawToken, tokenDigest };
}

function validateBuildReference(build: CheckoutBuildReference): void {
  for (const [field, value] of Object.entries({
    buildId: build.buildId,
    buildVersionId: build.buildVersionId,
    configurationFingerprint: build.configurationFingerprint,
    renderVersionId: build.renderVersionId,
  })) {
    if (!nonEmpty(value)) throw new Error(`Recovery build ${field} is required`);
  }
  if (build.sourceModelVersionId !== undefined && !nonEmpty(build.sourceModelVersionId)) {
    throw new Error('Recovery build sourceModelVersionId must not be empty');
  }
}

/** Creates a server-persisted state without ever accepting/storing the raw token. */
export function createCheckoutRecoveryState(
  input: CreateCheckoutRecoveryInput,
  config: CheckoutRecoveryConfig,
): CheckoutRecoveryState {
  assertValidCheckoutRecoveryConfig(config);
  if (!config.enabled) throw new Error('Checkout recovery is disabled');
  for (const [field, value] of Object.entries({
    checkoutDraftId: input.checkoutDraftId,
    customerCurrency: input.customerCurrency,
    id: input.id,
    locale: input.locale,
    marketCode: input.marketCode,
    tokenDigest: input.tokenDigest,
  })) {
    if (!nonEmpty(value)) throw new Error(`${field} is required`);
  }
  if (!/^[\x21-\x7e]{43,256}$/.test(input.tokenDigest)) {
    throw new Error('tokenDigest must be a persistence-safe cryptographic digest');
  }
  if (!isNonNegativeInteger(input.createdAtEpochMs)) {
    throw new Error('createdAtEpochMs must be a non-negative safe integer');
  }
  if (!isNonNegativeInteger(input.quotedSubtotalEurMinor)) {
    throw new Error('quotedSubtotalEurMinor must be a non-negative safe integer');
  }
  if (input.audience.mode === 'authenticated_customer') {
    if (!nonEmpty(input.audience.customerId)) throw new Error('audience customerId is required');
  } else if (!nonEmpty(input.audience.emailFingerprint)) {
    throw new Error('audience emailFingerprint is required');
  }
  validateBuildReference(input.build);

  return {
    appliedDiscountId: input.appliedDiscountId,
    audience: { ...input.audience },
    build: { ...input.build },
    checkoutDraftId: input.checkoutDraftId,
    createdAtEpochMs: input.createdAtEpochMs,
    customerCurrency: input.customerCurrency,
    expiresAtEpochMs: addSeconds(input.createdAtEpochMs, config.tokenTtlSeconds),
    id: input.id,
    locale: input.locale,
    marketCode: input.marketCode,
    priceLockUntilEpochMs: addSeconds(input.createdAtEpochMs, config.priceLockSeconds),
    quotedSubtotalEurMinor: input.quotedSubtotalEurMinor,
    resumeCount: 0,
    retainUntilEpochMs: addSeconds(input.createdAtEpochMs, config.stateRetentionSeconds),
    status: 'active',
    tokenDigest: input.tokenDigest,
    version: CHECKOUT_RECOVERY_VERSION,
  };
}

function constantTimeTextEqual(first: string, second: string): boolean {
  const length = Math.max(first.length, second.length);
  let difference = first.length ^ second.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export type RecoveryIdentityProof =
  | { mode: 'authenticated_customer'; customerId: string }
  | { mode: 'verified_email'; emailFingerprint: string };

export type RecoveryResumeDenialCode =
  | 'token_mismatch'
  | 'revoked'
  | 'already_converted'
  | 'expired'
  | 'resume_limit_reached'
  | 'build_unavailable'
  | 'build_reference_mismatch'
  | 'identity_mismatch';

export interface RecoveryResumeContext {
  presentedTokenDigest: string;
  nowEpochMs: number;
  identity: RecoveryIdentityProof;
  expectedBuildVersionId?: string;
  buildAvailability: 'available' | 'withdrawn' | 'missing';
}

export type RecoveryResumeDecision =
  | {
      allowed: false;
      code: RecoveryResumeDenialCode;
    }
  | {
      allowed: true;
      checkoutDraftId: string;
      build: CheckoutBuildReference;
      locale: string;
      customerCurrency: string;
      marketCode: string;
      pricingAction: 'locked_snapshot_requires_server_verification' | 'reprice_required';
      quotedSubtotalEurMinor: number;
      appliedDiscountId?: string;
    };

function identityMatches(audience: RecoveryAudience, proof: RecoveryIdentityProof): boolean {
  if (audience.mode !== proof.mode) return false;
  return audience.mode === 'authenticated_customer'
    ? constantTimeTextEqual(audience.customerId, (proof as { customerId: string }).customerId)
    : constantTimeTextEqual(
        audience.emailFingerprint,
        (proof as { emailFingerprint: string }).emailFingerprint,
      );
}

/**
 * Validates a resume request. A positive result restores only immutable IDs;
 * the API must reload the draft/build and either verify or recompute pricing.
 */
export function validateCheckoutRecoveryResume(
  state: CheckoutRecoveryState,
  context: RecoveryResumeContext,
  config: CheckoutRecoveryConfig,
): RecoveryResumeDecision {
  assertValidCheckoutRecoveryConfig(config);
  if (!isNonNegativeInteger(context.nowEpochMs)) throw new Error('nowEpochMs is invalid');
  if (!constantTimeTextEqual(state.tokenDigest, context.presentedTokenDigest)) {
    return { allowed: false, code: 'token_mismatch' };
  }
  if (state.status === 'revoked') return { allowed: false, code: 'revoked' };
  if (state.status === 'converted') return { allowed: false, code: 'already_converted' };
  if (state.status === 'expired' || context.nowEpochMs >= state.expiresAtEpochMs) {
    return { allowed: false, code: 'expired' };
  }
  if (state.resumeCount >= config.maxResumeCount) {
    return { allowed: false, code: 'resume_limit_reached' };
  }
  if (context.buildAvailability !== 'available') {
    return { allowed: false, code: 'build_unavailable' };
  }
  if (
    context.expectedBuildVersionId !== undefined &&
    !constantTimeTextEqual(state.build.buildVersionId, context.expectedBuildVersionId)
  ) {
    return { allowed: false, code: 'build_reference_mismatch' };
  }
  if (!identityMatches(state.audience, context.identity)) {
    return { allowed: false, code: 'identity_mismatch' };
  }
  return {
    allowed: true,
    appliedDiscountId: state.appliedDiscountId,
    build: { ...state.build },
    checkoutDraftId: state.checkoutDraftId,
    customerCurrency: state.customerCurrency,
    locale: state.locale,
    marketCode: state.marketCode,
    pricingAction:
      context.nowEpochMs < state.priceLockUntilEpochMs
        ? 'locked_snapshot_requires_server_verification'
        : 'reprice_required',
    quotedSubtotalEurMinor: state.quotedSubtotalEurMinor,
  };
}

export function markCheckoutRecoveryResumed(
  state: CheckoutRecoveryState,
  nowEpochMs: number,
  config: CheckoutRecoveryConfig,
): CheckoutRecoveryState {
  assertValidCheckoutRecoveryConfig(config);
  if (!isNonNegativeInteger(nowEpochMs)) throw new Error('nowEpochMs is invalid');
  if (state.status !== 'active' && state.status !== 'resumed') {
    throw new Error(`Cannot resume checkout recovery in status ${state.status}`);
  }
  if (nowEpochMs >= state.expiresAtEpochMs) throw new Error('Cannot resume an expired checkout recovery');
  if (state.resumeCount >= config.maxResumeCount) throw new Error('Checkout recovery resume limit reached');
  return {
    ...state,
    lastResumedAtEpochMs: nowEpochMs,
    resumeCount: state.resumeCount + 1,
    status: 'resumed',
  };
}

export function markCheckoutRecoveryConverted(
  state: CheckoutRecoveryState,
  orderId: string,
  nowEpochMs: number,
): CheckoutRecoveryState {
  if (!nonEmpty(orderId)) throw new Error('orderId is required');
  if (!isNonNegativeInteger(nowEpochMs)) throw new Error('nowEpochMs is invalid');
  if (state.status === 'converted') {
    if (state.completedOrderId === orderId) return state;
    throw new Error('Checkout recovery is already linked to another order');
  }
  if (state.status === 'revoked' || state.status === 'expired') {
    throw new Error(`Cannot convert checkout recovery in status ${state.status}`);
  }
  return {
    ...state,
    completedOrderId: orderId,
    convertedAtEpochMs: nowEpochMs,
    status: 'converted',
  };
}

export function revokeCheckoutRecovery(
  state: CheckoutRecoveryState,
  reason: string,
  nowEpochMs: number,
): CheckoutRecoveryState {
  if (!nonEmpty(reason)) throw new Error('revocation reason is required');
  if (!isNonNegativeInteger(nowEpochMs)) throw new Error('nowEpochMs is invalid');
  if (state.status === 'converted') throw new Error('A converted checkout recovery cannot be revoked');
  return {
    ...state,
    revocationReason: reason,
    revokedAtEpochMs: nowEpochMs,
    status: 'revoked',
  };
}

export interface ExitIntentOfferContext {
  sessionId: string;
  nowEpochMs: number;
  sessionStartedAtEpochMs: number;
  exitSignalObserved: boolean;
  hasRecoverableCheckout: boolean;
  checkoutAlreadyConverted: boolean;
  impressionsThisSession: number;
  lastDismissedAtEpochMs?: number;
  marketCode: string;
}

export type ExitIntentOfferDecision =
  | {
      present: false;
      code:
        | 'disabled'
        | 'no_exit_signal'
        | 'no_recoverable_checkout'
        | 'already_converted'
        | 'session_too_new'
        | 'session_limit_reached'
        | 'dismissal_cooldown'
        | 'market_not_eligible';
    }
  | {
      present: true;
      discountId?: string;
      impressionIdempotencyKey: string;
      translationKeys: {
        headline: string;
        body: string;
        cta: string;
        dismiss: string;
      };
    };

/** Evaluates a real exit signal without blocking navigation or repeated nagging. */
export function evaluateExitIntentOffer(
  config: ExitIntentPopupConfig,
  context: ExitIntentOfferContext,
): ExitIntentOfferDecision {
  const issues: string[] = [];
  if (config.enabled) validateExitIntentPopup(config, issues);
  if (issues.length > 0) throw new Error(`Invalid exit popup config: ${issues.join('; ')}`);
  if (
    !isNonNegativeInteger(context.nowEpochMs) ||
    !isNonNegativeInteger(context.sessionStartedAtEpochMs) ||
    !isNonNegativeInteger(context.impressionsThisSession) ||
    (context.lastDismissedAtEpochMs !== undefined &&
      !isNonNegativeInteger(context.lastDismissedAtEpochMs)) ||
    !nonEmpty(context.sessionId)
  ) {
    throw new Error('Invalid exit popup evaluation context');
  }
  if (!config.enabled) return { code: 'disabled', present: false };
  if (!context.exitSignalObserved) return { code: 'no_exit_signal', present: false };
  if (!context.hasRecoverableCheckout) return { code: 'no_recoverable_checkout', present: false };
  if (context.checkoutAlreadyConverted) return { code: 'already_converted', present: false };
  if (
    context.nowEpochMs - context.sessionStartedAtEpochMs <
    config.minimumSessionAgeSeconds * 1_000
  ) {
    return { code: 'session_too_new', present: false };
  }
  if (context.impressionsThisSession >= config.maxImpressionsPerSession) {
    return { code: 'session_limit_reached', present: false };
  }
  if (
    context.lastDismissedAtEpochMs !== undefined &&
    context.nowEpochMs - context.lastDismissedAtEpochMs < config.cooldownSeconds * 1_000
  ) {
    return { code: 'dismissal_cooldown', present: false };
  }
  if (
    config.allowedMarketCodes &&
    !config.allowedMarketCodes.includes(context.marketCode)
  ) {
    return { code: 'market_not_eligible', present: false };
  }
  return {
    discountId: config.discountId,
    impressionIdempotencyKey: `checkout-recovery:${context.sessionId}:exit-intent`,
    present: true,
    translationKeys: {
      body: config.bodyTranslationKey,
      cta: config.ctaTranslationKey,
      dismiss: config.dismissTranslationKey,
      headline: config.headlineTranslationKey,
    },
  };
}

export interface RecoveryEmailDeliveryFact {
  recoveryId: string;
  sequence: number;
  sentAtEpochMs: number;
  providerMessageId: string;
}

export type RecoveryEmailPermission =
  | 'none'
  | 'marketing_opt_in'
  | 'documented_soft_opt_in';

export interface RecoveryEmailDeliveryContext {
  nowEpochMs: number;
  permission: RecoveryEmailPermission;
  deliverability: 'deliverable' | 'suppressed' | 'bounced' | 'complained';
  sent: readonly RecoveryEmailDeliveryFact[];
}

export type RecoveryEmailDecision =
  | {
      send: false;
      code:
        | 'disabled'
        | 'checkout_closed'
        | 'expired'
        | 'consent_required'
        | 'recipient_suppressed'
        | 'not_due'
        | 'schedule_complete';
    }
  | {
      send: true;
      sequence: number;
      dueAtEpochMs: number;
      idempotencyKey: string;
      templateKey: string;
      fromAddress: string;
      replyToAddress?: string;
      discountId?: string;
    };

function permissionAllows(
  required: RecoveryEmailConsentPolicy,
  actual: RecoveryEmailPermission,
): boolean {
  if (required === 'marketing_opt_in') return actual === 'marketing_opt_in';
  return actual === 'marketing_opt_in' || actual === 'documented_soft_opt_in';
}

/** Chooses at most one due email; persist the idempotency key before sending. */
export function evaluateRecoveryEmailDelivery(
  config: CheckoutRecoveryConfig,
  state: CheckoutRecoveryState,
  context: RecoveryEmailDeliveryContext,
): RecoveryEmailDecision {
  assertValidCheckoutRecoveryConfig(config);
  if (!isNonNegativeInteger(context.nowEpochMs)) throw new Error('nowEpochMs is invalid');
  const email = config.channels.email;
  if (!config.enabled || !email.enabled) return { code: 'disabled', send: false };
  if (state.status === 'converted' || state.status === 'revoked') {
    return { code: 'checkout_closed', send: false };
  }
  if (state.status === 'expired' || context.nowEpochMs >= state.expiresAtEpochMs) {
    return { code: 'expired', send: false };
  }
  if (!permissionAllows(email.consentPolicy, context.permission)) {
    return { code: 'consent_required', send: false };
  }
  if (context.deliverability !== 'deliverable') {
    return { code: 'recipient_suppressed', send: false };
  }

  const sentSequences = new Set(
    context.sent
      .filter((delivery) => delivery.recoveryId === state.id)
      .map((delivery) => delivery.sequence),
  );
  const nextIndex = email.sendAfterSeconds.findIndex((_, index) => !sentSequences.has(index + 1));
  if (nextIndex < 0) return { code: 'schedule_complete', send: false };
  const delay = email.sendAfterSeconds[nextIndex];
  if (delay === undefined) return { code: 'schedule_complete', send: false };
  const dueAtEpochMs = addSeconds(state.createdAtEpochMs, delay);
  if (context.nowEpochMs < dueAtEpochMs) return { code: 'not_due', send: false };

  const templateKey =
    email.templateKeyByLocale[state.locale] ?? email.templateKeyByLocale[email.defaultLocale];
  if (!templateKey) throw new Error('No recovery email template is configured for the locale fallback');
  const sequence = nextIndex + 1;
  return {
    discountId: email.discountId,
    dueAtEpochMs,
    fromAddress: email.fromAddress,
    idempotencyKey: `checkout-recovery:${state.id}:email:${sequence}`,
    replyToAddress: email.replyToAddress,
    send: true,
    sequence,
    templateKey,
  };
}
