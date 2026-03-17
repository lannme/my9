"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <button
      type="button"
      className="p-0 bg-transparent transition-colors text-muted-foreground hover:text-foreground hover:underline"
      onClick={() => {
        const query = typeof window === "undefined" ? "" : window.location.search;
        document.cookie = `NEXT_LOCALE=${nextLocale}; Path=/; SameSite=Lax`;
        window.location.assign(`${pathname}${query}`);
      }}
    >
      {nextLocale === "en" ? t("switchToEnglish") : t("switchToChinese")}
    </button>
  );
}
