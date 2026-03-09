import { neon } from "@neondatabase/serverless";
import {
  CompactSharePayload,
  SubjectSnapshot,
  compactPayloadToGames,
  createContentHash,
  normalizeCompactPayload,
  toCompactSharePayload,
} from "@/lib/share/compact";
import { getColdSharePayload, buildColdObjectKey, isColdStorageEnabled, putColdSharePayload } from "@/lib/share/cold-storage";
import {
  ShareSubject,
  StoredShareV1,
  TrendBucket,
  TrendGameItem,
  TrendPeriod,
  TrendResponse,
  TrendView,
} from "@/lib/share/types";
import { DEFAULT_SUBJECT_KIND, SubjectKind, parseSubjectKind } from "@/lib/subject-kind";

const TRENDS_CACHE_PREFIX = "trends:cache:";

const SHARES_V1_TABLE = "my9_shares_v1";
const SHARES_V2_TABLE = "my9_share_registry_v2";
const SHARE_ALIAS_TABLE = "my9_share_alias_v1";
const SUBJECT_DIM_TABLE = "my9_subject_dim_v1";
const TREND_COUNT_ALL_TABLE = "my9_trend_count_all_v1";
const TREND_COUNT_DAY_TABLE = "my9_trend_count_day_v1";
const TRENDS_CACHE_TABLE = "my9_trends_cache_v1";
const SHARES_V2_KIND_CREATED_IDX = `${SHARES_V2_TABLE}_kind_created_idx`;
const SHARES_V2_TIER_CREATED_IDX = `${SHARES_V2_TABLE}_tier_created_idx`;
const SHARE_ALIAS_TARGET_IDX = `${SHARE_ALIAS_TABLE}_target_idx`;
const TREND_ALL_KIND_VIEW_BUCKET_IDX = `${TREND_COUNT_ALL_TABLE}_kind_view_bucket_idx`;
const TREND_DAY_KIND_VIEW_DAY_IDX = `${TREND_COUNT_DAY_TABLE}_kind_view_day_idx`;
const TRENDS_CACHE_EXPIRES_IDX = `${TRENDS_CACHE_TABLE}_expires_idx`;

