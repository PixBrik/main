import { LAUNCH_CONFIG, type LocaleCode } from "@/lib/launch-config";

const localeCodes = new Set<string>(LAUNCH_CONFIG.locales.map((locale) => locale.code));

export function normalizeLocale(value: string | undefined | null): LocaleCode {
  const candidate = value?.toLowerCase().split("-")[0];
  return candidate && localeCodes.has(candidate) ? (candidate as LocaleCode) : "en";
}

export function localeDirection(locale: LocaleCode): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export const sharedMessages = {
  en: { portal: "My PixBrik", orders: "Orders", signOut: "Sign out" },
  fr: { portal: "Mon PixBrik", orders: "Commandes", signOut: "Se déconnecter" },
  es: { portal: "Mi PixBrik", orders: "Pedidos", signOut: "Cerrar sesión" },
  it: { portal: "Il mio PixBrik", orders: "Ordini", signOut: "Esci" },
  ar: { portal: "PixBrik الخاص بي", orders: "الطلبات", signOut: "تسجيل الخروج" }
} satisfies Record<LocaleCode, { portal: string; orders: string; signOut: string }>;
