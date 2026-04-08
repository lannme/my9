import type { SubjectKind } from "@/lib/subject-kind";
import type { ShareSubject, SubjectSearchResponse } from "@/lib/share/types";
import {
  searchItems,
  fetchThingItems,
  bggToArray,
  type BggThingItem,
  type BggName,
  type BggLink,
} from "@/lib/bgg/bgg-api";

const BGG_SEARCH_LIMIT = 50;
const BGG_RESULT_LIMIT = 20;
const BGG_THING_BATCH_SIZE = 20;

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const JAPANESE_KANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/;
const KOREAN_RE = /[\uac00-\ud7af\u1100-\u11ff]/;

function isChinese(text: string): boolean {
  return CJK_RE.test(text) && !JAPANESE_KANA_RE.test(text) && !KOREAN_RE.test(text);
}

const TRAILING_LATIN_PAREN_RE = /\s*\([^()]*[A-Za-z][^()]*\)\s*/g;
const TRAILING_YEAR_PAREN_RE = /\s*\(\d{4}\)\s*/g;

function cleanChineseName(raw: string): string {
  return raw
    .replace(TRAILING_LATIN_PAREN_RE, "")
    .replace(TRAILING_YEAR_PAREN_RE, "")
    .trim();
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

function resolveName(
  nameField: BggName | BggName[] | undefined,
): { primary: string; chineseName: string } {
  const names = bggToArray(nameField);
  const primary = names.find((n) => n.type === "primary")?.value ?? names[0]?.value ?? "";
  const rawChinese =
    names.find((n) => n.type === "alternate" && n.value && isChinese(n.value))?.value ?? "";
  const chineseName = rawChinese ? cleanChineseName(rawChinese) : "";
  return { primary, chineseName };
}

function extractGenres(linkField: BggLink | BggLink[] | undefined): string[] {
  const links = bggToArray(linkField);
  return links
    .filter((l) => l.type === "boardgamecategory")
    .map((l) => l.value ?? "")
    .filter(Boolean)
    .slice(0, 3);
}

function parseFloat0(raw?: string): number {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseInt0(raw?: string): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

interface ScoredSubject {
  subject: ShareSubject;
  score: number;
}

function scoreCandidate(
  query: string,
  subject: ShareSubject,
  stats: { numComments: number; bayesAverage: number; usersRated: number },
): number {
  const q = normalizeText(query);
  if (!q) return 0;

  let score = 0;

  const candidates = [subject.localizedName || "", subject.name];
  for (const text of candidates) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    if (normalized === q) score += 200;
    else if (normalized.startsWith(q)) score += 120;
    else if (normalized.includes(q)) score += 50;
  }

  if (stats.bayesAverage > 0) {
    score += stats.bayesAverage * 10;
  }

  if (stats.numComments > 0) {
    score += Math.min(Math.log10(stats.numComments + 1) * 20, 100);
  }

  if (stats.usersRated > 0) {
    score += Math.min(Math.log10(stats.usersRated + 1) * 15, 75);
  }

  return score;
}

export interface BggSearchResult {
  items: ShareSubject[];
  thingMap: Map<string, BggThingItem>;
}

export async function searchBggBoardgames(params: {
  query: string;
}): Promise<BggSearchResult> {
  const q = params.query.trim();
  if (!q) return { items: [], thingMap: new Map() };

  const searchResult = await searchItems({ query: q, type: "boardgame" });
  const rawItems = bggToArray(searchResult.items?.item).slice(0, BGG_SEARCH_LIMIT);

  if (rawItems.length === 0) return { items: [], thingMap: new Map() };

  const allIds = rawItems.map((item) => item.id).filter(Boolean) as string[];
  if (allIds.length === 0) return { items: [], thingMap: new Map() };

  const thingMap = new Map<string, BggThingItem>();
  const batches: string[][] = [];
  for (let i = 0; i < allIds.length; i += BGG_THING_BATCH_SIZE) {
    batches.push(allIds.slice(i, i + BGG_THING_BATCH_SIZE));
  }

  const concurrency = 2;
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (batch) => {
        const batchIds = batch.join(",");
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await fetchThingItems({ id: batchIds, type: "boardgame", stats: 1 });
          } catch {
            if (attempt === 1) throw new Error(`BGG thing batch failed after retry: ${batchIds}`);
            await new Promise((r) => setTimeout(r, 800));
          }
        }
        return undefined;
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        for (const item of bggToArray(result.value.items?.item)) {
          if (item.id) thingMap.set(String(item.id), item);
        }
      }
    }
  }

  const results: ShareSubject[] = [];
  for (const searchItem of rawItems) {
    const id = searchItem.id;
    if (!id) continue;
    const thing = thingMap.get(id);
    const nameField =
      thing?.name ??
      (searchItem.name ? { value: searchItem.name.value, type: searchItem.name.type } : undefined);
    const { primary, chineseName } = resolveName(nameField);
    if (!primary) continue;

    const cover = thing?.image || thing?.thumbnail || null;
    const releaseYear = extractYear(
      thing?.yearpublished?.value ?? searchItem.yearpublished?.value,
    );
    const genres = thing ? extractGenres(thing.link) : [];

    const ratings = thing?.statistics?.ratings;
    const bayesAverage = parseFloat0(ratings?.bayesaverage?.value);

    results.push({
      id,
      name: primary,
      localizedName: chineseName || undefined,
      cover,
      releaseYear,
      genres: genres.length > 0 ? genres : undefined,
      storeUrls: {
        bgg: `https://boardgamegeek.com/boardgame/${id}`,
      },
      rating: bayesAverage > 0 ? Math.round(bayesAverage * 10) / 10 : undefined,
    });
  }

  return { items: results, thingMap };
}

export function buildBggSearchResponse(params: {
  query: string;
  kind: SubjectKind;
  items: ShareSubject[];
  thingMap?: Map<string, BggThingItem>;
}): SubjectSearchResponse {
  const { query, kind, items, thingMap } = params;

  const scored: ScoredSubject[] = items.map((subject) => {
    const thing = thingMap?.get(String(subject.id));
    const ratings = thing?.statistics?.ratings;
    const bayesAverage = parseFloat0(ratings?.bayesaverage?.value);
    const stats = {
      numComments: parseInt0(ratings?.numcomments?.value),
      bayesAverage,
      usersRated: parseInt0(ratings?.usersrated?.value),
    };
    const enriched: ShareSubject = {
      ...subject,
      rating: bayesAverage > 0 ? Math.round(bayesAverage * 10) / 10 : subject.rating,
    };
    return { subject: enriched, score: scoreCandidate(query, subject, stats) };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    source: "bgg",
    kind,
    items: scored.map((s) => s.subject).slice(0, BGG_RESULT_LIMIT),
    noResultQuery: items.length === 0 && query.trim() ? query : null,
  };
}
