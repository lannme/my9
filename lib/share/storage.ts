import { neon } from "@neondatabase/serverless";
import { ShareSubject, StoredShareV1, TrendPeriod, TrendResponse, TrendView } from "@/lib/share/types";
import { DEFAULT_SUBJECT_KIND, SubjectKind, parseSubjectKind } from "@/lib/subject-kind";

const TRENDS_CACHE_PREFIX = "trends:cache:";

const SHARES_TABLE = "my9_shares_v1";
const TRENDS_CACHE_TABLE = "my9_trends_cache_v1";
const SHARES_KIND_CREATED_IDX = `${SHARES_TABLE}_kind_created_idx`;
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
  trendCache: Map<string, { value: TrendResponse; expiresAt: number }>;
};

type ShareRow = {
  share_id: string;
  kind: string;
  creator_name: string | null;
  games: unknown;
  created_at: number | string;
  updated_at: number | string;
  last_viewed_at: number | string;
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

function rowToStoredShare(row: ShareRow): StoredShareV1 {
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
        CREATE TABLE IF NOT EXISTS ${sql.unsafe(SHARES_TABLE)} (
          share_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          creator_name TEXT,
          games JSONB NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          last_viewed_at BIGINT NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.unsafe(SHARES_KIND_CREATED_IDX)}
        ON ${sql.unsafe(SHARES_TABLE)} (kind, created_at DESC)
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

export async function saveShare(record: StoredShareV1): Promise<void> {
  const normalizedRecord = normalizeStoredShare(record);
  const sql = getSqlClient();
  if (!sql || !(await ensureSchema())) {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwDatabaseNotReady("saveShare failed");
    }
    getMemoryStore().shares.set(normalizedRecord.shareId, normalizedRecord);
    return;
  }

  try {
    await sql`
      INSERT INTO ${sql.unsafe(SHARES_TABLE)} (
        share_id,
        kind,
        creator_name,
        games,
        created_at,
        updated_at,
        last_viewed_at
      )
      VALUES (
        ${normalizedRecord.shareId},
        ${normalizedRecord.kind},
        ${normalizedRecord.creatorName},
        ${JSON.stringify(normalizedRecord.games)}::jsonb,
        ${normalizedRecord.createdAt},
        ${normalizedRecord.updatedAt},
        ${normalizedRecord.lastViewedAt}
      )
      ON CONFLICT (share_id) DO UPDATE SET
        kind = EXCLUDED.kind,
        creator_name = EXCLUDED.creator_name,
        games = EXCLUDED.games,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        last_viewed_at = EXCLUDED.last_viewed_at
    `;
  } catch {
    if (!MEMORY_FALLBACK_ENABLED) {
      throwStorageError("saveShare failed: database write error");
    }
    getMemoryStore().shares.set(normalizedRecord.shareId, normalizedRecord);
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
      const rows = (await sql`
        SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
        FROM ${sql.unsafe(SHARES_TABLE)}
        WHERE share_id = ${shareId}
        LIMIT 1
      `) as ShareRow[];
      if (rows.length > 0) {
        return rowToStoredShare(rows[0]);
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
      const rows = (await sql`
        UPDATE ${sql.unsafe(SHARES_TABLE)}
        SET
          updated_at = ${now},
          last_viewed_at = ${now}
        WHERE share_id = ${shareId}
        RETURNING share_id
      `) as Array<{ share_id: string }>;
      if (rows.length > 0) {
        return true;
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
      const rows = (await sql`
        SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
        FROM ${sql.unsafe(SHARES_TABLE)}
      `) as ShareRow[];
      return rows.map((row) => rowToStoredShare(row));
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
      if (from > 0) {
        const rows = (await sql`
          SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
          FROM ${sql.unsafe(SHARES_TABLE)}
          WHERE created_at >= ${from}
        `) as ShareRow[];
        return rows.map((row) => rowToStoredShare(row));
      }

      const rows = (await sql`
        SELECT share_id, kind, creator_name, games, created_at, updated_at, last_viewed_at
        FROM ${sql.unsafe(SHARES_TABLE)}
      `) as ShareRow[];
      return rows.map((row) => rowToStoredShare(row));
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
