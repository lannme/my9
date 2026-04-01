import {
  StoredShareV1,
  TrendBucket,
  TrendGameItem,
  TrendPeriod,
  TrendResponse,
  TrendView,
} from "@/lib/share/types";
import { SubjectKind } from "@/lib/subject-kind";

const OVERALL_TREND_LIMIT = 100;
const GROUPED_TOP_GAMES_LIMIT = 5;

function gameKey(id: string | number, name: string) {
  const idPart = String(id).trim();
  if (idPart) return idPart;
  return name.trim().toLowerCase();
}

function toTrendGameItem(base: {
  id: string;
  name: string;
  localizedName?: string;
  cover: string | null;
  releaseYear?: number;
  count: number;
}): TrendGameItem {
  return {
    id: base.id,
    name: base.name,
    localizedName: base.localizedName,
    cover: base.cover,
    releaseYear: base.releaseYear,
    count: base.count,
  };
}

function sortByCount<T extends { count: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.count - a.count);
}

function buildOverallBuckets(shares: StoredShareV1[]): TrendBucket[] {
  const gameCount = new Map<string, TrendGameItem>();

  for (const share of shares) {
    for (const game of share.games) {
      if (!game) continue;
      const key = gameKey(game.id, game.name);
      const existing = gameCount.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        gameCount.set(
          key,
          toTrendGameItem({
            id: key,
            name: game.name,
            localizedName: game.localizedName,
            cover: game.cover,
            releaseYear: game.releaseYear,
            count: 1,
          })
        );
      }
    }
  }

  const ranking = sortByCount(Array.from(gameCount.values())).slice(0, OVERALL_TREND_LIMIT);
  return ranking.map((game, index) => ({
    key: String(index + 1),
    label: `#${index + 1}`,
    count: game.count,
    games: [game],
  }));
}

function buildGenreBuckets(shares: StoredShareV1[]): TrendBucket[] {
  const genreMap = new Map<string, Map<string, TrendGameItem>>();

  for (const share of shares) {
    for (const game of share.games) {
      if (!game) continue;
      const genres =
        Array.isArray(game.genres) && game.genres.length > 0 ? game.genres : ["未分类"];

      const key = gameKey(game.id, game.name);

      for (const genre of genres) {
        if (!genreMap.has(genre)) {
          genreMap.set(genre, new Map<string, TrendGameItem>());
        }
        const gameMap = genreMap.get(genre)!;
        const existing = gameMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          gameMap.set(
            key,
            toTrendGameItem({
              id: key,
              name: game.name,
              localizedName: game.localizedName,
              cover: game.cover,
              releaseYear: game.releaseYear,
              count: 1,
            })
          );
        }
      }
    }
  }

  const buckets: TrendBucket[] = [];
  for (const [genre, games] of Array.from(genreMap.entries())) {
    const sortedGames = sortByCount(Array.from(games.values()));
    const topGames = sortedGames.slice(0, GROUPED_TOP_GAMES_LIMIT);
    buckets.push({
      key: genre,
      label: genre,
      count: sortedGames.reduce((sum, item) => sum + item.count, 0),
      games: topGames,
    });
  }

  return sortByCount(buckets).slice(0, 20);
}

function buildYearLikeBuckets(
  shares: StoredShareV1[],
  type: "decade" | "year"
): TrendBucket[] {
  const bucketMap = new Map<string, Map<string, TrendGameItem>>();

  for (const share of shares) {
    for (const game of share.games) {
      if (!game || !game.releaseYear) continue;
      const bucket =
        type === "decade"
          ? `${Math.floor(game.releaseYear / 10) * 10}s`
          : String(game.releaseYear);

      if (!bucketMap.has(bucket)) {
        bucketMap.set(bucket, new Map<string, TrendGameItem>());
      }

      const gameMap = bucketMap.get(bucket)!;
      const key = gameKey(game.id, game.name);
      const existing = gameMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        gameMap.set(
          key,
          toTrendGameItem({
            id: key,
            name: game.name,
            localizedName: game.localizedName,
            cover: game.cover,
            releaseYear: game.releaseYear,
            count: 1,
          })
        );
      }
    }
  }

  const buckets: TrendBucket[] = [];
  for (const [bucket, gameMap] of Array.from(bucketMap.entries())) {
    const sortedGames = sortByCount(Array.from(gameMap.values()));
    const games = sortedGames.slice(0, GROUPED_TOP_GAMES_LIMIT);
    const total = sortedGames.reduce((sum, item) => sum + item.count, 0);
    buckets.push({
      key: bucket,
      label: bucket,
      count: total,
      games,
    });
  }

  if (type === "decade") {
    return buckets.sort((a, b) => Number.parseInt(b.key, 10) - Number.parseInt(a.key, 10));
  }
  return buckets.sort((a, b) => Number(b.key) - Number(a.key));
}

export function buildTrendResponse(params: {
  period: TrendPeriod;
  view: TrendView;
  kind: SubjectKind;
  shares: StoredShareV1[];
}): TrendResponse {
  const { period, view, shares } = params;
  const timestamps = shares.map((item) => item.createdAt);
  const range = {
    from: timestamps.length ? Math.min(...timestamps) : null,
    to: timestamps.length ? Math.max(...timestamps) : null,
  };

  let items: TrendBucket[] = [];
  switch (view) {
    case "genre":
      items = buildGenreBuckets(shares);
      break;
    case "decade":
      items = buildYearLikeBuckets(shares, "decade");
      break;
    case "year":
      items = buildYearLikeBuckets(shares, "year");
      break;
    case "overall":
    default:
      items = buildOverallBuckets(shares);
      break;
  }

  return {
    period,
    view,
    sampleCount: shares.length,
    range,
    lastUpdatedAt: Date.now(),
    items,
  };
}
