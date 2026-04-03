import { NextResponse } from "next/server";
import { DEFAULT_SUBJECT_KIND, SubjectKind, parseSubjectKind } from "@/lib/subject-kind";
import { normalizeSearchQuery } from "@/lib/search/query";
import { buildBggSearchResponse, searchBggBoardgames, type BggSearchResult } from "@/lib/bgg/search";
import { searchLocalBoardgames, upsertBggBoardgameFromSearch } from "@/lib/bgg/local-search";
import { fetchThingItems, bggToArray, type BggThingItem } from "@/lib/bgg/bgg-api";
import type { ShareSubject } from "@/lib/share/types";

const SEARCH_CDN_TTL_SECONDS = 900;
const SEARCH_STALE_TTL_SECONDS = 86400;
const SEARCH_MEMORY_TTL_MS = 3 * 60 * 1000;
const SEARCH_MEMORY_CACHE_MAX = 256;
const SEARCH_RATE_LIMIT_WINDOW_MS = 10 * 1000;
const SEARCH_RATE_LIMIT_MAX_REQUESTS = 8;
const SEARCH_RATE_LIMIT_STORE_MAX = 20000;
const LOCAL_SEARCH_SUFFICIENT_COUNT = 5;
const BGG_CIRCUIT_BREAKER_THRESHOLD = 3;
const BGG_CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 1000;

const SEARCH_CACHE_CONTROL_VALUE = `public, max-age=0, s-maxage=${SEARCH_CDN_TTL_SECONDS}, stale-while-revalidate=${SEARCH_STALE_TTL_SECONDS}`;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

type SearchMemoryStore = {
  resultCache: Map<string, { expiresAt: number; result: BggSearchResult }>;
  inflight: Map<string, Promise<BggSearchResult>>;
  rateLimit: Map<string, { windowStart: number; count: number }>;
  rateLimitBlockedCount: number;
  bggErrorCount: number;
  bggCircuitOpenUntil: number;
};

function getSearchMemoryStore(): SearchMemoryStore {
  const g = globalThis as typeof globalThis & {
    __MY9_BGG_SEARCH_MEMORY__?: SearchMemoryStore;
  };

  if (!g.__MY9_BGG_SEARCH_MEMORY__) {
    g.__MY9_BGG_SEARCH_MEMORY__ = {
      resultCache: new Map(),
      inflight: new Map(),
      rateLimit: new Map(),
      rateLimitBlockedCount: 0,
      bggErrorCount: 0,
      bggCircuitOpenUntil: 0,
    };
  }

  const store = g.__MY9_BGG_SEARCH_MEMORY__;
  if (typeof store.bggErrorCount !== "number") store.bggErrorCount = 0;
  if (typeof store.bggCircuitOpenUntil !== "number") store.bggCircuitOpenUntil = 0;

  return store;
}

function isBggCircuitOpen(): boolean {
  const store = getSearchMemoryStore();
  if (store.bggCircuitOpenUntil <= 0) return false;
  if (Date.now() >= store.bggCircuitOpenUntil) {
    store.bggCircuitOpenUntil = 0;
    store.bggErrorCount = 0;
    return false;
  }
  return true;
}

function recordBggSuccess(): void {
  const store = getSearchMemoryStore();
  store.bggErrorCount = 0;
  store.bggCircuitOpenUntil = 0;
}

function recordBggFailure(): void {
  const store = getSearchMemoryStore();
  store.bggErrorCount += 1;
  if (store.bggErrorCount >= BGG_CIRCUIT_BREAKER_THRESHOLD) {
    store.bggCircuitOpenUntil = Date.now() + BGG_CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(
      `[bgg-circuit-breaker] opened: ${store.bggErrorCount} consecutive errors, cooling down ${BGG_CIRCUIT_BREAKER_COOLDOWN_MS}ms`,
    );
  }
}

function trimSearchMemoryCache(cache: Map<string, { expiresAt: number; result: BggSearchResult }>) {
  while (cache.size > SEARCH_MEMORY_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) return;
    cache.delete(firstKey);
  }
}

function toSearchCacheKey(kind: SubjectKind, query: string) {
  return `${kind}:${normalizeSearchQuery(query)}`;
}

function toRateLimitKey(kind: SubjectKind, ip: string) {
  return `${kind}:${ip}`;
}

function parseForwardedFor(value: string): string | null {
  const first = value
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return first || null;
}

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return parseForwardedFor(forwarded);
  }
  const direct =
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-client-ip");
  if (!direct) return null;
  const trimmed = direct.trim();
  return trimmed || null;
}

