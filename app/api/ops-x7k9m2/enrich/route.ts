import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { XMLParser } from "fast-xml-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BGG_TABLE = "my9_bgg_boardgame_v1";
const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const RATE_LIMIT_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "_text",
});

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${cronSecret}`;
}

function buildDatabaseUrl(): string | null {
  const readEnv = (...names: string[]) => {
    for (const name of names) {
      const v = process.env[name];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const host = readEnv("NEON_DATABASE_PGHOST_UNPOOLED", "NEON_DATABASE_PGHOST");
  const user = readEnv("NEON_DATABASE_PGUSER");
  const password = readEnv("NEON_DATABASE_PGPASSWORD", "NEON_DATABASE_POSTGRES_PASSWORD");
  const database = readEnv("NEON_DATABASE_PGDATABASE", "NEON_DATABASE_POSTGRES_DATABASE");
  if (!host || !user || !password || !database) return null;
  let hostWithPort = host;
  const port = readEnv("NEON_DATABASE_PGPORT");
  if (port && !host.includes(":")) hostWithPort = `${host}:${port}`;
  const sslMode = readEnv("NEON_DATABASE_PGSSLMODE") ?? "require";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostWithPort}/${encodeURIComponent(database)}?sslmode=${encodeURIComponent(sslMode)}`;
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRanks(ratings: any): Record<string, number | null> {
  const ranks: Record<string, number | null> = {};
  const rankItems = toArray(ratings?.ranks?.rank);
  for (const item of rankItems) {
    const name = (item as Record<string, string>).name;
    if (name && RANK_NAME_TO_COLUMN[name]) {
      ranks[RANK_NAME_TO_COLUMN[name]] = parseRankValue((item as Record<string, string>).value);
    }
  }
  return ranks;
}

type ItemData = {
  id: string;
  cover: string | null;
  thumbnail: string | null;
  primaryName: string | null;
  localizedName: string | null;
  description: string | null;
  genres: string[] | null;
  bayesAverage: number;
  average: number;
  usersRated: number;
  [key: string]: string | number | string[] | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractItemData(item: any): ItemData | null {
  const id = item.id;
  if (!id) return null;

  const image = item.image || null;
  const thumbnail = item.thumbnail || null;

  const names = toArray(item.name);
  const primaryName =
    (names as Record<string, string>[]).find((n) => n.type === "primary")?.value || null;
  const localizedName =
    (names as Record<string, string>[]).find(
      (n) => n.type === "alternate" && n.value && CJK_RE.test(n.value)
    )?.value || null;

  const rawDescription = typeof item.description === "string" ? item.description : "";
  const description = stripHtml(rawDescription).slice(0, 500) || null;

  const links = toArray(item.link);
  const genres = (links as Record<string, string>[])
    .filter((l) => l.type === "boardgamecategory")
    .map((l) => l.value)
    .filter(Boolean)
    .slice(0, 5);

  const ratings = item.statistics?.ratings;
  const bayesAverage = parseFloat0(ratings?.bayesaverage?.value);
  const average = parseFloat0(ratings?.average?.value);
  const usersRated = parseInt0(ratings?.usersrated?.value);

  const ranks = extractRanks(ratings);

  return {
    id: String(id),
    cover: image,
    thumbnail,
    primaryName,
    localizedName,
    description,
    genres: genres.length > 0 ? genres : null,
    bayesAverage,
    average,
    usersRated,
    ...ranks,
  };
}

async function fetchBggThingBatch(ids: string[], retried = false): Promise<unknown[]> {
  const url = `${BGG_API_BASE}/thing?id=${ids.join(",")}&type=boardgame&stats=1`;
  const response = await fetch(url, {
    headers: { Accept: "text/xml" },
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 429) {
    if (retried) {
      throw new Error("BGG API returned 429 after retry");
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchBggThingBatch(ids, true);
  }

  if (!response.ok) {
    throw new Error(`BGG API returned ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = xmlParser.parse(xml);
  return toArray(parsed?.items?.item);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const databaseUrl = buildDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "database not configured" }, { status: 500 });
  }

  let batchSize = 20;
  let limit = 200;
  try {
    const body = await request.json();
    if (typeof body.batchSize === "number" && Number.isFinite(body.batchSize)) {
      batchSize = Math.max(1, Math.trunc(body.batchSize));
    }
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.trunc(body.limit));
    }
  } catch {
    /* use defaults */
  }

  try {
    const sql = neon(databaseUrl);

    const rows = (await sql.query(
      `SELECT bgg_id FROM ${BGG_TABLE}
       WHERE cover IS NULL AND api_enriched_at IS NULL
       ORDER BY bayes_average DESC, users_rated DESC
       LIMIT $1`,
      [limit]
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

    const allIds = rows.map((r) => r.bgg_id);
    const batches: string[][] = [];
    for (let i = 0; i < allIds.length; i += batchSize) {
      batches.push(allIds.slice(i, i + batchSize));
    }

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batchIds = batches[batchIdx];

      let items: unknown[];
      try {
        items = await fetchBggThingBatch(batchIds);
        totalFetched += batchIds.length;
      } catch {
        failed += batchIds.length;
        if (batchIdx < batches.length - 1) {
          await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        }
        continue;
      }

      const itemMap = new Map<string, ItemData>();
      for (const item of items) {
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
            `UPDATE ${BGG_TABLE} SET
              cover = $1,
              thumbnail = $2,
              localized_name = COALESCE($3, ${BGG_TABLE}.localized_name),
              genres = $4,
              description = $5,
              bayes_average = $6,
              average = $7,
              users_rated = $8,
              bgg_rank = $9,
              abstracts_rank = $10,
              cgs_rank = $11,
              childrensgames_rank = $12,
              familygames_rank = $13,
              partygames_rank = $14,
              strategygames_rank = $15,
              thematic_rank = $16,
              wargames_rank = $17,
              api_enriched_at = $18,
              updated_at = $19
            WHERE bgg_id = $20`,
            [
              data.cover,
              data.thumbnail,
              data.localizedName,
              data.genres ? JSON.stringify(data.genres) : null,
              data.description,
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
        } catch {
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
      result: { totalFound, totalFetched, enriched, failed, skipped, elapsedMs },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "enrich failed" },
      { status: 500 }
    );
  }
}
