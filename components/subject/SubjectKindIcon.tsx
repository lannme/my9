"use client";

import { Dice5 } from "lucide-react";
import { SubjectKind } from "@/lib/subject-kind";

export function SubjectKindIcon({
  className,
}: {
  kind?: SubjectKind | null;
  className?: string;
}) {
  return <Dice5 className={className} />;
}