function trimRateLimitStore(
  rateLimit: Map<string, { windowStart: number; count: number }>,
  now: number,
) {
  const expiredKeys: string[] = [];
  rateLimit.forEach((value, key) => {
    if (now - value.windowStart >= SEARCH_RATE_LIMIT_WINDOW_MS) {
      expiredKeys.push(key);
    }
  });
  for (const key of expiredKeys) {
    rateLimit.delete(key);
  }
  while (rateLimit.size > SEARCH_RATE_LIMIT_STORE_MAX) {
    const firstKey = rateLimit.keys().next().value;
    if (!firstKey) return;
    rateLimit.delete(firstKey);
  }
}

function checkSearchRateLimit(request: Request, kind: SubjectKind): {
  limited: boolean;
  retryAfterSeconds: number;
} {
  const ip = getClientIp(request);
  if (!ip) return { limited: false, retryAfterSeconds: 0 };

  const now = Date.now();
  const memory = getSearchMemoryStore();
  const key = toRateLimitKey(kind, ip);
  const existing = memory.rateLimit.get(key);

  if (!existing || now - existing.windowStart >= SEARCH_RATE_LIMIT_WINDOW_MS) {
    memory.rateLimit.set(key, { windowStart: now, count: 1 });
    trimRateLimitStore(memory.rateLimit, now);
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (existing.count >= SEARCH_RATE_LIMIT_MAX_REQUESTS) {
    trimRateLimitStore(memory.rateLimit, now);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((SEARCH_RATE_LIMIT_WINDOW_MS - (now - existing.windowStart)) / 1000),
    );
    memory.rateLimitBlockedCount += 1;
    if (memory.rateLimitBlockedCount <= 5 || memory.rateLimitBlockedCount % 50 === 0) {
      console.warn(
        `[bgg-search-rate-limit] blocked=${memory.rateLimitBlockedCount} kind=${kind} retry=${retryAfterSeconds}s`,
      );
    }
    return { limited: true, retryAfterSeconds };
  }

  existing.count += 1;
  memory.rateLimit.set(key, existing);
  trimRateLimitStore(memory.rateLimit, now);
  return { limited: false, retryAfterSeconds: 0 };
}

function createSearchCacheHeaders() {
  return {
    "Cache-Control": SEARCH_CACHE_CONTROL_VALUE,
    "CDN-Cache-Control": SEARCH_CACHE_CONTROL_VALUE,
  };
}

