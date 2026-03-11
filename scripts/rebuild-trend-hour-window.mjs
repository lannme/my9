#!/usr/bin/env node

import { neon } from "@neondatabase/serverless";
import { resolve } from "node:path";

const SHARES_V2_TABLE = "my9_share_registry_v2";
const TREND_COUNT_HOUR_TABLE = "my9_trend_subject_hour_v1";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

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

function parseArg(name, fallback) {
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

function getBeijingDayStart(timestampMs) {
  return Math.floor((timestampMs + BEIJING_TZ_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_TZ_OFFSET_MS;
}

function toBeijingHourBucket(timestampMs) {
  return Math.floor((timestampMs + BEIJING_TZ_OFFSET_MS) / HOUR_MS);
}

async function ensureHourTable(sql) {
  await sql.query(
    `
    CREATE TABLE IF NOT EXISTS ${TREND_COUNT_HOUR_TABLE} (
      hour_bucket BIGINT NOT NULL,
      subject_id TEXT NOT NULL,
      count BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (hour_bucket, subject_id)
    )
    `
  );
}

async function main() {
  loadLocalEnvFiles();

  const nowMs = parseArg("now-ms", Date.now());
  const windowStartMs = getBeijingDayStart(nowMs) - DAY_MS;
  const fromHourBucket = toBeijingHourBucket(windowStartMs);
  const toHourBucket = toBeijingHourBucket(nowMs);

  const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrlFromNeonParts();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL / NEON_DATABASE_* is required");
  }

  const sql = neon(databaseUrl);
  await ensureHourTable(sql);

  const deletedRows = await sql.query(
    `
    DELETE FROM ${TREND_COUNT_HOUR_TABLE}
    WHERE hour_bucket >= $1
      AND hour_bucket <= $2
    RETURNING 1
    `,
    [fromHourBucket, toHourBucket]
  );

  const upsertedRows = await sql.query(
    `
    WITH share_slots AS (
      SELECT
        FLOOR((s.created_at + ${BEIJING_TZ_OFFSET_MS}) / ${HOUR_MS})::BIGINT AS hour_bucket,
        NULLIF(BTRIM(slot.value->>'sid'), '') AS subject_id
      FROM ${SHARES_V2_TABLE} s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN s.hot_payload IS NULL THEN '[]'::jsonb
          WHEN jsonb_typeof(s.hot_payload) = 'array' THEN s.hot_payload
          ELSE '[]'::jsonb
        END
      ) AS slot(value)
      WHERE s.created_at >= $1
        AND s.created_at <= $2
    ),
    folded AS (
      SELECT
        hour_bucket,
        subject_id,
        COUNT(*)::BIGINT AS count
      FROM share_slots
      WHERE subject_id IS NOT NULL
      GROUP BY hour_bucket, subject_id
    )
    INSERT INTO ${TREND_COUNT_HOUR_TABLE} (hour_bucket, subject_id, count, updated_at)
    SELECT
      hour_bucket,
      subject_id,
      count,
      $3::BIGINT AS updated_at
    FROM folded
    ON CONFLICT (hour_bucket, subject_id) DO UPDATE SET
      count = EXCLUDED.count,
      updated_at = EXCLUDED.updated_at
    RETURNING 1
    `,
    [windowStartMs, nowMs, nowMs]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        windowStartMs,
        nowMs,
        fromHourBucket,
        toHourBucket,
        deletedRows: deletedRows.length,
        upsertedRows: upsertedRows.length,
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
