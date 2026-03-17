"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SharePlatformActions } from "@/components/share/SharePlatformActions";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { InlineToast, ToastKind } from "@/app/components/v3/InlineToast";
import { NineGridBoard } from "@/app/components/v3/NineGridBoard";
import { SelectedGamesList } from "@/app/components/v3/SelectedGamesList";
import {
  SubjectKind,
  getSubjectKindMetaByLocale,
  getSubjectKindShareTitleByLocale,
  parseSubjectKind,
} from "@/lib/subject-kind";
import { ShareGame } from "@/lib/share/types";

type ToastState = {
  kind: ToastKind;
  message: string;
} | null;

export type InitialReadonlyShareData = {
  shareId: string;
  kind: SubjectKind;
  creatorName: string | null;
  games: Array<ShareGame | null>;
};

function createEmptyGames() {
  return Array.from({ length: 9 }, () => null as ShareGame | null);
}

function cloneGames(games: Array<ShareGame | null>) {
  return games.map((item) => (item ? { ...item } : null));
}

function normalizeGamesForState(games?: Array<ShareGame | null>) {
  if (!Array.isArray(games) || games.length !== 9) {
    return createEmptyGames();
  }
  return cloneGames(games);
}

interface My9ReadonlyAppProps {
  kind: SubjectKind;
  initialShareId: string;
  initialShareData?: InitialReadonlyShareData | null;
}

export default function My9ReadonlyApp({
  kind,
  initialShareId,
  initialShareData = null,
}: My9ReadonlyAppProps) {
  const t = useTranslations("readonly");
  const router = useRouter();
  const locale = useLocale();
  const appLocale = locale === "en" ? "en" : "zh";
  const kindMeta = useMemo(() => getSubjectKindMetaByLocale(kind, appLocale), [appLocale, kind]);
  const shareTitle = useMemo(
    () => getSubjectKindShareTitleByLocale(kind, appLocale),
    [appLocale, kind]
  );
  const [games, setGames] = useState<Array<ShareGame | null>>(() =>
    normalizeGamesForState(initialShareData?.games)
  );
  const [creatorName, setCreatorName] = useState(initialShareData?.creatorName || "");
  const [shareId, setShareId] = useState<string | null>(initialShareData?.shareId || initialShareId);
  const [loadingShare, setLoadingShare] = useState(Boolean(initialShareId) && !initialShareData);
  const [toast, setToast] = useState<ToastState>(null);
  const [spoilerExpandedSet, setSpoilerExpandedSet] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!initialShareData) return;
    if (initialShareData.kind !== kind) return;

    setGames(normalizeGamesForState(initialShareData.games));
    setCreatorName(initialShareData.creatorName || "");
    setShareId(initialShareData.shareId);
    setLoadingShare(false);
  }, [initialShareData, kind]);

  useEffect(() => {
    if (!initialShareId) return;
    if (initialShareData) return;

    const currentShareId = initialShareId;
    let active = true;

    async function loadShared() {
      setLoadingShare(true);

      try {
        const response = await fetch(`/api/share?id=${encodeURIComponent(currentShareId)}`);
        const json = await response.json();
        if (!active) return;

        if (!response.ok || !json?.ok) {
          setToast({ kind: "error", message: json?.error || t("loadFailed") });
          setLoadingShare(false);
          return;
        }

        const responseKind = parseSubjectKind(json.kind) ?? "game";
        if (responseKind !== kind) {
          setToast({ kind: "error", message: t("kindMismatch") });
          setLoadingShare(false);
          router.replace(`/${responseKind}/s/${json.shareId || currentShareId}`);
          return;
        }

        const payloadGames = Array.isArray(json.games) ? json.games : createEmptyGames();
        setGames(normalizeGamesForState(payloadGames));
        setCreatorName(typeof json.creatorName === "string" ? json.creatorName : "");
        setShareId(json.shareId || currentShareId);
      } catch {
        if (!active) return;
        setToast({ kind: "error", message: t("loadFailed") });
      } finally {
        if (active) {
          setLoadingShare(false);
        }
      }
    }

    loadShared();
    return () => {
      active = false;
    };
  }, [initialShareData, initialShareId, kind, router]);

  function handleNotice(kindValue: ToastKind, message: string) {
    setToast({ kind: kindValue, message });
  }

  function handleToggleSpoiler(index: number) {
    const game = games[index];
    if (!game || !game.spoiler) return;

    if (!spoilerExpandedSet.has(index)) {
      const confirmed = window.confirm(t("spoilerConfirm"));
      if (!confirmed) return;
    }

    setSpoilerExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <main className="px-4 py-16 min-h-screen bg-background text-foreground">
      <div className="flex flex-col gap-4 items-center mx-auto w-full max-w-2xl">
        <header className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight leading-tight whitespace-nowrap text-foreground sm:text-4xl">
            {shareTitle}
          </h1>
          <p className="text-sm text-muted-foreground">{kindMeta.subtitle}</p>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-base font-semibold text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-900/60"
            onClick={() => router.push(`/trends?kind=${kind}`)}
          >
            {t("viewTrends")}
            <ChevronRight className="w-4 h-4 text-sky-500 dark:text-sky-300" aria-hidden="true" />
          </button>
        </header>

        {toast ? (
          <div className="pointer-events-none fixed -left-[200vw] top-0 opacity-0" aria-live="polite">
            <InlineToast kind={toast.kind} message={toast.message} />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 items-center">
          <p className="rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
            {t("readonlyBadge")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("creatorLabel")} {creatorName.trim() || t("anonymous")}
          </p>
          <button
            type="button"
            className="inline-flex gap-2 justify-center items-center px-5 py-2 text-sm font-bold rounded-full border transition-colors border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => router.push(`/${kind}`)}
          >
            {t("goToEditor")}
          </button>
        </div>

        {loadingShare ? (
          <p className="text-sm text-muted-foreground">{t("loadingShare")}</p>
        ) : (
          <div className="p-1 mx-auto w-full rounded-xl border-4 ring-1 shadow-2xl border-background bg-card ring-border/70 sm:p-4">
            <NineGridBoard
              games={games}
              subjectLabel={kindMeta.label}
              kind={kind}
              readOnly
            />
          </div>
        )}

        <div className="flex flex-col gap-3 items-center w-full">
          <SharePlatformActions
            kind={kind}
            shareId={shareId}
            games={games}
            creatorName={creatorName}
            onNotice={handleNotice}
          />
        </div>

        <SelectedGamesList
          games={games}
          subjectLabel={kindMeta.label}
          bangumiSearchCat={kindMeta.search.bangumiSearchCat}
          kind={kind}
          readOnly
          spoilerExpandedSet={spoilerExpandedSet}
          onToggleSpoiler={handleToggleSpoiler}
          onOpenComment={() => undefined}
        />

        <SiteFooter className="w-full" kind={kind} />
      </div>
    </main>
  );
}
