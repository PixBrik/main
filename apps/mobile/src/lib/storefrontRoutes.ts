import type { DemoScreen } from '../types/navigation';

export type StorefrontDeepLinkScreen = Extract<DemoScreen, 'contact' | 'mode'>;

const STOREFRONT_DEEP_LINKS = [
  { path: '/create', screen: 'mode' },
  { path: '/contact', screen: 'contact' },
] as const satisfies ReadonlyArray<{
  path: `/${string}`;
  screen: StorefrontDeepLinkScreen;
}>;

export const STOREFRONT_DEEP_LINK_SCREENS: readonly StorefrontDeepLinkScreen[] =
  STOREFRONT_DEEP_LINKS.map(({ screen }) => screen);

function normalizedPathname(pathname: string): string {
  const withoutTrailingSlashes = pathname.replace(/\/+$/g, '');
  return withoutTrailingSlashes || '/';
}

/** Resolve only deliberate, public lifecycle-email destinations. */
export function storefrontScreenFromPathname(
  pathname: string,
): StorefrontDeepLinkScreen | null {
  const normalized = normalizedPathname(pathname);
  return STOREFRONT_DEEP_LINKS.find(({ path }) => path === normalized)?.screen ?? null;
}

/** Return the canonical public path for an addressable storefront screen. */
export function storefrontPathForScreen(screen: DemoScreen): string | null {
  return STOREFRONT_DEEP_LINKS.find((entry) => entry.screen === screen)?.path ?? null;
}

export function storefrontPathMatchesScreen(
  screen: DemoScreen,
  pathname: string,
): boolean {
  const canonicalPath = storefrontPathForScreen(screen);
  return canonicalPath !== null && canonicalPath === normalizedPathname(pathname);
}
