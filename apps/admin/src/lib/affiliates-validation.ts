export class AffiliateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AffiliateInputError";
  }
}

export type NewAffiliatePartnerInput = Readonly<{
  publicName: string;
  contactEmail: string;
  commissionPercent: string;
  payoutCurrency: string;
  termsVersion: string;
}>;

export type NormalizedAffiliatePartnerInput = Readonly<{
  publicName: string;
  contactEmail: string;
  commissionBasisPoints: number;
  payoutCurrency: string;
  termsVersion: string;
}>;

export type NewAffiliateCodeInput = Readonly<{
  partnerId: string;
  code: string;
  destinationPath: string;
  commissionPercent?: string;
}>;

export type NormalizedAffiliateCodeInput = Readonly<{
  partnerId: string;
  code: string;
  destinationPath: string;
  commissionBasisPoints: number | null;
}>;

function requiredText(value: string, label: string, maximumLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new AffiliateInputError(`${label} is required.`);
  if (normalized.length > maximumLength) {
    throw new AffiliateInputError(`${label} must be ${maximumLength} characters or fewer.`);
  }
  return normalized;
}

export function normalizeAffiliateUuid(value: string, label = "Record"): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new AffiliateInputError(`${label} is invalid. Refresh the page and try again.`);
  }
  return normalized;
}

export function normalizeAffiliateVersionToken(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || !Number.isFinite(Date.parse(normalized))) {
    throw new AffiliateInputError("This record is out of date. Refresh the page and try again.");
  }
  return normalized;
}

export function parseCommissionPercent(value: string, optional = false): number | null {
  const normalized = value.trim();
  if (!normalized && optional) return null;

  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new AffiliateInputError("Commission must be a percentage from 0 to 100 with at most two decimals.");
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100 + fraction;
  if (basisPoints > 10_000) {
    throw new AffiliateInputError("Commission cannot exceed 100%.");
  }
  return basisPoints;
}

export function normalizeNewAffiliatePartner(
  input: NewAffiliatePartnerInput
): NormalizedAffiliatePartnerInput {
  const publicName = requiredText(input.publicName, "Partner name", 120);
  const contactEmail = input.contactEmail.trim().toLowerCase();
  if (
    !contactEmail
    || contactEmail.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
  ) {
    throw new AffiliateInputError("Enter a valid partner contact email.");
  }

  const payoutCurrency = input.payoutCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(payoutCurrency)) {
    throw new AffiliateInputError("Choose a valid payout currency.");
  }

  const termsVersion = requiredText(input.termsVersion, "Terms version", 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(termsVersion)) {
    throw new AffiliateInputError("Terms version may contain letters, numbers, dots, underscores and dashes.");
  }

  return {
    publicName,
    contactEmail,
    commissionBasisPoints: parseCommissionPercent(input.commissionPercent) ?? 0,
    payoutCurrency,
    termsVersion
  };
}

export function normalizeNewAffiliateCode(
  input: NewAffiliateCodeInput
): NormalizedAffiliateCodeInput {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw new AffiliateInputError("Code must be 3–40 letters, numbers, underscores or dashes.");
  }

  const destinationPath = input.destinationPath.trim();
  if (
    !destinationPath
    || destinationPath.length > 500
    || !destinationPath.startsWith("/")
    || destinationPath.startsWith("//")
    || destinationPath.includes("\\")
    || /[\s?#\u0000-\u001f]/.test(destinationPath)
  ) {
    throw new AffiliateInputError("Destination must be a local path such as /shop without a query or fragment.");
  }

  return {
    partnerId: normalizeAffiliateUuid(input.partnerId, "Partner"),
    code,
    destinationPath,
    commissionBasisPoints: parseCommissionPercent(input.commissionPercent ?? "", true)
  };
}
