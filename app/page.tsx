import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import HomeKindEntry from "@/app/components/HomeKindEntry";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "home" });
  return {
    title: t("pageTitle"),
  };
}

export default function HomePage() {
  return <HomeKindEntry />;
}