function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildDatabaseUrlFromNeonParts(): string | null {
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

const DATABASE_URL = buildDatabaseUrlFromNeonParts();
const DATABASE_ENABLED = Boolean(DATABASE_URL);
const MEMORY_FALLBACK_ENABLED =
  readEnv("MY9_ALLOW_MEMORY_FALLBACK") === "1" ||
  (readEnv("MY9_ALLOW_MEMORY_FALLBACK") !== "0" && process.env.NODE_ENV !== "production");
const V1_FALLBACK_ENABLED = readEnv("MY9_ENABLE_V1_FALLBACK") !== "0";

type SqlClient = ReturnType<typeof neon>;

let sqlClient: SqlClient | null = null;
let schemaReadyPromise: Promise<void> | null = null;
let schemaLastError: Error | null = null;

function getSqlClient(): SqlClient | null {
  if (!DATABASE_ENABLED) {
    return null;
  }
  if (!sqlClient) {
    sqlClient = neon(DATABASE_URL!);
  }
  return sqlClient;
}

type MemoryStore = {
  shares: Map<string, StoredShareV1>;
  hashToShareId: Map<string, string>;
  trendCache: Map<string, { value: TrendResponse; expiresAt: number }>;
};

type ShareV1Row = {
  share_id: string;
  kind: string;
  creator_name: string | null;
  games: unknown;
  created_at: number | string;
  updated_at: number | string;
  last_viewed_at: number | string;
};

type ShareRegistryRow = {
  share_id: string;
  kind: string;
  creator_name: string | null;
  storage_tier: "hot" | "cold";
  hot_payload: unknown;
  cold_object_key: string | null;
  created_at: number | string;
  updated_at: number | string;
  last_viewed_at: number | string;
};

type SubjectDimRow = {
  subject_id: string;
  name: string;
  localized_name: string | null;
  cover: string | null;
  release_year: number | null;
  genres: unknown;
};

type TrendCountRow = {
  bucket_key: string;
  subject_id: string;
  count: number | string;
  name: string | null;
  localized_name: string | null;
  cover: string | null;
  release_year: number | null;
};

type TrendSampleRow = {
  sample_count: number | string;
  min_created: number | string | null;
  max_created: number | string | null;
};

type TrendCacheRow = {
  payload: unknown;
  expires_at: number | string;
};

function throwStorageError(context: string, cause?: unknown): never {
  if (cause instanceof Error) {
    throw new Error(`${context}: ${cause.message}`);
  }
  throw new Error(context);
}

function throwDatabaseNotReady(context: string): never {
  if (schemaLastError) {
    throwStorageError(context, schemaLastError);
  }
  throwStorageError(`${context}: database is not ready`);
}

function normalizeStoredShare(input: StoredShareV1): StoredShareV1 {
  return {
    ...input,
    kind: parseSubjectKind(input.kind) ?? DEFAULT_SUBJECT_KIND,
  };
}

function createEmptyGames(): Array<ShareSubject | null> {
  return Array.from({ length: 9 }, () => null);
}

function normalizeGames(value: unknown): Array<ShareSubject | null> {
  if (!Array.isArray(value)) {
    return createEmptyGames();
  }

  const next = createEmptyGames();
  for (let index = 0; index < 9; index += 1) {
    const item = value[index];
    next[index] = item && typeof item === "object" ? (item as ShareSubject) : null;
  }
  return next;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

function rowToStoredShare(row: ShareV1Row): StoredShareV1 {
  return normalizeStoredShare({
    shareId: String(row.share_id),
    kind: (parseSubjectKind(row.kind) ?? DEFAULT_SUBJECT_KIND) as SubjectKind,
    creatorName: typeof row.creator_name === "string" ? row.creator_name : null,
    games: normalizeGames(row.games),
    createdAt: toNumber(row.created_at, Date.now()),
    updatedAt: toNumber(row.updated_at, Date.now()),
    lastViewedAt: toNumber(row.last_viewed_at, Date.now()),
  });
}

function parseTrendPayload(value: unknown): TrendResponse | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<TrendResponse>;
  if (!data.period || !data.view || !data.range || !Array.isArray(data.items)) {
    return null;
  }

  return {
    period: data.period,
    view: data.view,
    sampleCount: typeof data.sampleCount === "number" ? data.sampleCount : 0,
    range: {
      from: typeof data.range.from === "number" ? data.range.from : null,
      to: typeof data.range.to === "number" ? data.range.to : null,
    },
    lastUpdatedAt: typeof data.lastUpdatedAt === "number" ? data.lastUpdatedAt : Date.now(),
    items: data.items,
  };
}

function getMemoryStore(): MemoryStore {
  const g = globalThis as typeof globalThis & {
    __MY9_SHARE_MEMORY__?: MemoryStore;
  };

  if (!g.__MY9_SHARE_MEMORY__) {
    g.__MY9_SHARE_MEMORY__ = {
      shares: new Map<string, StoredShareV1>(),
      hashToShareId: new Map<string, string>(),
      trendCache: new Map<string, { value: TrendResponse; expiresAt: number }>(),
    };
  }
  return g.__MY9_SHARE_MEMORY__;
}

function trendCacheKey(period: TrendPeriod, view: TrendView, kind: SubjectKind) {
  return `${TRENDS_CACHE_PREFIX}${period}:${view}:${kind}`;
}

async function ensureSchema(): Promise<boolean> {
  const sql = getSqlClient();
  if (!sql) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(SHARES_V2_TABLE)} (
          share_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          creator_name TEXT,
          content_hash TEXT NOT NULL UNIQUE,
          storage_tier TEXT NOT NULL DEFAULT 'hot',
          hot_payload JSONB,
          cold_object_key TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          last_viewed_at BIGINT NOT NULL,
          CHECK (storage_tier IN ('hot', 'cold'))
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(SHARES_V2_KIND_CREATED_IDX)}
        ON ${sql.unsafe(SHARES_V2_TABLE)} (kind, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(SHARES_V2_TIER_CREATED_IDX)}
        ON ${sql.unsafe(SHARES_V2_TABLE)} (storage_tier, created_at)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(SHARE_ALIAS_TABLE)} (
          share_id TEXT PRIMARY KEY,
          target_share_id TEXT NOT NULL REFERENCES ${sql.unsafe(SHARES_V2_TABLE)}(share_id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(SHARE_ALIAS_TARGET_IDX)}
        ON ${sql.unsafe(SHARE_ALIAS_TABLE)} (target_share_id)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(SUBJECT_DIM_TABLE)} (
          kind TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          name TEXT NOT NULL,
          localized_name TEXT,
          cover TEXT,
          release_year INT,
          genres JSONB,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (kind, subject_id)
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(TREND_COUNT_ALL_TABLE)} (
          kind TEXT NOT NULL,
          view TEXT NOT NULL,
          bucket_key TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          count BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (kind, view, bucket_key, subject_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(TREND_ALL_KIND_VIEW_BUCKET_IDX)}
        ON ${sql.unsafe(TREND_COUNT_ALL_TABLE)} (kind, view, bucket_key)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(TREND_COUNT_DAY_TABLE)} (
          kind TEXT NOT NULL,
          day_key INT NOT NULL,
          view TEXT NOT NULL,
          bucket_key TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          count BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (kind, day_key, view, bucket_key, subject_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(TREND_DAY_KIND_VIEW_DAY_IDX)}
        ON ${sql.unsafe(TREND_COUNT_DAY_TABLE)} (kind, view, day_key)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(TRENDS_CACHE_TABLE)} (
          cache_key TEXT PRIMARY KEY,
          period TEXT NOT NULL,
          view TEXT NOT NULL,
          kind TEXT NOT NULL,
          payload JSONB NOT NULL,
          expires_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(TRENDS_CACHE_EXPIRES_IDX)}
        ON ${sql.unsafe(TRENDS_CACHE_TABLE)} (expires_at)
      `;
    })();
  }

  try {
    await schemaReadyPromise;
    schemaLastError = null;
    return true;
  } catch (error) {
    schemaReadyPromise = null;
    schemaLastError =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : "schema init failed");
    return false;
  }
}

function getMemoryTrendCache(key: string): TrendResponse | null {
  const item = getMemoryStore().trendCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    getMemoryStore().trendCache.delete(key);
    return null;
  }
  return item.value;
}

function toUtcDayKey(timestampMs: number): number {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return Number(`${year}${month}${day}`);
}

function toSubjectSnapshot(row: SubjectDimRow): SubjectSnapshot {
  const genres = Array.isArray(row.genres)
    ? row.genres
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => Boolean(item))
    : undefined;

  return {
    subjectId: row.subject_id,
    name: row.name,
    localizedName: row.localized_name || undefined,
    cover: row.cover,
    releaseYear:
      typeof row.release_year === "number" && Number.isFinite(row.release_year)
        ? Math.trunc(row.release_year)
        : undefined,
    genres: genres && genres.length > 0 ? genres : undefined,
  };
}

async function fetchSubjectSnapshots(
  sql: SqlClient,
  kind: SubjectKind,
  subjectIds: string[]
): Promise<Map<string, SubjectSnapshot>> {
  const map = new Map<string, SubjectSnapshot>();
  if (subjectIds.length === 0) {
    return map;
  }

  const rows = (await sql.query(
    `
      SELECT subject_id, name, localized_name, cover, release_year, genres
      FROM ${SUBJECT_DIM_TABLE}
      WHERE kind = $1
        AND subject_id = ANY($2)
    `,
    [kind, subjectIds]
  )) as SubjectDimRow[];

  for (const row of rows) {
    map.set(row.subject_id, toSubjectSnapshot(row));
  }
  return map;
}

function collectSubjectIdsFromPayload(payload: CompactSharePayload): string[] {
  const unique = new Set<string>();
  for (const slot of payload) {
    if (!slot) continue;
    unique.add(slot.sid);
  }
  return Array.from(unique);
}

async function resolveCompactPayload(row: ShareRegistryRow): Promise<CompactSharePayload | null> {
  const hotPayload = normalizeCompactPayload(row.hot_payload);
  if (hotPayload) {
    return hotPayload;
  }

  if (row.storage_tier === "cold" && row.cold_object_key) {
    return getColdSharePayload(row.cold_object_key);
  }

  return null;
}

async function inflateShareFromRegistryRow(
  sql: SqlClient,
  row: ShareRegistryRow
): Promise<StoredShareV1 | null> {
  const kind = (parseSubjectKind(row.kind) ?? DEFAULT_SUBJECT_KIND) as SubjectKind;
  const payload = await resolveCompactPayload(row);
  if (!payload) {
    return null;
  }

  const subjectIds = collectSubjectIdsFromPayload(payload);
  const subjectSnapshots = await fetchSubjectSnapshots(sql, kind, subjectIds);
  const games = compactPayloadToGames({
    payload,
    subjectSnapshots,
  });

  return normalizeStoredShare({
    shareId: String(row.share_id),
    kind,
    creatorName: typeof row.creator_name === "string" ? row.creator_name : null,
    games,
    createdAt: toNumber(row.created_at, Date.now()),
    updatedAt: toNumber(row.updated_at, Date.now()),
    lastViewedAt: toNumber(row.last_viewed_at, Date.now()),
  });
}

async function tryGetShareFromV1(sql: SqlClient, shareId: string): Promise<StoredShareV1 | null> {
  if (!V1_FALLBACK_ENABLED) {
    return null;
  }

  try {
    const rows = (await sql.query(
      `
      SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
      FROM ${SHARES_V1_TABLE}
      WHERE share_id = $1
      LIMIT 1
      `,
      [shareId]
    )) as ShareV1Row[];

    if (rows.length === 0) {
      return null;
    }
    return rowToStoredShare(rows[0]);
  } catch {
    return null;
  }
}

async function tryListSharesFromV1(sql: SqlClient, from?: number): Promise<StoredShareV1[]> {
  if (!V1_FALLBACK_ENABLED) {
    return [];
  }

  try {
    if (typeof from === "number" && from > 0) {
      const rows = (await sql.query(
        `
        SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
        FROM ${SHARES_V1_TABLE}
        WHERE created_at >= $1
        `,
        [from]
      )) as ShareV1Row[];
      return rows.map((row) => rowToStoredShare(row));
    }

    const rows = (await sql.query(
      `
      SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
      FROM ${SHARES_V1_TABLE}
      `
    )) as ShareV1Row[];
    return rows.map((row) => rowToStoredShare(row));
  } catch {
    return [];
  }
}

type TrendIncrement = {
  dayKey: number;
  view: TrendView;
  bucketKey: string;
  subjectId: string;
  count: number;
};

function buildTrendIncrements(params: {
  payload: CompactSharePayload;
  subjectSnapshots: Map<string, SubjectSnapshot>;
  createdAt: number;
}): TrendIncrement[] {
  const increments: TrendIncrement[] = [];
  const dayKey = toUtcDayKey(params.createdAt);

  for (const slot of params.payload) {
    if (!slot) continue;
    const subjectId = slot.sid;
    const snapshot = params.subjectSnapshots.get(subjectId);

    increments.push({ dayKey, view: "overall", bucketKey: "overall", subjectId, count: 1 });

    const genres = snapshot?.genres && snapshot.genres.length > 0 ? snapshot.genres : ["未分类"];
    for (const genre of genres) {
      increments.push({ dayKey, view: "genre", bucketKey: genre, subjectId, count: 1 });
    }

    if (typeof snapshot?.releaseYear === "number") {
      increments.push({ dayKey, view: "year", bucketKey: String(snapshot.releaseYear), subjectId, count: 1 });
      increments.push({
        dayKey,
        view: "decade",
        bucketKey: `${Math.floor(snapshot.releaseYear / 10) * 10}s`,
        subjectId,
        count: 1,
      });
    }
  }

  return increments;
}

export async function saveShare(record: StoredShareV1): Promise<{ shareId: string; deduped: boolean }> {
  const normalizedRecord = normalizeStoredShare(record);
  const { payload, subjectSnapshots } = toCompactSharePayload(normalizedRecord.games);
  const contentHash = createContentHash({
    kind: normalizedRecord.kind,
    creatorName: normalizedRecord.creatorName,
    payload,
  });

  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("saveShare failed");
    }
    const memory = getMemoryStore();
    const dedupedShareId = memory.hashToShareId.get(contentHash);
    if (dedupedShareId) {
      return {
        shareId: dedupedShareId,
        deduped: true,
      };
    }
    memory.shares.set(normalizedRecord.shareId, normalizedRecord);
    memory.hashToShareId.set(contentHash, normalizedRecord.shareId);
    return {
      shareId: normalizedRecord.shareId,
      deduped: false,
    };
  }

  try {
    const increments = buildTrendIncrements({
      payload,
      subjectSnapshots,
      createdAt: normalizedRecord.createdAt,
    });

    const subjectRowsPayload = Array.from(subjectSnapshots.values()).map((snapshot) => ({
      subject_id: snapshot.subjectId,
      name: snapshot.name,
      localized_name: snapshot.localizedName ?? null,
      cover: snapshot.cover,
      release_year: snapshot.releaseYear ?? null,
      genres: snapshot.genres ?? null,
    }));

    const incrementRowsPayload = increments.map((item) => ({
      day_key: item.dayKey,
      view: item.view,
      bucket_key: item.bucketKey,
      subject_id: item.subjectId,
      count: item.count,
    }));

    const rows = (await sql.query(
      `
      WITH upsert_share AS (
        INSERT INTO ${SHARES_V2_TABLE} (
          share_id, kind, creator_name, content_hash, storage_tier, hot_payload, cold_object_key,
          created_at, updated_at, last_viewed_at
        )
        VALUES ($1, $2, $3, $4, 'hot', $5::jsonb, NULL, $6, $7, $8)
        ON CONFLICT (content_hash) DO UPDATE
        SET
          updated_at = GREATEST(${SHARES_V2_TABLE}.updated_at, EXCLUDED.updated_at),
          last_viewed_at = GREATEST(${SHARES_V2_TABLE}.last_viewed_at, EXCLUDED.last_viewed_at)
        RETURNING share_id, (xmax = 0) AS inserted
      ),
      subject_rows AS (
        SELECT
          $2::text AS kind,
          s.subject_id,
          s.name,
          s.localized_name,
          s.cover,
          s.release_year,
          s.genres,
          $7::bigint AS updated_at
        FROM jsonb_to_recordset(COALESCE($9::jsonb, '[]'::jsonb)) AS s(
          subject_id text,
          name text,
          localized_name text,
          cover text,
          release_year int,
          genres jsonb
        )
        CROSS JOIN upsert_share
        WHERE upsert_share.inserted
      ),
      subject_upsert AS (
        INSERT INTO ${SUBJECT_DIM_TABLE} (
          kind, subject_id, name, localized_name, cover, release_year, genres, updated_at
        )
        SELECT
          kind, subject_id, name, localized_name, cover, release_year, genres, updated_at
        FROM subject_rows
        ON CONFLICT (kind, subject_id) DO UPDATE SET
          name = EXCLUDED.name,
          localized_name = COALESCE(EXCLUDED.localized_name, ${SUBJECT_DIM_TABLE}.localized_name),
          cover = COALESCE(EXCLUDED.cover, ${SUBJECT_DIM_TABLE}.cover),
          release_year = COALESCE(EXCLUDED.release_year, ${SUBJECT_DIM_TABLE}.release_year),
          genres = COALESCE(EXCLUDED.genres, ${SUBJECT_DIM_TABLE}.genres),
          updated_at = EXCLUDED.updated_at
        RETURNING 1
      ),
      increment_rows AS (
        SELECT
          $2::text AS kind,
          i.day_key,
          i.view,
          i.bucket_key,
          i.subject_id,
          i.count,
          $7::bigint AS updated_at
        FROM jsonb_to_recordset(COALESCE($10::jsonb, '[]'::jsonb)) AS i(
          day_key int,
          view text,
          bucket_key text,
          subject_id text,
          count bigint
        )
        CROSS JOIN upsert_share
        WHERE upsert_share.inserted
      ),
      trend_all_upsert AS (
        INSERT INTO ${TREND_COUNT_ALL_TABLE} (kind, view, bucket_key, subject_id, count, updated_at)
        SELECT kind, view, bucket_key, subject_id, count, updated_at
        FROM increment_rows
        ON CONFLICT (kind, view, bucket_key, subject_id) DO UPDATE SET
          count = ${TREND_COUNT_ALL_TABLE}.count + EXCLUDED.count,
          updated_at = EXCLUDED.updated_at
        RETURNING 1
      ),
      trend_day_upsert AS (
        INSERT INTO ${TREND_COUNT_DAY_TABLE} (kind, day_key, view, bucket_key, subject_id, count, updated_at)
        SELECT kind, day_key, view, bucket_key, subject_id, count, updated_at
        FROM increment_rows
        ON CONFLICT (kind, day_key, view, bucket_key, subject_id) DO UPDATE SET
          count = ${TREND_COUNT_DAY_TABLE}.count + EXCLUDED.count,
          updated_at = EXCLUDED.updated_at
        RETURNING 1
      )
      SELECT share_id, inserted
      FROM upsert_share
      `,
      [
        normalizedRecord.shareId,
        normalizedRecord.kind,
        normalizedRecord.creatorName,
        contentHash,
        JSON.stringify(payload),
        normalizedRecord.createdAt,
        normalizedRecord.updatedAt,
        normalizedRecord.lastViewedAt,
        JSON.stringify(subjectRowsPayload),
        JSON.stringify(incrementRowsPayload),
      ]
    )) as Array<{ share_id: string; inserted: boolean }>;

    const storedShareId = rows[0]?.share_id;
    const inserted = Boolean(rows[0]?.inserted);
    if (!storedShareId) {
      throw new Error("saveShare failed: empty upsert result");
    }

    if (!inserted) {
      return {
        shareId: storedShareId,
        deduped: true,
      };
    }

    return {
      shareId: normalizedRecord.shareId,
      deduped: false,
    };
  } catch (error) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwStorageError("saveShare failed: database write error", error);
    }
    const memory = getMemoryStore();
    const dedupedShareId = memory.hashToShareId.get(contentHash);
    if (dedupedShareId) {
      return {
        shareId: dedupedShareId,
        deduped: true,
      };
    }
    memory.shares.set(normalizedRecord.shareId, normalizedRecord);
    memory.hashToShareId.set(contentHash, normalizedRecord.shareId);
    return {
      shareId: normalizedRecord.shareId,
      deduped: false,
    };
  }
}

export async function getShare(shareId: string): Promise<StoredShareV1 | null> {
  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("getShare failed");
    }
  } else {
    try {
      const rows = (await sql.query(
        `
        SELECT share_id, kind, creator_name, storage_tier, hot_payload, cold_object_key, created_at, updated_at, last_viewed_at
        FROM ${SHARES_V2_TABLE}
        WHERE share_id = $1
        LIMIT 1
        `,
        [shareId]
      )) as ShareRegistryRow[];
      if (rows.length > 0) {
        const inflated = await inflateShareFromRegistryRow(sql, rows[0]);
        if (inflated) {
          return inflated;
        }
      }

      const aliasRows = (await sql.query(
        `
        SELECT target_share_id
        FROM ${SHARE_ALIAS_TABLE}
        WHERE share_id = $1
        LIMIT 1
        `,
        [shareId]
      )) as Array<{ target_share_id: string }>;
      const aliasTarget = aliasRows[0]?.target_share_id;

      if (aliasTarget) {
        const targetRows = (await sql.query(
          `
          SELECT share_id, kind, creator_name, storage_tier, hot_payload, cold_object_key, created_at, updated_at, last_viewed_at
          FROM ${SHARES_V2_TABLE}
          WHERE share_id = $1
          LIMIT 1
          `,
          [aliasTarget]
        )) as ShareRegistryRow[];
        if (targetRows.length > 0) {
          const inflated = await inflateShareFromRegistryRow(sql, targetRows[0]);
          if (inflated) {
            return {
              ...inflated,
              shareId,
            };
          }
        }
      }

      const legacyShare = await tryGetShareFromV1(sql, shareId);
      if (legacyShare) {
        return legacyShare;
      }
    } catch (error) {
      if (!MEMORY_FALLBACK_ENABLED) {
        throwStorageError("getShare failed: database read error", error);
      }
    }
  }

  if (!MEMORY_FALLBACK_ENABLED) {
    return null;
  }

  const fromMemory = getMemoryStore().shares.get(shareId);
  return fromMemory ? normalizeStoredShare(fromMemory) : null;
}

export async function touchShare(shareId: string, now = Date.now()): Promise<boolean> {
  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("touchShare failed");
    }
  } else {
    try {
      const rows = (await sql.query(
        `
        WITH resolved AS (
          SELECT COALESCE(
            (SELECT target_share_id FROM ${SHARE_ALIAS_TABLE} WHERE share_id = $1),
            $1
          ) AS resolved_id
        )
        UPDATE ${SHARES_V2_TABLE}
        SET
          updated_at = $2,
          last_viewed_at = $2
        WHERE share_id = (SELECT resolved_id FROM resolved)
        RETURNING share_id
        `,
        [shareId, now]
      )) as Array<{ share_id: string }>;
      if (rows.length > 0) {
        return true;
      }

      if (V1_FALLBACK_ENABLED) {
        const legacyRows = (await sql.query(
          `
          UPDATE ${SHARES_V1_TABLE}
          SET
            updated_at = $2,
            last_viewed_at = $2
          WHERE share_id = $1
          RETURNING share_id
          `,
          [shareId, now]
        )) as Array<{ share_id: string }>;
        if (legacyRows.length > 0) {
          return true;
        }
      }
    } catch (error) {
      if (!MEMORY_FALLBACK_ENABLED) {
        throwStorageError("touchShare failed: database write error", error);
      }
    }
  }

  if (!MEMORY_FALLBACK_ENABLED) {
    return false;
  }

  const existing = getMemoryStore().shares.get(shareId);
  if (!existing) return false;
  getMemoryStore().shares.set(shareId, {
    ...normalizeStoredShare(existing),
    updatedAt: now,
    lastViewedAt: now,
  });
  return true;
}

export async function listAllShares(): Promise<StoredShareV1[]> {
  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("listAllShares failed");
    }
  } else {
    try {
      const rows = (await sql.query(
        `
        SELECT share_id, kind, creator_name, storage_tier, hot_payload, cold_object_key, created_at, updated_at, last_viewed_at
        FROM ${SHARES_V2_TABLE}
        ORDER BY created_at DESC
        `
      )) as ShareRegistryRow[];

      if (rows.length > 0) {
        const result: StoredShareV1[] = [];
        for (const row of rows) {
          const inflated = await inflateShareFromRegistryRow(sql, row);
          if (inflated) {
            result.push(inflated);
          }
        }
        return result;
      }

      const legacy = await tryListSharesFromV1(sql);
      if (legacy.length > 0) {
        return legacy;
      }
    } catch (error) {
      if (!MEMORY_FALLBACK_ENABLED) {
        throwStorageError("listAllShares failed: database read error", error);
      }
    }
  }

  if (!MEMORY_FALLBACK_ENABLED) {
    return [];
  }

  return Array.from(getMemoryStore().shares.values()).map((item) => normalizeStoredShare(item));
}

function getPeriodStart(period: TrendPeriod, now = Date.now()): number {
  switch (period) {
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "90d":
      return now - 90 * 24 * 60 * 60 * 1000;
    case "180d":
      return now - 180 * 24 * 60 * 60 * 1000;
    case "all":
    default:
      return 0;
  }
}

export async function listSharesByPeriod(period: TrendPeriod): Promise<StoredShareV1[]> {
  const sql = getSqlClient();
  const from = getPeriodStart(period);

  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("listSharesByPeriod failed");
    }
  } else {
    try {
      const rows =
        from > 0
          ? ((await sql.query(
              `
            SELECT share_id, kind, creator_name, storage_tier, hot_payload, cold_object_key, created_at, updated_at, last_viewed_at
            FROM ${SHARES_V2_TABLE}
            WHERE created_at >= $1
            ORDER BY created_at DESC
            `,
              [from]
            )) as ShareRegistryRow[])
          : ((await sql.query(
              `
            SELECT share_id, kind, creator_name, storage_tier, hot_payload, cold_object_key, created_at, updated_at, last_viewed_at
            FROM ${SHARES_V2_TABLE}
            ORDER BY created_at DESC
            `
            )) as ShareRegistryRow[]);

      if (rows.length > 0) {
        const result: StoredShareV1[] = [];
        for (const row of rows) {
          const inflated = await inflateShareFromRegistryRow(sql, row);
          if (inflated) {
            result.push(inflated);
          }
        }
        return result;
      }

      const legacy = await tryListSharesFromV1(sql, from > 0 ? from : undefined);
      if (legacy.length > 0) {
        return legacy;
      }
    } catch (error) {
      if (!MEMORY_FALLBACK_ENABLED) {
        throwStorageError("listSharesByPeriod failed: database read error", error);
      }
    }
  }

  if (!MEMORY_FALLBACK_ENABLED) {
    return [];
  }

  const all = Array.from(getMemoryStore().shares.values()).map((item) => normalizeStoredShare(item));
  return all.filter((item) => item.createdAt >= from);
}

function sortByCount<T extends { count: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.count - a.count);
}

function createTrendGameItem(row: TrendCountRow): TrendGameItem {
  const id = row.subject_id;
  const name = row.name || id;
  return {
    id,
    name,
    localizedName: row.localized_name || undefined,
    cover: row.cover,
    releaseYear:
      typeof row.release_year === "number" && Number.isFinite(row.release_year)
        ? Math.trunc(row.release_year)
        : undefined,
    count: toNumber(row.count, 0),
  };
}

function buildTrendItemsFromCounts(view: TrendView, rows: TrendCountRow[]): TrendBucket[] {
  switch (view) {
    case "genre": {
      const bucketMap = new Map<string, TrendGameItem[]>();
      for (const row of rows) {
        const list = bucketMap.get(row.bucket_key) || [];
        list.push(createTrendGameItem(row));
        bucketMap.set(row.bucket_key, list);
      }
      const buckets: TrendBucket[] = [];
      for (const [bucket, games] of Array.from(bucketMap.entries())) {
        const total = games.reduce((sum, item) => sum + item.count, 0);
        const sortedGames = sortByCount(games).slice(0, 10);
        buckets.push({
          key: bucket,
          label: bucket,
          count: total,
          games: sortedGames,
        });
      }
      return sortByCount(buckets).slice(0, 30);
    }
    case "decade":
    case "year": {
      const bucketMap = new Map<string, TrendGameItem[]>();
      for (const row of rows) {
        const list = bucketMap.get(row.bucket_key) || [];
        list.push(createTrendGameItem(row));
        bucketMap.set(row.bucket_key, list);
      }
      const buckets: TrendBucket[] = [];
      for (const [bucket, games] of Array.from(bucketMap.entries())) {
        const sortedGames = sortByCount(games).slice(0, 5);
        buckets.push({
          key: bucket,
          label: bucket,
          count: sortedGames.reduce((sum, item) => sum + item.count, 0),
          games: sortedGames,
        });
      }
      return view === "decade"
        ? buckets.sort((a, b) => a.key.localeCompare(b.key))
        : buckets.sort((a, b) => Number(b.key) - Number(a.key));
    }
    case "overall":
    default: {
      const sorted = sortByCount(rows.map((row) => createTrendGameItem(row))).slice(0, 30);
      return sorted.map((game, index) => ({
        key: String(index + 1),
        label: `#${index + 1}`,
        count: game.count,
        games: [game],
      }));
    }
  }
}

