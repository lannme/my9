"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <button
      type="button"
      className="bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground hover:underline"
      onClick={() => {
        const query = typeof window === "undefined" ? "" : window.location.search;
        router.replace(`${pathname}${query}`, { locale: nextLocale });
      }}
    >
      {nextLocale === "en" ? t("switchToEnglish") : t("switchToChinese")}
    </button>
  );
}