function mergeLocalAndBggResults(
  localItems: ShareSubject[],
  bggItems: ShareSubject[],
): ShareSubject[] {
  const seen = new Set<string>();
  const merged: ShareSubject[] = [];

  for (const item of bggItems) {
    const key = String(item.id);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  for (const item of localItems) {
    const key = String(item.id);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  return merged.slice(0, 20);
}

async function getCachedSearchResult(query: string, kind: SubjectKind): Promise<BggSearchResult> {
  const memory = getSearchMemoryStore();
  const key = toSearchCacheKey(kind, query);
  const now = Date.now();

  const cached = memory.resultCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;
  if (cached) memory.resultCache.delete(key);

  const pending = memory.inflight.get(key);
  if (pending) return pending;

  const requestPromise = executeSearch(query);
  memory.inflight.set(key, requestPromise);

  try {
    const result = await requestPromise;
    memory.resultCache.set(key, {
      expiresAt: now + SEARCH_MEMORY_TTL_MS,
      result,
    });
    trimSearchMemoryCache(memory.resultCache);
    return result;
  } finally {
    if (memory.inflight.get(key) === requestPromise) {
      memory.inflight.delete(key);
    }
  }
}

async function enrichLocalCovers(
  items: ShareSubject[],
  needsEnrichIds: string[],
): Promise<{ items: ShareSubject[]; thingMap: Map<string, BggThingItem> }> {
  if (needsEnrichIds.length === 0) return { items, thingMap: new Map() };

  const idsToFetch = needsEnrichIds.slice(0, 20);
  const thingMap = new Map<string, BggThingItem>();

  try {
    const response = await fetchThingItems({
      id: idsToFetch.join(","),
      type: "boardgame",
      stats: 1,
    });
    for (const thing of bggToArray(response.items?.item)) {
      if (thing.id) thingMap.set(String(thing.id), thing);
    }
    recordBggSuccess();
  } catch {
    recordBggFailure();
    return { items, thingMap: new Map() };
  }

  const enriched = items.map((item) => {
    const id = String(item.id);
    if (item.cover) return item;
    const thing = thingMap.get(id);
    if (!thing) return item;
    const cover = thing.image || thing.thumbnail || null;
    if (!cover) return item;
    return { ...item, cover };
  });

  const upsertItems = enriched.filter((item) => thingMap.has(String(item.id)));
  if (upsertItems.length > 0) {
    upsertBggBoardgameFromSearch(upsertItems, thingMap).catch(() => {});
  }

  return { items: enriched, thingMap };
}

async function executeSearch(query: string): Promise<BggSearchResult> {
  let localItems: ShareSubject[] = [];
  let needsEnrichIds: string[] = [];
  let localOk = false;

  try {
    const localResult = await searchLocalBoardgames(query);
    localItems = localResult.items;
    needsEnrichIds = localResult.needsEnrich;
    localOk = true;

    if (localItems.length >= LOCAL_SEARCH_SUFFICIENT_COUNT) {
      if (needsEnrichIds.length > 0 && !isBggCircuitOpen()) {
        const { items: enrichedItems, thingMap } = await enrichLocalCovers(localItems, needsEnrichIds);
        console.log(
          JSON.stringify({
            event: "bgg_search",
            query,
            source: "local+enrich",
            resultCount: enrichedItems.length,
            enrichedCount: needsEnrichIds.length,
          }),
        );
        return { items: enrichedItems, thingMap };
      }
      console.log(
        JSON.stringify({
          event: "bgg_search",
          query,
          source: "local",
          resultCount: localItems.length,
        }),
      );
      return { items: localItems, thingMap: new Map() };
    }
  } catch {
    localOk = false;
  }

  if (isBggCircuitOpen()) {
    if (localOk && localItems.length > 0) {
      console.log(
        JSON.stringify({
          event: "bgg_search",
          query,
          source: "local",
          resultCount: localItems.length,
          circuitOpen: true,
        }),
      );
      return { items: localItems, thingMap: new Map() };
    }
  }

  let bggResult: BggSearchResult | null = null;
  try {
    bggResult = await searchBggBoardgames({ query });
    recordBggSuccess();
  } catch (error) {
    recordBggFailure();

    if (localOk && localItems.length > 0) {
      console.log(
        JSON.stringify({
          event: "bgg_search",
          query,
          source: "local",
          resultCount: localItems.length,
          bgFallback: true,
        }),
      );
      return { items: localItems, thingMap: new Map() };
    }

    throw error;
  }

  if (bggResult.items.length > 0) {
    upsertBggBoardgameFromSearch(bggResult.items, bggResult.thingMap).catch(() => {});
  }

  if (localOk && localItems.length > 0 && bggResult.items.length > 0) {
    const merged = mergeLocalAndBggResults(localItems, bggResult.items);
    console.log(
      JSON.stringify({
        event: "bgg_search",
        query,
        source: "mixed",
        resultCount: merged.length,
        localCount: localItems.length,
        bggCount: bggResult.items.length,
      }),
    );
    return { items: merged, thingMap: bggResult.thingMap };
  }

  console.log(
    JSON.stringify({
      event: "bgg_search",
      query,
      source: "api",
      resultCount: bggResult.items.length,
    }),
  );
  return bggResult;
}

export async function handleBggSearchRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = normalizeSearchQuery(searchParams.get("q"));
  const kind = parseSubjectKind(searchParams.get("kind")) ?? DEFAULT_SUBJECT_KIND;

  if (!query) {
    return NextResponse.json(buildBggSearchResponse({ query: "", kind, items: [] }), {
      headers: createSearchCacheHeaders(),
    });
  }

  const rateLimit = checkSearchRateLimit(request, kind);
  if (rateLimit.limited) {
    const payload = buildBggSearchResponse({ query, kind, items: [] });
    return NextResponse.json(
      { ...payload, ok: false, error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Limit": String(SEARCH_RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Window": String(Math.ceil(SEARCH_RATE_LIMIT_WINDOW_MS / 1000)),
        },
      },
    );
  }

  try {
    const { items, thingMap } = await getCachedSearchResult(query, kind);
    return NextResponse.json(buildBggSearchResponse({ query, kind, items, thingMap }), {
      headers: createSearchCacheHeaders(),
    });
  } catch (error) {
    const payload = buildBggSearchResponse({ query, kind, items: [] });
    return NextResponse.json(
      { ...payload, ok: false, error: error instanceof Error ? error.message : "搜索失败" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
