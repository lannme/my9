"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DimensionBar } from "@/components/personality/DimensionBar";
import { MbtiCard } from "@/components/personality/MbtiCard";
import type { PersonalityResult } from "@/lib/personality/types";
import type { SubjectKind } from "@/lib/subject-kind";

interface PersonalityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareId: string;
  kind: SubjectKind;
  creatorName: string;
}

const LOADING_TIPS = [
  "正在解读你的桌游品味...",
  "分析九宫格中的游戏基因...",
  "寻找你的桌游人格密码...",
  "穿越机制与主题的迷宫...",
];

export function PersonalityDialog({
  open,
  onOpenChange,
  shareId,
  kind,
  creatorName,
}: PersonalityDialogProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalityResult | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % LOADING_TIPS.length);
    }, 2500);
    return () => clearInterval(timer);
  }, [loading]);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/personality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, kind }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error || "分析失败，请稍后重试");
        return;
      }
      setResult(json.personality as PersonalityResult);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [shareId, kind]);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    doFetch();
  }, [open, doFetch]);

  function handleRetry() {
    fetchedRef.current = false;
    doFetch();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">
            {creatorName ? `${creatorName} 的桌游人格` : "桌游人格分析"}
          </DialogTitle>
          <DialogDescription className="text-center">
            基于九宫格选择的 AI 人格解读
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
            <p className="text-sm text-muted-foreground transition-opacity duration-300">
              {LOADING_TIPS[tipIndex]}
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-accent"
            >
              重试
            </button>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-center gap-2">
              {result.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gradient-to-r from-violet-100 to-sky-100 px-3 py-1 text-sm font-semibold text-violet-700 dark:from-violet-900/40 dark:to-sky-900/40 dark:text-violet-200"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="text-sm leading-relaxed text-foreground">{result.summary}</p>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">维度分析</h3>
              <DimensionBar
                label="策略深度"
                value={result.dimensions.strategicDepth}
                leftLabel="轻策"
                rightLabel="重策"
              />
              <DimensionBar
                label="社交互动"
                value={result.dimensions.socialOrientation}
                leftLabel="独立"
                rightLabel="互动"
              />
              <DimensionBar
                label="经典 vs 现代"
                value={result.dimensions.classicVsModern}
                leftLabel="经典"
                rightLabel="现代"
              />
              <DimensionBar
                label="大众 vs 小众"
                value={result.dimensions.mainstreamVsNiche}
                leftLabel="大众"
                rightLabel="小众"
              />
              <DimensionBar
                label="德式 vs 美式"
                value={result.dimensions.euroVsAmeritrash}
                leftLabel="德式"
                rightLabel="美式"
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">审美偏好</h3>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p><span className="font-medium text-foreground">主题风格:</span> {result.aesthetics.themeStyle}</p>
                <p className="mt-1"><span className="font-medium text-foreground">美术风格:</span> {result.aesthetics.artStyle}</p>
                <DimensionBar
                  className="mt-2"
                  label="叙事 vs 抽象"
                  value={result.aesthetics.narrativeVsAbstract}
                  leftLabel="抽象"
                  rightLabel="叙事"
                />
                {result.aesthetics.topThemes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.aesthetics.topThemes.map((theme) => (
                      <span
                        key={theme}
                        className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">桌游 MBTI</h3>
              <MbtiCard mbti={result.mbti} />
            </div>

            {result.topMechanics.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">偏爱机制</h3>
                <div className="flex flex-wrap gap-1.5">
                  {result.topMechanics.map((m) => (
                    <span
                      key={m}
                      className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-200"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.recommendation && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">你可能还会喜欢</h3>
                <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">{result.recommendation}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
