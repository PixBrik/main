import { ClerkProvider } from "@clerk/nextjs";

import { assertSafeAuthEnvironment, authMode } from "@/lib/env";

type AuthProviderProps = Readonly<{
  children: React.ReactNode;
}>;

/**
 * Clerk is mounted only for the dedicated staff-auth mode. Keeping the
 * provider conditional lets disabled/development builds run without Clerk
 * keys, while AUTH_MODE=clerk still fails closed when either key is missing.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  assertSafeAuthEnvironment();

  if (authMode() !== "clerk") return <>{children}</>;

  return (
    <ClerkProvider dynamic signInUrl="/sign-in">
      {children}
    </ClerkProvider>
  );
}
