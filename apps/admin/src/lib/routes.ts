/**
 * Route-local paths are for Next.js Link and server redirect APIs, which apply
 * basePath automatically. Public paths are for third-party SDKs such as Clerk,
 * which need the deployment prefix explicitly.
 */
export const ADMIN_BASE_PATH = "/backoffice" as const;

export const APP_ROUTES = {
  home: "/",
  dashboard: "/",
  forbidden: "/forbidden",
  portal: "/portal",
  signIn: "/sign-in",
  clerkProxy: "/__clerk"
} as const;

export function withAdminBasePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`Admin route must start with "/": ${path}`);
  }
  return path === "/" ? ADMIN_BASE_PATH : `${ADMIN_BASE_PATH}${path}`;
}

export const PUBLIC_ROUTES = {
  home: withAdminBasePath(APP_ROUTES.home),
  dashboard: withAdminBasePath(APP_ROUTES.dashboard),
  forbidden: withAdminBasePath(APP_ROUTES.forbidden),
  portal: withAdminBasePath(APP_ROUTES.portal),
  signIn: withAdminBasePath(APP_ROUTES.signIn),
  clerkProxy: withAdminBasePath(APP_ROUTES.clerkProxy)
} as const;

export function adminSectionRoute(section: string): string {
  return `/${encodeURIComponent(section)}`;
}