export async function getAggregatedTrendResponse(params: {
  period: TrendPeriod;
  view: TrendView;
  kind: SubjectKind;
}): Promise<TrendResponse | null> {
  const { period, view, kind } = params;
  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    return null;
  }

  const fromTimestamp = getPeriodStart(period);
  const fromDayKey = fromTimestamp > 0 ? toUtcDayKey(fromTimestamp) : null;

  const sampleRows = (await sql.query(
    fromTimestamp > 0
      ? `
      SELECT
        COUNT(*)::BIGINT AS sample_count,
        MIN(created_at) AS min_created,
        MAX(created_at) AS max_created
      FROM ${SHARES_V2_TABLE}
      WHERE kind = $1
        AND created_at >= $2
      `
      : `
      SELECT
        COUNT(*)::BIGINT AS sample_count,
        MIN(created_at) AS min_created,
        MAX(created_at) AS max_created
      FROM ${SHARES_V2_TABLE}
      WHERE kind = $1
      `,
    fromTimestamp > 0 ? [kind, fromTimestamp] : [kind]
  )) as TrendSampleRow[];

  const sample = sampleRows[0];
  const sampleCount = toNumber(sample?.sample_count, 0);
  const rangeFrom = sample?.min_created === null ? null : toNumber(sample?.min_created, 0) || null;
  const rangeTo = sample?.max_created === null ? null : toNumber(sample?.max_created, 0) || null;

  if (sampleCount === 0) {
    return {
      period,
      view,
      sampleCount,
      range: { from: rangeFrom, to: rangeTo },
      lastUpdatedAt: Date.now(),
      items: [],
    };
  }

  const countRows =
    period === "all"
      ? ((await sql.query(
          `
        SELECT c.bucket_key, c.subject_id, c.count, d.name, d.localized_name, d.cover, d.release_year
        FROM ${TREND_COUNT_ALL_TABLE} c
        LEFT JOIN ${SUBJECT_DIM_TABLE} d ON d.kind = c.kind AND d.subject_id = c.subject_id
        WHERE c.kind = $1 AND c.view = $2
        `,
          [kind, view]
        )) as TrendCountRow[])
      : ((await sql.query(
          `
        SELECT
          c.bucket_key,
          c.subject_id,
          SUM(c.count)::BIGINT AS count,
          MAX(d.name) AS name,
          MAX(d.localized_name) AS localized_name,
          MAX(d.cover) AS cover,
          MAX(d.release_year) AS release_year
        FROM ${TREND_COUNT_DAY_TABLE} c
        LEFT JOIN ${SUBJECT_DIM_TABLE} d ON d.kind = c.kind AND d.subject_id = c.subject_id
        WHERE c.kind = $1 AND c.view = $2 AND c.day_key >= $3
        GROUP BY c.bucket_key, c.subject_id
        `,
          [kind, view, fromDayKey]
        )) as TrendCountRow[]);

  return {
    period,
    view,
    sampleCount,
    range: { from: rangeFrom, to: rangeTo },
    lastUpdatedAt: Date.now(),
    items: buildTrendItemsFromCounts(view, countRows),
  };
}

