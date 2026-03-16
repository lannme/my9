import createClient from "bgg";
import { SubjectKind } from "@/lib/subject-kind";
import { ShareSubject, SubjectSearchResponse } from "@/lib/share/types";

const BGG_CLIENT = createClient({
  timeout: 10000,
  retries: 2,
});

type BggNameNode = {
  value?: string;
  type?: string;
  ["@_value"]?: string;
  ["@_type"]?: string;
};

type BggSearchItem = {
  id?: string | number;
  name?: BggNameNode | BggNameNode[] | string;
  yearpublished?: { value?: string | number; ["@_value"]?: string | number } | string | number;
  ["@_id"]?: string | number;
};

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readAttributeValue(value: Record<string, unknown>, key: string): string | null {
  const direct = value[key];
  if (typeof direct === "string" || typeof direct === "number") {
    return String(direct);
  }
  const attr = value[`@_${key}`] ?? value[`@${key}`];
  if (typeof attr === "string" || typeof attr === "number") {
    return String(attr);
  }
  return null;
}

function readNodeValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readAttributeValue(record, "value") ?? readAttributeValue(record, "name");
  }
  return null;
}

function pickPrimaryName(value: BggSearchItem["name"]): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    const primary = value.find((node) => {
      const nodeType = readNodeValue((node as BggNameNode).type ?? (node as BggNameNode)["@_type"]);
      return nodeType === "primary";
    });
    return readNodeValue(primary ?? value[0]) ?? "";
  }
  return readNodeValue(value) ?? "";
}

function normalizeSubjectId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function extractYear(value: unknown): number | undefined {
  const text = readNodeValue(value);
  if (!text) return undefined;
  const year = Number.parseInt(text.slice(0, 4), 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    return undefined;
  }
  return year;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function scoreCandidate(query: string, subject: ShareSubject): number {
  const q = normalizeText(query);
  if (!q) return 0;
  const candidates = [subject.localizedName || "", subject.name];
  let score = 0;
  for (const text of candidates) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    if (normalized === q) score += 100;
    if (normalized.startsWith(q)) score += 60;
    if (normalized.includes(q)) score += 25;
  }
  if (typeof subject.releaseYear === "number") {
    const yearText = String(subject.releaseYear);
    if (yearText.includes(q)) score += 5;
  }
  return score;
}

function reorderByPromotedIds<T extends { id: number | string }>(
  items: T[],
  promotedIds: Array<number | string>
): T[] {
  if (items.length === 0 || promotedIds.length === 0) {
    return items;
  }
  const promotedSet = new Set(promotedIds.map((id) => String(id)));
  const promoted: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (promotedSet.has(String(item.id))) {
      promoted.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...promoted, ...rest];
}

export function buildBggSearchResponse(params: {
  query: string;
  kind: SubjectKind;
  items: ShareSubject[];
}): SubjectSearchResponse {
  const { query, kind, items } = params;
  const ranked = items
    .map((item) => ({ id: item.id, score: scoreCandidate(query, item) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.id);
  const promotedIds = ranked.length > 0 ? ranked : items.slice(0, 2).map((item) => item.id);
  const orderedItems = reorderByPromotedIds(items, promotedIds);
  return {
    ok: true,
    source: "bgg",
    kind,
    items: orderedItems,
    noResultQuery: items.length === 0 && query.trim() ? query : null,
  };
}

export async function searchBggBoardgames(params: {
  query: string;
  kind: SubjectKind;
}): Promise<ShareSubject[]> {
  const { query } = params;
  const q = query.trim();
  if (!q) return [];
  const result = await BGG_CLIENT("search", { query: q, type: "boardgame" });
  const items: BggSearchItem[] = toArray(
    (result as { items?: { item?: BggSearchItem | BggSearchItem[] } })?.items?.item
  );
  return items
    .flatMap((item) => {
      const id = normalizeSubjectId(item.id ?? item["@_id"]);
      const name = pickPrimaryName(item.name);
      if (!id || !name) return [];
      const releaseYear = extractYear(item.yearpublished);
      return [
        {
        id,
        name,
        localizedName: name,
        cover: null,
        releaseYear,
        storeUrls: {
          bgg: `https://boardgamegeek.com/boardgame/${id}`,
        },
        } satisfies ShareSubject,
      ];
    });
}
