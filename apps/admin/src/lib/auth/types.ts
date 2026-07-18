import type { Permission } from "@/lib/permissions";

export type VerifiedIdentity = {
  subject: string;
  email: string;
  displayName?: string;
};

export type Principal = VerifiedIdentity & {
  userId: string;
  status: "active";
  roles: string[];
  permissions: Array<Permission | "*">;
};