export async function getTrendsCache(
  period: TrendPeriod,
  view: TrendView,
  kind: SubjectKind
): Promise<TrendResponse | null> {
  const key = trendCacheKey(period, view, kind);
  if (MEMORY_FALLBACK_ENABLED) {
    const fromMemory = getMemoryTrendCache(key);
    if (fromMemory) return fromMemory;
  }

  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("getTrendsCache failed");
    }
  } else {
    try {
      const rows = (await sql`
        SELECT payload, expires_at
        FROM ${sql.unsafe(TRENDS_CACHE_TABLE)}
        WHERE cache_key = ${key}
        LIMIT 1
      `) as TrendCacheRow[];

      if (rows.length > 0) {
        const row = rows[0];
        const expiresAt = toNumber(row.expires_at, 0);
        if (Date.now() > expiresAt) {
          await sql`
            DELETE FROM ${sql.unsafe(TRENDS_CACHE_TABLE)}
            WHERE cache_key = ${key}
          `;
          return null;
        }

        const payload = parseTrendPayload(row.payload);
        if (payload) {
          if (MEMORY_FALLBACK_ENABLED) {
            getMemoryStore().trendCache.set(key, {
              value: payload,
              expiresAt,
            });
          }
          return payload;
        }
      }
    } catch (error) {
      if (!MEMORY_FALLBACK_ENABLED) {
        throwStorageError("getTrendsCache failed: database read error", error);
      }
    }
  }

  return null;
}

