import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { routing } from "@/i18n/routing";

function isSupportedLocale(value: string): value is (typeof routing.locales)[number] {
  return (routing.locales as readonly string[]).includes(value);
}

export default getRequestConfig(async ({ locale }) => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const headerLocale = headerStore.get("accept-language")?.split(",")[0]?.toLowerCase();
  const resolvedLocale =
    (cookieLocale && isSupportedLocale(cookieLocale) ? cookieLocale : undefined) ??
    (locale && isSupportedLocale(locale) ? locale : undefined) ??
    (headerLocale && isSupportedLocale(headerLocale) ? headerLocale : undefined) ??
    routing.defaultLocale;
  return {
    locale: resolvedLocale,
    messages: (await import(`@/messages/${resolvedLocale}.json`)).default,
  };
});
