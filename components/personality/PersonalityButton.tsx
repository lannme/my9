"use client";

import { useState, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { PersonalityDialog } from "@/components/personality/PersonalityDialog";
import type { ShareGame } from "@/lib/share/types";
import type { SubjectKind } from "@/lib/subject-kind";

interface PersonalityButtonProps {
  shareId: string | null;
  kind: SubjectKind;
  games: Array<ShareGame | null>;
  creatorName: string;
}

export function PersonalityButton({
  shareId,
  kind,
  games,
  creatorName,
}: PersonalityButtonProps) {
  const [open, setOpen] = useState(false);

  const filledCount = games.filter((g) => g !== null).length;
  const disabled = !shareId || filledCount < 3;

  const handleClick = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-base font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/60"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        分析桌游人格
      </button>
      {open && shareId && (
        <PersonalityDialog
          open={open}
          onOpenChange={setOpen}
          shareId={shareId}
          kind={kind}
          creatorName={creatorName}
        />
      )}
    </>
  );
}
