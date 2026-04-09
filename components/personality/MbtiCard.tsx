"use client";

import { cn } from "@/lib/utils";
import { BipolarBar } from "@/components/personality/DimensionBar";
import type { PersonalityMbti } from "@/lib/personality/types";

interface MbtiCardProps {
  mbti: PersonalityMbti;
  className?: string;
}

const MBTI_COLORS: Record<string, string> = {
  INTJ: "from-purple-500 to-indigo-600",
  INTP: "from-violet-500 to-purple-600",
  ENTJ: "from-blue-600 to-indigo-700",
  ENTP: "from-cyan-500 to-blue-600",
  INFJ: "from-emerald-500 to-teal-600",
  INFP: "from-pink-400 to-rose-500",
  ENFJ: "from-amber-400 to-orange-500",
  ENFP: "from-yellow-400 to-amber-500",
  ISTJ: "from-slate-500 to-gray-600",
  ISFJ: "from-green-400 to-emerald-500",
  ESTJ: "from-blue-500 to-sky-600",
  ESFJ: "from-rose-400 to-pink-500",
  ISTP: "from-zinc-500 to-slate-600",
  ISFP: "from-lime-400 to-green-500",
  ESTP: "from-orange-500 to-red-600",
  ESFP: "from-fuchsia-400 to-pink-500",
};

export function MbtiCard({ mbti, className }: MbtiCardProps) {
  const gradient = MBTI_COLORS[mbti.type] || "from-sky-500 to-violet-600";

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <div className={cn("bg-gradient-to-br px-4 py-5 text-center text-white", gradient)}>
        <p className="text-4xl font-black tracking-wider">{mbti.type}</p>
        <p className="mt-1 text-sm font-semibold opacity-90">{mbti.label}</p>
      </div>
      <div className="space-y-3 p-4">
        <BipolarBar
          label="E/I"
          value={mbti.dimensions.ei}
          leftLabel="内向 (I)"
          rightLabel="外向 (E)"
        />
        <BipolarBar
          label="S/N"
          value={mbti.dimensions.sn}
          leftLabel="感觉 (S)"
          rightLabel="直觉 (N)"
        />
        <BipolarBar
          label="T/F"
          value={mbti.dimensions.tf}
          leftLabel="思考 (T)"
          rightLabel="情感 (F)"
        />
        <BipolarBar
          label="J/P"
          value={mbti.dimensions.jp}
          leftLabel="判断 (J)"
          rightLabel="感知 (P)"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">{mbti.reasoning}</p>
      </div>
    </div>
  );
}