export async function setTrendsCache(
  period: TrendPeriod,
  view: TrendView,
  kind: SubjectKind,
  value: TrendResponse,
  ttlSeconds = 600
): Promise<void> {
  const key = trendCacheKey(period, view, kind);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  if (MEMORY_FALLBACK_ENABLED) {
    getMemoryStore().trendCache.set(key, {
      value,
      expiresAt,
    });
  }

  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("setTrendsCache failed");
    }
    return;
  }

  try {
    await sql`
      INSERT INTO ${sql.unsafe(TRENDS_CACHE_TABLE)} (
        cache_key,
        period,
        view,
        kind,
        payload,
        expires_at,
        updated_at
      )
      VALUES (
        ${key},
        ${period},
        ${view},
        ${kind},
        ${JSON.stringify(value)}::jsonb,
        ${expiresAt},
        ${Date.now()}
      )
      ON CONFLICT (cache_key) DO UPDATE SET
        period = EXCLUDED.period,
        view = EXCLUDED.view,
        kind = EXCLUDED.kind,
        payload = EXCLUDED.payload,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (error) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwStorageError("setTrendsCache failed: database write error", error);
    }
  }
}

export async function archiveHotSharesToColdStorage(params?: {
  olderThanDays?: number;
  batchSize?: number;
  cleanupTrendDays?: number;
}): Promise<{ processed: number; archived: number; skipped: number; cleanedTrendRows: number }> {
  const olderThanDays = params?.olderThanDays ?? 30;
  const batchSize = params?.batchSize ?? 500;
  const cleanupTrendDays = params?.cleanupTrendDays ?? 190;

  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    return {
      processed: 0,
      archived: 0,
      skipped: 0,
      cleanedTrendRows: 0,
    };
  }

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const rows = (await sql.query(
    `
    SELECT share_id, kind, creator_name, storage_tier, hot_payload, cold_object_key, created_at, updated_at, last_viewed_at
    FROM ${SHARES_V2_TABLE}
    WHERE storage_tier = 'hot'
      AND hot_payload IS NOT NULL
      AND created_at < $1
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [cutoff, batchSize]
  )) as ShareRegistryRow[];

  let archived = 0;
  let skipped = 0;

  for (const row of rows) {
    const payload = normalizeCompactPayload(row.hot_payload);
    if (!payload || !isColdStorageEnabled()) {
      skipped += 1;
      continue;
    }

    const objectKey = buildColdObjectKey(row.share_id);
    const uploaded = await putColdSharePayload(objectKey, payload);
    if (!uploaded) {
      skipped += 1;
      continue;
    }

    await sql.query(
      `
      UPDATE ${SHARES_V2_TABLE}
      SET
        storage_tier = 'cold',
        cold_object_key = $2,
        hot_payload = NULL,
        updated_at = $3
      WHERE share_id = $1
      `,
      [row.share_id, objectKey, Date.now()]
    );
    archived += 1;
  }

  const cleanupBeforeDayKey = toUtcDayKey(Date.now() - cleanupTrendDays * 24 * 60 * 60 * 1000);
  const cleanedRows = (await sql.query(
    `
    DELETE FROM ${TREND_COUNT_DAY_TABLE}
    WHERE day_key < $1
    RETURNING 1
    `,
    [cleanupBeforeDayKey]
  )) as Array<{ "?column?": number }>;

  return {
    processed: rows.length,
    archived,
    skipped,
    cleanedTrendRows: cleanedRows.length,
  };
}
