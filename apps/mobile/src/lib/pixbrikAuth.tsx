import { ClerkProvider, useClerk, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react';

export interface PixBrikAuthUser {
  displayName: string;
  email: string | null;
  id: string;
}

export interface PixBrikAuthValue {
  configured: boolean;
  isSignedIn: boolean;
  loaded: boolean;
  signOut: () => Promise<void>;
  user: PixBrikAuthUser | null;
}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? '';

const unavailableAuth: PixBrikAuthValue = {
  configured: false,
  isSignedIn: false,
  loaded: true,
  signOut: async () => undefined,
  user: null,
};

const PixBrikAuthContext = createContext<PixBrikAuthValue>(unavailableAuth);

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const signOut = useCallback(async () => {
    await clerk.signOut();
  }, [clerk]);
  const authUser = useMemo<PixBrikAuthUser | null>(() => {
    if (!isLoaded || !isSignedIn || !user) return null;
    const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
    const displayName =
      user.fullName?.trim() ||
      user.firstName?.trim() ||
      user.username?.trim() ||
      email?.split('@')[0] ||
      'PixBrik builder';
    return { displayName, email, id: user.id };
  }, [isLoaded, isSignedIn, user]);
  const value = useMemo<PixBrikAuthValue>(
    () => ({
      configured: true,
      isSignedIn: !!authUser,
      loaded: isLoaded,
      signOut,
      user: authUser,
    }),
    [authUser, isLoaded, signOut],
  );

  return <PixBrikAuthContext.Provider value={value}>{children}</PixBrikAuthContext.Provider>;
}

/**
 * Clerk is optional until production keys are provisioned. Without a key the
 * app remains usable and exposes an explicit device-only, signed-out state.
 */
export function PixBrikAuthProvider({ children }: { children: ReactNode }) {
  if (!publishableKey) {
    return <PixBrikAuthContext.Provider value={unavailableAuth}>{children}</PixBrikAuthContext.Provider>;
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

/** Stable app boundary: buyer screens never import Clerk directly. */
export function usePixBrikAuth(): PixBrikAuthValue {
  return useContext(PixBrikAuthContext);
}
