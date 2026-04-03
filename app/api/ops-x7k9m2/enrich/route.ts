import { NextResponse } from "next/server";
import {
  fetchThingItems,
  bggToArray,
  type BggThingItem,
  type BggName,
  type BggLink,
} from "@/lib/bgg/bgg-api";
import { _getSqlClient, _ensureSchema, BGG_BOARDGAME_TABLE } from "@/lib/share/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30_000;
const MAX_RETRIES = 1;

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${cronSecret}`;
}

function stripHtml(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/<[^>]*>/g, "").trim();
}

function parseFloat0(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseInt0(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseRankValue(raw: string | undefined): number | null {
  if (!raw || raw === "Not Ranked") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const RANK_NAME_TO_COLUMN: Record<string, string> = {
  boardgame: "bgg_rank",
  abstracts: "abstracts_rank",
  cgs: "cgs_rank",
  childrensgames: "childrensgames_rank",
  familygames: "familygames_rank",
  partygames: "partygames_rank",
  strategygames: "strategygames_rank",
  thematic: "thematic_rank",
  wargames: "wargames_rank",
};

function extractRanks(item: BggThingItem): Record<string, number | null> {
  const ranks: Record<string, number | null> = {};
  const rankItems = bggToArray(item.statistics?.ratings?.ranks?.rank);
  for (const r of rankItems) {
    const name = r.name;
    if (name && RANK_NAME_TO_COLUMN[name]) {
      ranks[RANK_NAME_TO_COLUMN[name]] = parseRankValue(r.value);
    }
  }
  return ranks;
}

function extractLinkValues(links: BggLink[], type: string, max = 20): string[] {
  return links
    .filter((l) => l.type === type)
    .map((l) => l.value ?? "")
    .filter(Boolean)
    .slice(0, max);
}

type ItemData = {
  id: string;
  cover: string | null;
  thumbnail: string | null;
  primaryName: string | null;
  localizedNames: string[] | null;
  description: string | null;
  genres: string[] | null;
  mechanics: string[] | null;
  families: string[] | null;
  designers: string[] | null;
  artists: string[] | null;
  publishers: string[] | null;
  numComments: number;
  bayesAverage: number;
  average: number;
  usersRated: number;
  [key: string]: string | number | string[] | null;
};

function extractItemData(item: BggThingItem): ItemData | null {
  const id = item.id;
  if (!id) return null;

  const image = item.image || null;
  const thumb = item.thumbnail || null;

  const names = bggToArray(item.name) as BggName[];
  const primaryName = names.find((n) => n.type === "primary")?.value || null;

  const alternateNames = names
    .filter((n) => n.type === "alternate" && n.value)
    .map((n) => n.value!)
    .filter(Boolean);
  const localizedNames = alternateNames.length > 0 ? alternateNames : null;

  const rawDescription = typeof item.description === "string" ? item.description : "";
  const description = stripHtml(rawDescription).slice(0, 500) || null;

  const links = bggToArray(item.link) as BggLink[];
  const genres = extractLinkValues(links, "boardgamecategory", 10);
  const mechanics = extractLinkValues(links, "boardgamemechanic", 20);
  const families = extractLinkValues(links, "boardgamefamily", 15);
  const designers = extractLinkValues(links, "boardgamedesigner", 10);
  const artists = extractLinkValues(links, "boardgameartist", 10);
  const publishers = extractLinkValues(links, "boardgamepublisher", 10);

  const ratings = item.statistics?.ratings;
  const bayesAverage = parseFloat0(ratings?.bayesaverage?.value);
  const average = parseFloat0(ratings?.average?.value);
  const usersRated = parseInt0(ratings?.usersrated?.value);
  const numComments = parseInt0(ratings?.numcomments?.value);

  const ranks = extractRanks(item);

  return {
    id: String(id),
    cover: image,
    thumbnail: thumb,
    primaryName,
    localizedNames,
    description,
    genres: genres.length > 0 ? genres : null,
    mechanics: mechanics.length > 0 ? mechanics : null,
    families: families.length > 0 ? families : null,
    designers: designers.length > 0 ? designers : null,
    artists: artists.length > 0 ? artists : null,
    publishers: publishers.length > 0 ? publishers : null,
    numComments,
    bayesAverage,
    average,
    usersRated,
    ...ranks,
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sql = _getSqlClient();
  if (!sql || !(await _ensureSchema())) {
    return NextResponse.json({ ok: false, error: "database not available" }, { status: 503 });
  }

  let batchSize = 20;
  let limit = 200;
  let rankFrom = 1;
  let rankTo = 0;
  let forceMode = false;
  try {
    const body = await request.json();
    if (typeof body.batchSize === "number" && Number.isFinite(body.batchSize)) {
      batchSize = Math.max(1, Math.trunc(body.batchSize));
    }
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.trunc(body.limit));
    }
    if (typeof body.rankFrom === "number" && Number.isFinite(body.rankFrom)) {
      rankFrom = Math.max(1, Math.trunc(body.rankFrom));
    }
    if (typeof body.rankTo === "number" && Number.isFinite(body.rankTo)) {
      rankTo = Math.max(0, Math.trunc(body.rankTo));
    }
    if (body.force === true) {
      forceMode = true;
    }
  } catch {
    /* use defaults */
  }

  try {
    const conditions: string[] = ["bgg_rank IS NOT NULL"];
    const params: (number | string)[] = [];
    let paramIdx = 1;

    conditions.push(`bgg_rank >= $${paramIdx}`);
    params.push(rankFrom);
    paramIdx++;

    if (rankTo > 0) {
      conditions.push(`bgg_rank <= $${paramIdx}`);
      params.push(rankTo);
      paramIdx++;
    }

    if (!forceMode) {
      conditions.push("api_enriched_at IS NULL");
    }

    const limitParam = `$${paramIdx}`;
    params.push(limit);

    const rows = (await sql.query(
      `SELECT bgg_id FROM ${BGG_BOARDGAME_TABLE}
       WHERE ${conditions.join(" AND ")}
       ORDER BY bgg_rank ASC
       LIMIT ${limitParam}`,
      params
    )) as Array<{ bgg_id: string }>;

    const totalFound = rows.length;
    if (totalFound === 0) {
      return NextResponse.json({
        ok: true,
        result: { totalFound: 0, totalFetched: 0, enriched: 0, failed: 0, skipped: 0, elapsedMs: 0 },
      });
    }

    const startTime = Date.now();
    let totalFetched = 0;
    let enriched = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];

    const allIds = rows.map((r) => r.bgg_id);
    const batches: string[][] = [];
    for (let i = 0; i < allIds.length; i += batchSize) {
      batches.push(allIds.slice(i, i + batchSize));
    }

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batchIds = batches[batchIdx];

      let thingItems: BggThingItem[] = [];
      let fetched = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetchThingItems({
            id: batchIds.join(","),
            type: "boardgame",
            stats: 1,
          });
          thingItems = bggToArray(response.items?.item);
          totalFetched += batchIds.length;
          fetched = true;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const is429 = msg.includes("429");
          if (is429 && attempt < MAX_RETRIES) {
            errors.push(`batch#${batchIdx} 429 限流，${RETRY_DELAY_MS / 1000}s 后重试`);
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          errors.push(`batch#${batchIdx} fetch 失败(attempt ${attempt + 1}): ${msg}`);
          failed += batchIds.length;
          if (batchIdx < batches.length - 1) {
            await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
          }
        }
      }

      if (!fetched) continue;

      const itemMap = new Map<string, ItemData>();
      for (const item of thingItems) {
        const data = extractItemData(item);
        if (data) itemMap.set(data.id, data);
      }

      for (const bggId of batchIds) {
        const data = itemMap.get(bggId);
        if (!data) {
          skipped++;
          continue;
        }

        try {
          const now = Date.now();
          await sql.query(
            `UPDATE ${BGG_BOARDGAME_TABLE} SET
              cover = $1,
              thumbnail = $2,
              localized_names = $3,
              genres = $4,
              mechanics = $5,
              families = $6,
              designers = $7,
              artists = $8,
              publishers = $9,
              description = $10,
              num_comments = $11,
              bayes_average = $12,
              average = $13,
              users_rated = $14,
              bgg_rank = $15,
              abstracts_rank = $16,
              cgs_rank = $17,
              childrensgames_rank = $18,
              familygames_rank = $19,
              partygames_rank = $20,
              strategygames_rank = $21,
              thematic_rank = $22,
              wargames_rank = $23,
              api_enriched_at = $24,
              updated_at = $25
            WHERE bgg_id = $26`,
            [
              data.cover,
              data.thumbnail,
              data.localizedNames ? JSON.stringify(data.localizedNames) : null,
              data.genres ? JSON.stringify(data.genres) : null,
              data.mechanics ? JSON.stringify(data.mechanics) : null,
              data.families ? JSON.stringify(data.families) : null,
              data.designers ? JSON.stringify(data.designers) : null,
              data.artists ? JSON.stringify(data.artists) : null,
              data.publishers ? JSON.stringify(data.publishers) : null,
              data.description,
              data.numComments,
              data.bayesAverage,
              data.average,
              data.usersRated,
              data.bgg_rank ?? null,
              data.abstracts_rank ?? null,
              data.cgs_rank ?? null,
              data.childrensgames_rank ?? null,
              data.familygames_rank ?? null,
              data.partygames_rank ?? null,
              data.strategygames_rank ?? null,
              data.thematic_rank ?? null,
              data.wargames_rank ?? null,
              now,
              now,
              bggId,
            ]
          );
          enriched++;
        } catch (dbErr) {
          errors.push(`bgg_id=${bggId} DB 写入失败: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
          failed++;
        }
      }

      if (batchIdx < batches.length - 1) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }
    }

    const elapsedMs = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      result: {
        totalFound,
        totalFetched,
        enriched,
        failed,
        skipped,
        elapsedMs,
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "enrich failed" },
      { status: 500 }
    );
  }
}
