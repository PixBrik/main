import type { Permission } from "@/lib/permissions";

export type IdentityProvider = "clerk" | "development" | "trusted-gateway";

export type VerifiedIdentity = {
  subject: string;
  email: string;
  displayName?: string;
  provider: IdentityProvider;
  providerEmailId?: string;
};

export type Principal = VerifiedIdentity & {
  userId: string;
  status: "active";
  roles: string[];
  permissions: Array<Permission | "*">;
};
