import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SharePlatformActions } from "@/components/share/SharePlatformActions";
import { ReadonlyNineGridBoard } from "@/app/components/v3/ReadonlyNineGridBoard";
import { ReadonlySelectedGamesList } from "@/app/components/v3/ReadonlySelectedGamesList";
import { SubjectKind, getSubjectKindMetaByLocale, getSubjectKindShareTitleByLocale } from "@/lib/subject-kind";
import { ShareGame } from "@/lib/share/types";
import { Link } from "@/i18n/navigation";

export type InitialReadonlyShareData = {
  shareId: string;
  kind: SubjectKind;
  creatorName: string | null;
  games: Array<ShareGame | null>;
};

interface My9ReadonlyPageProps {
  kind: SubjectKind;
  shareId: string;
  initialShareData: InitialReadonlyShareData;
}

export default async function My9ReadonlyPage({ kind, shareId, initialShareData }: My9ReadonlyPageProps) {
  const t = await getTranslations("readonly");
  const locale = await getLocale();
  const appLocale = locale === "en" ? "en" : "zh";
  const kindMeta = getSubjectKindMetaByLocale(kind, appLocale);
  const shareTitle = getSubjectKindShareTitleByLocale(kind, appLocale);
  const games = initialShareData.games;
  const creatorName = initialShareData.creatorName || "";
  const finalShareId = initialShareData.shareId || shareId;

  return (
    <main className="px-4 py-16 min-h-screen bg-background text-foreground">
      <div className="flex flex-col gap-4 items-center mx-auto w-full max-w-2xl">
        <header className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight leading-tight whitespace-nowrap text-foreground sm:text-4xl">
            {shareTitle}
          </h1>
          <p className="text-sm text-muted-foreground">{kindMeta.subtitle}</p>
          <Link
            href={`/trends?kind=${kind}`}
            className="inline-flex items-center justify-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-base font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-900/60"
          >
            {t("viewTrends")}
            <ChevronRight className="w-4 h-4 text-sky-500 dark:text-sky-300" aria-hidden="true" />
          </Link>
        </header>

        <div className="flex flex-col gap-2 items-center">
          <p className="rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
            {t("readonlyBadge")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("creatorLabel")} {creatorName.trim() || t("anonymous")}
          </p>
          <Link
            href={`/${kind}`}
            className="inline-flex gap-2 justify-center items-center px-5 py-2 text-sm font-bold rounded-full border transition-colors border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {t("goToEditor")}
          </Link>
        </div>

        <div className="p-1 mx-auto w-full rounded-xl border-4 ring-1 shadow-2xl border-background bg-card ring-border/70 sm:p-4">
          <ReadonlyNineGridBoard games={games} subjectLabel={kindMeta.label} kind={kind} />
        </div>

        <div className="flex flex-col gap-3 items-center w-full">
          <SharePlatformActions
            kind={kind}
            shareId={finalShareId}
            games={games}
            creatorName={creatorName}
          />
        </div>

        <ReadonlySelectedGamesList
          games={games}
          subjectLabel={kindMeta.label}
          bangumiSearchCat={kindMeta.search.bangumiSearchCat}
          kind={kind}
        />

        <SiteFooter className="w-full" kind={kind} />
      </div>
    </main>
  );
}
