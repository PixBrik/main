import type { Metadata } from "next";
import { cookies } from "next/headers";

import "./globals.css";

import { AuthProvider } from "@/components/auth-provider";
import { localeDirection, normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: {
    default: "PixBrik Operations",
    template: "%s · PixBrik"
  },
  description: "Secure commerce, build production and fulfilment operations for PixBrik.",
  robots: { index: false, follow: false }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get("pixbrik_locale")?.value);

  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
