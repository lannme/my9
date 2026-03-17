import { getRequestConfig } from "next-intl/server";
import { routing } from "@/i18n/routing";

function isSupportedLocale(value: string): value is (typeof routing.locales)[number] {
  return (routing.locales as readonly string[]).includes(value);
}

export default getRequestConfig(async ({ locale }) => {
  const resolvedLocale = locale && isSupportedLocale(locale) ? locale : routing.defaultLocale;
  return {
    locale: resolvedLocale,
    messages: (await import(`@/messages/${resolvedLocale}.json`)).default,
  };
});
