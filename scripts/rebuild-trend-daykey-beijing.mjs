#!/usr/bin/env node

import { neon } from "@neondatabase/serverless";
import { resolve } from "node:path";

const SHARES_V2_TABLE = "my9_share_registry_v2";
const TREND_COUNT_ALL_TABLE = "my9_trend_subject_all_v2";
const TREND_COUNT_DAY_TABLE = "my9_trend_subject_day_v2";
const TRENDS_CACHE_TABLE = "my9_trends_cache_v1";

function loadLocalEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(resolve(process.cwd(), file));
    } catch {
      // ignore missing env file
    }
  }
}

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildDatabaseUrlFromNeonParts() {
  const host = readEnv("NEON_DATABASE_PGHOST_UNPOOLED", "NEON_DATABASE_PGHOST");
  const user = readEnv("NEON_DATABASE_PGUSER");
  const password = readEnv("NEON_DATABASE_PGPASSWORD", "NEON_DATABASE_POSTGRES_PASSWORD");
  const database = readEnv("NEON_DATABASE_PGDATABASE", "NEON_DATABASE_POSTGRES_DATABASE");
  if (!host || !user || !password || !database) {
    return null;
  }

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

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  loadLocalEnvFiles();

  const force = hasArg("force");
  const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrlFromNeonParts();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL / NEON_DATABASE_* is required");
  }

  const sql = neon(databaseUrl);
  const now = Date.now();

  const coldRows = await sql.query(
    `
    SELECT COUNT(*)::BIGINT AS total
    FROM ${SHARES_V2_TABLE}
    WHERE storage_tier = 'cold'
       OR hot_payload IS NULL
    `
  );
  const coldCount = Number(coldRows[0]?.total || 0);
  if (coldCount > 0 && !force) {
    throw new Error(
      `found ${coldCount} cold/null-payload rows. Rebuild would lose those counts. ` +
        "Run with --force only if you intentionally accept this."
    );
  }

  await sql.query("BEGIN");
  try {
    await sql.query(`TRUNCATE TABLE ${TREND_COUNT_ALL_TABLE}`);
    await sql.query(`TRUNCATE TABLE ${TREND_COUNT_DAY_TABLE}`);
    await sql.query(`TRUNCATE TABLE ${TRENDS_CACHE_TABLE}`);

    await sql.query(
      `
      WITH share_slots AS (
        SELECT
          BTRIM(slot->>'sid') AS subject_id
        FROM ${SHARES_V2_TABLE} s
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN s.hot_payload IS NULL THEN '[]'::jsonb
            WHEN jsonb_typeof(s.hot_payload) = 'array' THEN s.hot_payload
            ELSE '[]'::jsonb
          END
        ) AS slot
      )
      INSERT INTO ${TREND_COUNT_ALL_TABLE} (subject_id, count, updated_at)
      SELECT
        subject_id,
        COUNT(*)::BIGINT AS count,
        $1::BIGINT AS updated_at
      FROM share_slots
      WHERE subject_id <> ''
      GROUP BY subject_id
      `,
      [now]
    );

    await sql.query(
      `
      WITH share_slots AS (
        SELECT
          TO_CHAR(
            timezone('Asia/Shanghai', to_timestamp(s.created_at / 1000.0)),
            'YYYYMMDD'
          )::INT AS day_key,
          BTRIM(slot->>'sid') AS subject_id
        FROM ${SHARES_V2_TABLE} s
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN s.hot_payload IS NULL THEN '[]'::jsonb
            WHEN jsonb_typeof(s.hot_payload) = 'array' THEN s.hot_payload
            ELSE '[]'::jsonb
          END
        ) AS slot
      )
      INSERT INTO ${TREND_COUNT_DAY_TABLE} (day_key, subject_id, count, updated_at)
      SELECT
        day_key,
        subject_id,
        COUNT(*)::BIGINT AS count,
        $1::BIGINT AS updated_at
      FROM share_slots
      WHERE subject_id <> ''
      GROUP BY day_key, subject_id
      `,
      [now]
    );

    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }

  const allRows = await sql.query(`SELECT COUNT(*)::BIGINT AS total FROM ${TREND_COUNT_ALL_TABLE}`);
  const dayRows = await sql.query(`SELECT COUNT(*)::BIGINT AS total FROM ${TREND_COUNT_DAY_TABLE}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        force,
        coldCount,
        allRows: Number(allRows[0]?.total || 0),
        dayRows: Number(dayRows[0]?.total || 0),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
