#!/usr/bin/env node

try { await import("dotenv/config"); } catch {}

import { neon } from "@neondatabase/serverless";
import { XMLParser } from "fast-xml-parser";

const BGG_TABLE = "my9_bgg_boardgame_v1";
const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";
const BGG_APP_TOKEN = process.env.BGG_APP_TOKEN ?? "";
const RATE_LIMIT_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "_text",
});

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buildDatabaseUrlFromNeonParts() {
  const host = readEnv("NEON_DATABASE_PGHOST_UNPOOLED", "NEON_DATABASE_PGHOST");
  const user = readEnv("NEON_DATABASE_PGUSER");
  const password = readEnv("NEON_DATABASE_PGPASSWORD", "NEON_DATABASE_POSTGRES_PASSWORD");
  const database = readEnv("NEON_DATABASE_PGDATABASE", "NEON_DATABASE_POSTGRES_DATABASE");
  if (!host || !user || !password || !database) return null;

  let hostWithPort = host;
  const port = readEnv("NEON_DATABASE_PGPORT");
  if (port && !host.includes(":")) {
    hostWithPort = `${host}:${port}`;
  }

  const sslMode = readEnv("NEON_DATABASE_PGSSLMODE") ?? "require";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password
  )}@${hostWithPort}/${encodeURIComponent(database)}?sslmode=${encodeURIComponent(sslMode)}`;
}

function parseIntArg(name, fallback) {
  const prefix = `--${name}=`;
  const withEquals = process.argv.find((arg) => arg.startsWith(prefix));
  if (withEquals) {
    const parsed = Number(withEquals.slice(prefix.length));
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function hasBoolArg(name) {
  return process.argv.includes(`--${name}`);
}

function stripHtml(text) {
  if (typeof text !== "string") return "";
  return text.replace(/<[^>]*>/g, "").trim();
}

function parseFloat0(raw) {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseInt0(raw) {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseRankValue(raw) {
  if (!raw || raw === "Not Ranked") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const RANK_NAME_TO_COLUMN = {
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

function extractRanks(ratings) {
  const ranks = {};
  const rankItems = toArray(ratings?.ranks?.rank);
  for (const item of rankItems) {
    const name = item.name;
    if (name && RANK_NAME_TO_COLUMN[name]) {
      ranks[RANK_NAME_TO_COLUMN[name]] = parseRankValue(item.value);
    }
  }
  return ranks;
}

function extractItemData(item) {
  const id = item.id;
  if (!id) return null;

  const image = item.image || null;
  const thumbnail = item.thumbnail || null;

  const names = toArray(item.name);
  const primaryName = names.find((n) => n.type === "primary")?.value || null;
  const localizedNames = names
    .filter((n) => n.type === "alternate" && n.value)
    .map((n) => n.value)
    .filter(Boolean);

  const rawDescription = typeof item.description === "string" ? item.description : "";
  const description = stripHtml(rawDescription).slice(0, 500) || null;

  const links = toArray(item.link);
  const genres = links
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
    localizedNames: localizedNames.length > 0 ? localizedNames : null,
    description,
    genres: genres.length > 0 ? genres : null,
    bayesAverage,
    average,
    usersRated,
    ...ranks,
  };
}

async function fetchBggThingBatch(ids, retried = false) {
  const url = `${BGG_API_BASE}/thing?id=${ids.join(",")}&type=boardgame&stats=1`;
  const headers = { Accept: "text/xml" };
  if (BGG_APP_TOKEN) {
    headers["Authorization"] = `Bearer ${BGG_APP_TOKEN}`;
  }
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 429) {
    if (retried) {
      throw new Error("BGG API returned 429 after retry");
    }
    console.log(`  Rate limited (429), waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
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

async function main() {
  const batchSize = parseIntArg("batch-size", 20);
  const limit = parseIntArg("limit", 500);
  const dryRun = hasBoolArg("dry-run");

  const databaseUrl = buildDatabaseUrlFromNeonParts();
  if (!databaseUrl) {
    console.error("Database connection env vars not configured (NEON_DATABASE_*)");
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log(`Enrich BGG details`);
  console.log(`  batch-size: ${batchSize}`);
  console.log(`  limit:      ${limit}`);
  console.log(`  dry-run:    ${dryRun}`);
  console.log();

  const rows = await sql.query(
    `SELECT bgg_id FROM ${BGG_TABLE}
     WHERE cover IS NULL AND api_enriched_at IS NULL
     ORDER BY bayes_average DESC, users_rated DESC
     LIMIT $1`,
    [limit]
  );

  if (rows.length === 0) {
    console.log("No rows to enrich.");
    return;
  }

  console.log(`Found ${rows.length} rows to enrich.\n`);

  const startTime = Date.now();
  let totalFetched = 0;
  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  const allIds = rows.map((r) => r.bgg_id);
  const batches = [];
  for (let i = 0; i < allIds.length; i += batchSize) {
    batches.push(allIds.slice(i, i + batchSize));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batchIds = batches[batchIdx];
    const batchNum = batchIdx + 1;

    let items;
    try {
      items = await fetchBggThingBatch(batchIds);
      totalFetched += batchIds.length;
    } catch (err) {
      console.error(`  Batch ${batchNum}/${batches.length} fetch failed: ${err.message}`);
      failed += batchIds.length;
      if (batchIdx < batches.length - 1) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }
      continue;
    }

    const itemMap = new Map();
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

      if (dryRun) {
        console.log(`  [DRY-RUN] Would update ${bggId}: cover=${data.cover ? "yes" : "no"}, localized=${data.localizedNames ? data.localizedNames.length + " names" : "none"}, genres=${data.genres ? data.genres.length : 0}`);
        enriched++;
        continue;
      }

      try {
        const now = Date.now();
        await sql.query(
          `UPDATE ${BGG_TABLE} SET
            cover = $1,
            thumbnail = $2,
            localized_names = COALESCE($3, ${BGG_TABLE}.localized_names),
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
            data.localizedNames ? JSON.stringify(data.localizedNames) : null,
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
      } catch (err) {
        console.error(`  Failed to update ${bggId}: ${err.message}`);
        failed++;
      }
    }

    console.log(`  Batch ${batchNum}/${batches.length}: fetched=${batchIds.length}, enriched=${enriched}, failed=${failed}, skipped=${skipped}`);

    if (batchIdx < batches.length - 1) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=== Enrich Summary ===");
  console.log(`  Total fetched: ${totalFetched}`);
  console.log(`  Enriched:      ${enriched}`);
  console.log(`  Failed:        ${failed}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  Time elapsed:  ${elapsed}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
