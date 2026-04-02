#!/usr/bin/env node

try { await import("dotenv/config"); } catch {}

import { neon } from "@neondatabase/serverless";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const BGG_TABLE = "my9_bgg_boardgame_v1";

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

function parseStringArg(name) {
  const prefix = `--${name}=`;
  const withEquals = process.argv.find((arg) => arg.startsWith(prefix));
  if (withEquals) return withEquals.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function parseIntArg(name, fallback) {
  const raw = parseStringArg(name);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseIntField(raw) {
  if (!raw || raw === "0" || raw.toLowerCase() === "not ranked") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseRealField(raw) {
  if (!raw) return 0;
  let n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) n = 0;
  if (n > 10) n = 10;
  return n;
}

function parseIntFieldDefault(raw, def) {
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseBoolField(raw) {
  return raw === "1";
}

function parseYearField(raw) {
  if (!raw || raw === "0") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseRankField(raw) {
  return parseIntField(raw);
}

function buildBatchUpsertQuery(rows) {
  const nowMs = Date.now();
  const valueClauses = [];
  const params = [];
  const COLS_PER_ROW = 18;
  let idx = 1;

  for (const row of rows) {
    const placeholders = [];
    for (let i = 0; i < COLS_PER_ROW; i++) {
      placeholders.push(`$${idx + i}`);
    }
    valueClauses.push(`(${placeholders.join(", ")})`);
    params.push(
      row.bgg_id,
      row.name,
      row.year_published,
      row.bgg_rank,
      row.bayes_average,
      row.average,
      row.users_rated,
      row.is_expansion,
      row.abstracts_rank,
      row.cgs_rank,
      row.childrensgames_rank,
      row.familygames_rank,
      row.partygames_rank,
      row.strategygames_rank,
      row.thematic_rank,
      row.wargames_rank,
      nowMs,
      nowMs
    );
    idx += COLS_PER_ROW;
  }

  const query = `
    INSERT INTO ${BGG_TABLE} (
      bgg_id, name, year_published, bgg_rank,
      bayes_average, average, users_rated, is_expansion,
      abstracts_rank, cgs_rank, childrensgames_rank, familygames_rank,
      partygames_rank, strategygames_rank, thematic_rank, wargames_rank,
      csv_imported_at, updated_at
    )
    VALUES ${valueClauses.join(",\n")}
    ON CONFLICT (bgg_id) DO UPDATE SET
      name = EXCLUDED.name,
      year_published = EXCLUDED.year_published,
      bgg_rank = EXCLUDED.bgg_rank,
      bayes_average = EXCLUDED.bayes_average,
      average = EXCLUDED.average,
      users_rated = EXCLUDED.users_rated,
      is_expansion = EXCLUDED.is_expansion,
      abstracts_rank = EXCLUDED.abstracts_rank,
      cgs_rank = EXCLUDED.cgs_rank,
      childrensgames_rank = EXCLUDED.childrensgames_rank,
      familygames_rank = EXCLUDED.familygames_rank,
      partygames_rank = EXCLUDED.partygames_rank,
      strategygames_rank = EXCLUDED.strategygames_rank,
      thematic_rank = EXCLUDED.thematic_rank,
      wargames_rank = EXCLUDED.wargames_rank,
      csv_imported_at = EXCLUDED.csv_imported_at,
      updated_at = EXCLUDED.updated_at
  `;

  return { query, params };
}

async function main() {
  const filePath = parseStringArg("file");
  const batchSize = parseIntArg("batch-size", 500);

  if (!filePath) {
    console.error("Usage: node scripts/import-bgg-csv.mjs --file <path> [--batch-size 500]");
    process.exit(1);
  }

  const databaseUrl = buildDatabaseUrlFromNeonParts();
  if (!databaseUrl) {
    console.error("Database connection env vars not configured (NEON_DATABASE_*)");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const absolutePath = resolve(process.cwd(), filePath);

  console.log(`Importing BGG CSV: ${absolutePath}`);
  console.log(`Batch size: ${batchSize}`);

  const startTime = Date.now();
  let headerMap = null;
  let batch = [];
  let totalRows = 0;
  let skippedRows = 0;
  let batchCount = 0;
  let upsertedRows = 0;

  const rl = createInterface({
    input: createReadStream(absolutePath, "utf8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!headerMap) {
      const headers = parseCsvLine(line).map((h) => h.trim().toLowerCase());
      headerMap = {};
      for (let i = 0; i < headers.length; i++) {
        headerMap[headers[i]] = i;
      }
      continue;
    }

    const fields = parseCsvLine(line);
    const get = (col) => {
      const idx = headerMap[col];
      return idx != null ? (fields[idx] ?? "").trim() : "";
    };

    const bggId = get("id");
    const name = get("name");

    if (!name || !/^\d+$/.test(bggId)) {
      skippedRows++;
      continue;
    }

    batch.push({
      bgg_id: bggId,
      name,
      year_published: parseYearField(get("yearpublished")),
      bgg_rank: parseRankField(get("rank")),
      bayes_average: parseRealField(get("bayesaverage")),
      average: parseRealField(get("average")),
      users_rated: parseIntFieldDefault(get("usersrated"), 0),
      is_expansion: parseBoolField(get("is_expansion")),
      abstracts_rank: parseRankField(get("abstracts_rank")),
      cgs_rank: parseRankField(get("cgs_rank")),
      childrensgames_rank: parseRankField(get("childrensgames_rank")),
      familygames_rank: parseRankField(get("familygames_rank")),
      partygames_rank: parseRankField(get("partygames_rank")),
      strategygames_rank: parseRankField(get("strategygames_rank")),
      thematic_rank: parseRankField(get("thematic_rank")),
      wargames_rank: parseRankField(get("wargames_rank")),
    });

    if (batch.length >= batchSize) {
      const { query, params } = buildBatchUpsertQuery(batch);
      await sql.query(query, params);
      upsertedRows += batch.length;
      batchCount++;
      totalRows += batch.length;
      if (batchCount % 50 === 0) {
        console.log(`  progress: ${totalRows} rows processed (${batchCount} batches, ${skippedRows} skipped)`);
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    const { query, params } = buildBatchUpsertQuery(batch);
    await sql.query(query, params);
    upsertedRows += batch.length;
    batchCount++;
    totalRows += batch.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=== Import Summary ===");
  console.log(`  Total rows:    ${totalRows}`);
  console.log(`  Upserted:      ${upsertedRows}`);
  console.log(`  Skipped:       ${skippedRows}`);
  console.log(`  Batches:       ${batchCount}`);
  console.log(`  Time elapsed:  ${elapsed}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
