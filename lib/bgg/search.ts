import { XMLParser } from "fast-xml-parser";
import type { SubjectKind } from "@/lib/subject-kind";
import type { ShareSubject, SubjectSearchResponse } from "@/lib/share/types";

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";
const BGG_APP_TOKEN = process.env.BGG_APP_TOKEN ?? "";
const BGG_SEARCH_LIMIT = 20;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "_text",
});

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/xml",
  };
  if (BGG_APP_TOKEN) {
    headers["Authorization"] = `Bearer ${BGG_APP_TOKEN}`;
  }
  return headers;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function extractYear(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const year = Number.parseInt(String(raw).slice(0, 4), 10);
  if (!Number.isFinite(year) || year < 1000 || year > 2100) return undefined;
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
    if (String(subject.releaseYear).includes(q)) score += 5;
  }
  return score;
}

function reorderByPromotedIds<T extends { id: number | string }>(
  items: T[],
  promotedIds: Array<number | string>,
): T[] {
  if (items.length === 0 || promotedIds.length === 0) return items;
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

type BggSearchItem = {
  id?: string;
  type?: string;
  name?: { value?: string; type?: string } | Array<{ value?: string; type?: string }>;
  yearpublished?: { value?: string };
};

type BggThingItem = {
  id?: string;
  type?: string;
  thumbnail?: string;
  image?: string;
  name?: { value?: string; type?: string } | Array<{ value?: string; type?: string }>;
  yearpublished?: { value?: string };
  link?: Array<{ type?: string; value?: string }> | { type?: string; value?: string };
};

function resolveName(
  nameField: { value?: string; type?: string } | Array<{ value?: string; type?: string }> | undefined,
): { primary: string; alternate: string } {
  const names = toArray(nameField);
  const primary = names.find((n) => n.type === "primary")?.value ?? names[0]?.value ?? "";
  const alternate = names.find((n) => n.type === "alternate")?.value ?? "";
  return { primary, alternate };
}

function extractGenres(
  linkField: Array<{ type?: string; value?: string }> | { type?: string; value?: string } | undefined,
): string[] {
  const links = toArray(linkField);
  return links
    .filter((l) => l.type === "boardgamecategory")
    .map((l) => l.value ?? "")
    .filter(Boolean)
    .slice(0, 3);
}

async function fetchBggXml(path: string): Promise<string> {
  const response = await fetch(`${BGG_API_BASE}${path}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`BGG API error: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export async function searchBggBoardgames(params: {
  query: string;
}): Promise<ShareSubject[]> {
  const q = params.query.trim();
  if (!q) return [];

  const xml = await fetchBggXml(
    `/search?query=${encodeURIComponent(q)}&type=boardgame`,
  );
  const parsed = xmlParser.parse(xml);
  const rawItems: BggSearchItem[] = toArray(parsed?.items?.item).slice(0, BGG_SEARCH_LIMIT);

  if (rawItems.length === 0) return [];

  const ids = rawItems.map((item) => item.id).filter(Boolean).join(",");
  if (!ids) return [];

  const thingXml = await fetchBggXml(`/thing?id=${ids}&type=boardgame`);
  const thingParsed = xmlParser.parse(thingXml);
  const thingItems: BggThingItem[] = toArray(thingParsed?.items?.item);

  const thingMap = new Map<string, BggThingItem>();
  for (const item of thingItems) {
    if (item.id) thingMap.set(String(item.id), item);
  }

  const results: ShareSubject[] = [];
  for (const searchItem of rawItems) {
    const id = searchItem.id;
    if (!id) continue;
    const thing = thingMap.get(id);
    const { primary, alternate } = resolveName(thing?.name ?? searchItem.name);
    if (!primary) continue;

    const cover = thing?.image || thing?.thumbnail || null;
    const releaseYear = extractYear(thing?.yearpublished?.value ?? searchItem.yearpublished?.value);
    const genres = thing ? extractGenres(thing.link) : [];

    results.push({
      id,
      name: primary,
      localizedName: alternate || undefined,
      cover,
      releaseYear,
      genres: genres.length > 0 ? genres : undefined,
      storeUrls: {
        bgg: `https://boardgamegeek.com/boardgame/${id}`,
      },
    });
  }

  return results;
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
