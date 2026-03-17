"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ActionClusterProps {
  filledCount: number;
  remainingUnit?: string;
  readOnly: boolean;
  saving: boolean;
  canUndo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onClear: () => void;
  onSave: () => void;
}

function saveButtonLabel(params: {
  t: ReturnType<typeof useTranslations>;
  saving: boolean;
  filledCount: number;
  remainingUnit: string;
}) {
  const { t, saving, filledCount, remainingUnit } = params;
  if (saving) return t("saveSaving");
  if (filledCount < 9) {
    return t("saveRemaining", { remaining: 9 - filledCount, unit: remainingUnit });
  }
  return t("saveReady");
}

export function ActionCluster({
  filledCount,
  remainingUnit,
  readOnly,
  saving,
  canUndo,
  canClear,
  onUndo,
  onClear,
  onSave,
}: ActionClusterProps) {
  const t = useTranslations("actions");
  const unit = remainingUnit ?? t("defaultUnit");
  const showEditActions = !readOnly;
  const saveDisabled = saving;

  return (
    <section className="flex w-full flex-col items-center gap-3">
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm font-semibold text-card-foreground">
        <span>{t("selectedCount", { count: filledCount })}</span>
        {!readOnly && filledCount < 9 ? (
          <span className="text-xs font-bold text-orange-500">
            {t("remainingShort", { remaining: 9 - filledCount, unit })}
          </span>
        ) : null}
      </div>

      {showEditActions ? (
        <div className="w-full max-w-[42rem] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-4 py-3 text-sm font-bold text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canUndo}
              onClick={onUndo}
            >
              {t("undo")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-4 py-3 text-sm font-bold text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canClear}
              onClick={onClear}
            >
              {t("clear")}
            </Button>
          </div>
          <Button
            type="button"
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm shadow-sky-200 transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-45",
              !saveDisabled &&
                filledCount < 9 &&
                "cursor-not-allowed opacity-45 hover:bg-sky-600"
            )}
            disabled={saveDisabled}
            onClick={onSave}
          >
            {saveButtonLabel({ t, saving, filledCount, remainingUnit: unit })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
