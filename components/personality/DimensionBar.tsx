"use client";

import { cn } from "@/lib/utils";

interface DimensionBarProps {
  label: string;
  value: number;
  leftLabel?: string;
  rightLabel?: string;
  className?: string;
}

export function DimensionBar({
  label,
  value,
  leftLabel,
  rightLabel,
  className,
}: DimensionBarProps) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{clampedValue}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 transition-all duration-500"
          style={{ width: `${clampedValue}%` }}
        />
      </div>
      {(leftLabel || rightLabel) && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
}

interface BipolarBarProps {
  label: string;
  value: number;
  leftLabel: string;
  rightLabel: string;
  className?: string;
}

export function BipolarBar({
  label,
  value,
  leftLabel,
  rightLabel,
  className,
}: BipolarBarProps) {
  const clamped = Math.max(-100, Math.min(100, value));
  const percent = ((clamped + 100) / 200) * 100;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {clamped < 0 ? (
          <div
            className="absolute inset-y-0 rounded-full bg-gradient-to-l from-amber-400 to-orange-500 transition-all duration-500"
            style={{ right: "50%", width: `${50 - percent}%` }}
          />
        ) : (
          <div
            className="absolute inset-y-0 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 transition-all duration-500"
            style={{ left: "50%", width: `${percent - 50}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
