#!/usr/bin/env node

import { neon } from "@neondatabase/serverless";
import { resolve } from "node:path";

function loadLocalEnvFiles() {
  const candidates = [".env.local", ".env"];
  for (const file of candidates) {
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

async function queryCount(sql, tableName) {
  const rows = await sql.query(`SELECT COUNT(*)::BIGINT AS count FROM ${tableName}`);
  return Number(rows[0]?.count || 0);
}

async function main() {
  loadLocalEnvFiles();

  const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrlFromNeonParts();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL / NEON_DATABASE_* is required");
  }

  const sql = neon(databaseUrl);

  const oldCount = await queryCount(sql, "my9_shares_v1");
  const v2Count = await queryCount(sql, "my9_share_registry_v2");
  const aliasCount = await queryCount(sql, "my9_share_alias_v1");

  const missingRows = await sql.query(`
    SELECT COUNT(*)::BIGINT AS missing
    FROM my9_shares_v1 v1
    LEFT JOIN my9_share_registry_v2 v2 ON v2.share_id = v1.share_id
    LEFT JOIN my9_share_alias_v1 a ON a.share_id = v1.share_id
    WHERE v2.share_id IS NULL AND a.share_id IS NULL
  `);
  const missingCount = Number(missingRows[0]?.missing || 0);

  const orphanAliasRows = await sql.query(`
    SELECT COUNT(*)::BIGINT AS orphan_alias
    FROM my9_share_alias_v1 a
    LEFT JOIN my9_share_registry_v2 v2 ON v2.share_id = a.target_share_id
    WHERE v2.share_id IS NULL
  `);
  const orphanAliasCount = Number(orphanAliasRows[0]?.orphan_alias || 0);

  console.log(
    JSON.stringify(
      {
        ok: missingCount === 0 && orphanAliasCount === 0,
        old_count: oldCount,
        v2_count: v2Count,
        alias_count: aliasCount,
        covered_count: v2Count + aliasCount,
        missing_count: missingCount,
        orphan_alias_count: orphanAliasCount,
      },
      null,
      2
    )
  );

  if (missingCount > 0) {
    const sampleMissing = await sql.query(`
      SELECT v1.share_id
      FROM my9_shares_v1 v1
      LEFT JOIN my9_share_registry_v2 v2 ON v2.share_id = v1.share_id
      LEFT JOIN my9_share_alias_v1 a ON a.share_id = v1.share_id
      WHERE v2.share_id IS NULL AND a.share_id IS NULL
      ORDER BY v1.created_at ASC
      LIMIT 20
    `);
    console.log("missing_samples:", sampleMissing.map((row) => row.share_id));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
