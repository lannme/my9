#!/usr/bin/env node

import { existsSync } from "fs";
try {
  const dotenv = await import("dotenv");
  if (existsSync(".env.local")) dotenv.default.config({ path: ".env.local" });
  else dotenv.default.config();
} catch { }

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

  const mechanics = links
    .filter((l) => l.type === "boardgamemechanic")
    .map((l) => l.value)
    .filter(Boolean);

  const designers = links
    .filter((l) => l.type === "boardgamedesigner")
    .map((l) => l.value)
    .filter(Boolean);

  const artists = links
    .filter((l) => l.type === "boardgameartist")
    .map((l) => l.value)
    .filter(Boolean);

  const publishers = links
    .filter((l) => l.type === "boardgamepublisher")
    .map((l) => l.value)
    .filter(Boolean);

  const families = links
    .filter((l) => l.type === "boardgamefamily")
    .map((l) => l.value)
    .filter(Boolean);

  const ratings = item.statistics?.ratings;
  const bayesAverage = parseFloat0(ratings?.bayesaverage?.value);
  const average = parseFloat0(ratings?.average?.value);
  const usersRated = parseInt0(ratings?.usersrated?.value);
  const numComments = parseInt0(ratings?.numcomments?.value);
  const averageWeight = parseFloat0(ratings?.averageweight?.value);
  const numWeights = parseInt0(ratings?.numweights?.value);
  const stddev = parseFloat0(ratings?.stddev?.value);
  const median = parseFloat0(ratings?.median?.value);
  const owned = parseInt0(ratings?.owned?.value);
  const wanting = parseInt0(ratings?.wanting?.value);
  const wishing = parseInt0(ratings?.wishing?.value);
  const trading = parseInt0(ratings?.trading?.value);

  const minPlayers = parseInt0(item.minplayers?.value) || null;
  const maxPlayers = parseInt0(item.maxplayers?.value) || null;
  const playingTime = parseInt0(item.playingtime?.value) || null;
  const minPlaytime = parseInt0(item.minplaytime?.value) || null;
  const maxPlaytime = parseInt0(item.maxplaytime?.value) || null;
  const minAge = parseInt0(item.minage?.value) || null;

  const polls = toArray(item.poll);

  let suggestedNumplayers = null;
  const npPoll = polls.find((p) => p.name === "suggested_numplayers");
  if (npPoll) {
    const entries = [];
    for (const r of toArray(npPoll.results)) {
      if (!r.numplayers) continue;
      const votes = {};
      for (const v of toArray(r.result)) {
        if (v.value && v.numvotes) votes[v.value] = parseInt0(v.numvotes);
      }
      entries.push({ numplayers: r.numplayers, ...votes });
    }
    if (entries.length > 0) suggestedNumplayers = entries;
  }

  let suggestedPlayerage = null;
  const agePoll = polls.find((p) => p.name === "suggested_playerage");
  if (agePoll) {
    let maxVotes = 0;
    for (const r of toArray(agePoll.results)) {
      for (const v of toArray(r.result)) {
        const nv = parseInt0(v.numvotes);
        if (nv > maxVotes) {
          maxVotes = nv;
          suggestedPlayerage = v.value || null;
        }
      }
    }
  }

  let languageDependence = null;
  const langPoll = polls.find((p) => p.name === "language_dependence");
  if (langPoll) {
    let maxVotes = 0;
    for (const r of toArray(langPoll.results)) {
      for (const v of toArray(r.result)) {
        const nv = parseInt0(v.numvotes);
        if (nv > maxVotes) {
          maxVotes = nv;
          languageDependence = v.value || null;
        }
      }
    }
  }

  const ranks = extractRanks(ratings);

  return {
    id: String(id),
    cover: image,
    thumbnail,
    primaryName,
    localizedNames: localizedNames.length > 0 ? localizedNames : null,
    description,
    genres: genres.length > 0 ? genres : null,
    mechanics: mechanics.length > 0 ? mechanics : null,
    designers: designers.length > 0 ? designers : null,
    artists: artists.length > 0 ? artists : null,
    publishers: publishers.length > 0 ? publishers : null,
    families: families.length > 0 ? families : null,
    bayesAverage,
    average,
    usersRated,
    numComments,
    averageWeight,
    numWeights,
    stddev,
    median,
    owned,
    wanting,
    wishing,
    trading,
    minPlayers,
    maxPlayers,
    playingTime,
    minPlaytime,
    maxPlaytime,
    minAge,
    suggestedNumplayers,
    suggestedPlayerage,
    languageDependence,
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
  const reEnrich = hasBoolArg("re-enrich");

  const databaseUrl = buildDatabaseUrlFromNeonParts();
  if (!databaseUrl) {
    console.error("Database connection env vars not configured (NEON_DATABASE_*)");
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log(`Enrich BGG details`);
  console.log(`  batch-size:  ${batchSize}`);
  console.log(`  limit:       ${limit}`);
  console.log(`  dry-run:     ${dryRun}`);
  console.log(`  re-enrich:   ${reEnrich}`);
  console.log();

  let rows;
  if (reEnrich) {
    const alterCols = [
      "mechanics JSONB", "families JSONB", "designers JSONB", "artists JSONB",
      "publishers JSONB", "num_comments INT", "average_weight REAL",
      "min_players INT", "max_players INT", "playing_time INT",
      "min_playtime INT", "max_playtime INT", "min_age INT",
      "owned INT", "wanting INT", "wishing INT", "trading INT",
      "stddev REAL", "median REAL", "num_weights INT",
      "suggested_numplayers JSONB", "suggested_playerage TEXT", "language_dependence TEXT",
    ];
    for (const col of alterCols) {
      await sql.query(`ALTER TABLE ${BGG_TABLE} ADD COLUMN IF NOT EXISTS ${col}`);
    }
    console.log("Schema updated: new columns ensured.\n");

    rows = await sql.query(
      `SELECT bgg_id FROM ${BGG_TABLE}
       WHERE average_weight IS NULL
          OR min_players IS NULL
          OR playing_time IS NULL
          OR suggested_numplayers IS NULL
          OR language_dependence IS NULL
          OR num_weights IS NULL
          OR owned IS NULL
       ORDER BY bayes_average DESC, users_rated DESC
       LIMIT $1`,
      [limit]
    );
  } else {
    rows = await sql.query(
      `SELECT bgg_id FROM ${BGG_TABLE}
       WHERE cover IS NULL AND api_enriched_at IS NULL
       ORDER BY bayes_average DESC, users_rated DESC
       LIMIT $1`,
      [limit]
    );
  }

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
        console.log(`  [DRY-RUN] Would update ${bggId}: cover=${data.cover ? "yes" : "no"}, localized=${data.localizedNames ? data.localizedNames.length + " names" : "none"}, genres=${data.genres ? data.genres.length : 0}, mechanics=${data.mechanics ? data.mechanics.length : 0}, weight=${data.averageWeight}`);
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
            mechanics = $18,
            designers = $19,
            artists = $20,
            publishers = $21,
            families = $22,
            num_comments = $23,
            average_weight = $24,
            num_weights = $25,
            stddev = $26,
            median = $27,
            owned = $28,
            wanting = $29,
            wishing = $30,
            trading = $31,
            min_players = $32,
            max_players = $33,
            playing_time = $34,
            min_playtime = $35,
            max_playtime = $36,
            min_age = $37,
            suggested_numplayers = $38,
            suggested_playerage = $39,
            language_dependence = $40,
            api_enriched_at = $41,
            updated_at = $42
          WHERE bgg_id = $43`,
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
            data.mechanics ? JSON.stringify(data.mechanics) : null,
            data.designers ? JSON.stringify(data.designers) : null,
            data.artists ? JSON.stringify(data.artists) : null,
            data.publishers ? JSON.stringify(data.publishers) : null,
            data.families ? JSON.stringify(data.families) : null,
            data.numComments,
            data.averageWeight,
            data.numWeights,
            data.stddev,
            data.median,
            data.owned,
            data.wanting,
            data.wishing,
            data.trading,
            data.minPlayers,
            data.maxPlayers,
            data.playingTime,
            data.minPlaytime,
            data.maxPlaytime,
            data.minAge,
            data.suggestedNumplayers ? JSON.stringify(data.suggestedNumplayers) : null,
            data.suggestedPlayerage,
            data.languageDependence,
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
