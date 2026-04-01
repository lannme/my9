import type { SubjectKind } from "@/lib/subject-kind";

type SubjectLike = {
  id?: string | number | null;
  name?: string | null;
  localizedName?: string | null;
  storeUrls?: Record<string, string> | null;
};

export type SubjectSource = "bgg";

export type SubjectLinkResolution = {
  source: SubjectSource;
  sourceLabel: string;
  url: string;
};

function normalizeSubjectId(value: string | number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function sanitizeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveSubjectLink(params: {
  kind?: SubjectKind;
  subject: SubjectLike;
  bangumiSearchCat?: number;
}): SubjectLinkResolution {
  const { subject } = params;
  const bggUrl = sanitizeHttpUrl(subject.storeUrls?.bgg);
  return {
    source: "bgg",
    sourceLabel: "BoardGameGeek",
    url: bggUrl ?? `https://boardgamegeek.com/boardgame/${normalizeSubjectId(subject.id)}`,
  };
}
