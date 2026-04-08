import { _getSqlClient, _ensureSchema, BGG_BOARDGAME_TABLE } from "@/lib/share/storage";
import type { ShareSubject } from "@/lib/share/types";
import type { BggThingItem } from "@/lib/bgg/bgg-api";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenCC = require("opencc-js") as {
  Converter: (opts: { from: string; to: string }) => (text: string) => string;
};


type BggBoardgameRow = {
  bgg_id: string;
  name: string;
  localized_names: unknown;
  year_published: number | null;
  cover: string | null;
  thumbnail: string | null;
  genres: unknown;
  bayes_average: number;
  users_rated: number;
  sim?: number;
};

export interface LocalSearchResult {
  items: ShareSubject[];
  needsEnrich: string[];
}

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

const s2t = OpenCC.Converter({ from: "cn", to: "tw" });
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });

function toSimplifiedAndTraditional(text: string): { simplified: string; traditional: string } {
  return { simplified: t2s(text), traditional: s2t(text) };
}

function escapeIlike(input: string): string {
  return input.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function parseJsonArray(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const filtered = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
    return filtered.length > 0 ? filtered : undefined;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
        return filtered.length > 0 ? filtered : undefined;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pickLocalizedName(row: BggBoardgameRow, query?: string): string | undefined {
  const names = parseJsonArray(row.localized_names);
  if (!names || names.length === 0) return undefined;

  if (query) {
    const isCjk = CJK_RE.test(query);
    if (isCjk) {
      const { simplified, traditional } = toSimplifiedAndTraditional(query);
      const sLower = simplified.toLowerCase();
      const tLower = traditional.toLowerCase();
      const matched = names.find((n) => {
        const nLower = n.toLowerCase();
        return nLower.includes(sLower) || nLower.includes(tLower);
      });
      if (matched) return matched;
    } else {
      const qLower = query.toLowerCase();
      const matched = names.find((n) => n.toLowerCase().includes(qLower));
      if (matched) return matched;
    }
  }

  const cjk = names.find((n) => CJK_RE.test(n));
  return cjk || names[0];
}

function rowToSubject(row: BggBoardgameRow, query?: string): ShareSubject {
  const bayesAverage = row.bayes_average;
  return {
    id: row.bgg_id,
    name: row.name,
    localizedName: pickLocalizedName(row, query),
    cover: row.cover || row.thumbnail || null,
    releaseYear: row.year_published ?? undefined,
    genres: parseJsonArray(row.genres),
    storeUrls: {
      bgg: `https://boardgamegeek.com/boardgame/${row.bgg_id}`,
    },
    rating: bayesAverage > 0 ? Math.round(bayesAverage * 10) / 10 : undefined,
  };
}

export async function searchLocalBoardgames(query: string): Promise<LocalSearchResult> {
  const trimmed = query.trim().slice(0, 100);
  if (!trimmed) return { items: [], needsEnrich: [] };

  const sql = _getSqlClient();
  if (!sql || !(await _ensureSchema())) {
    throw new Error("Database not ready for local boardgame search");
  }

  const isCjk = CJK_RE.test(trimmed);

  let rows: BggBoardgameRow[];

  if (isCjk) {
    const { simplified, traditional } = toSimplifiedAndTraditional(trimmed);
    const escapedSimplified = escapeIlike(simplified);
    const escapedTraditional = escapeIlike(traditional);
    rows = (await sql.query(
      `
      SELECT bgg_id, name, localized_names, year_published, cover, thumbnail, genres, bayes_average, users_rated
      FROM ${BGG_BOARDGAME_TABLE}
      WHERE (
        localized_names::text ILIKE '%' || $1 || '%'
        OR localized_names::text ILIKE '%' || $2 || '%'
        OR name ILIKE '%' || $1 || '%'
        OR name ILIKE '%' || $2 || '%'
      )
        AND is_expansion = FALSE
      ORDER BY bayes_average DESC, users_rated DESC
      LIMIT 20
      `,
      [escapedSimplified, escapedTraditional],
    )) as BggBoardgameRow[];
  } else {
    const lowered = trimmed.toLowerCase();
    const escaped = escapeIlike(trimmed);
    rows = (await sql.query(
      `
      SELECT bgg_id, name, localized_names, year_published, cover, thumbnail, genres, bayes_average, users_rated,
             similarity(name, $1) AS sim
      FROM ${BGG_BOARDGAME_TABLE}
      WHERE (name % $1 OR name_search = $2 OR name ILIKE '%' || $3 || '%')
        AND is_expansion = FALSE
      ORDER BY
        CASE WHEN name ILIKE $3 || '%' THEN 0
             WHEN name ILIKE '%' || $3 || '%' THEN 1
             ELSE 2
        END,
        bayes_average DESC, users_rated DESC
      LIMIT 20
      `,
      [trimmed, lowered, escaped],
    )) as BggBoardgameRow[];
  }

  const items: ShareSubject[] = [];
  const needsEnrich: string[] = [];

  for (const row of rows) {
    items.push(rowToSubject(row, trimmed));
    if (!row.cover) {
      needsEnrich.push(row.bgg_id);
    }
  }

  return { items, needsEnrich };
}

export async function upsertBggBoardgameFromSearch(
  items: ShareSubject[],
  thingMap: Map<string, BggThingItem>,
): Promise<void> {
  const sql = _getSqlClient();
  if (!sql || !(await _ensureSchema())) {
    return;
  }

  const upsertRows: Array<{
    bgg_id: string;
    name: string;
    localized_names: string | null;
    year_published: number | null;
    cover: string | null;
    thumbnail: string | null;
    genres: string | null;
    users_rated: number;
    bayes_average: number;
  }> = [];

  for (const item of items) {
    const bggId = String(item.id);
    const thing = thingMap.get(bggId);

    const cover = (typeof item.cover === "string" && item.cover) || null;
    let thumbnail: string | null = null;
    if (thing?.thumbnail && typeof thing.thumbnail === "string") {
      thumbnail = thing.thumbnail;
    }

    const ratings = thing?.statistics?.ratings;
    const bayesAverage = ratings?.bayesaverage?.value
      ? Number.parseFloat(ratings.bayesaverage.value)
      : 0;
    const usersRated = ratings?.usersrated?.value
      ? Number.parseInt(ratings.usersrated.value, 10)
      : 0;

    upsertRows.push({
      bgg_id: bggId,
      name: item.name,
      localized_names: item.localizedName ? JSON.stringify([item.localizedName]) : null,
      year_published: item.releaseYear ?? null,
      cover,
      thumbnail,
      genres: item.genres && item.genres.length > 0 ? JSON.stringify(item.genres) : null,
      users_rated: Number.isFinite(usersRated) ? usersRated : 0,
      bayes_average: Number.isFinite(bayesAverage) ? bayesAverage : 0,
    });
  }

  if (upsertRows.length === 0) return;

  const now = Date.now();

  try {
    await sql.query(
      `
      INSERT INTO ${BGG_BOARDGAME_TABLE} (
        bgg_id, name, localized_names, year_published, cover, thumbnail, genres,
        users_rated, bayes_average, updated_at, api_enriched_at
      )
      SELECT
        r.bgg_id, r.name, r.localized_names::jsonb, r.year_published, r.cover, r.thumbnail,
        r.genres::jsonb, r.users_rated, r.bayes_average, $2::bigint, $2::bigint
      FROM jsonb_to_recordset($1::jsonb) AS r(
        bgg_id text,
        name text,
        localized_names text,
        year_published int,
        cover text,
        thumbnail text,
        genres text,
        users_rated int,
        bayes_average real
      )
      ON CONFLICT (bgg_id) DO UPDATE SET
        name = EXCLUDED.name,
        cover = EXCLUDED.cover,
        thumbnail = EXCLUDED.thumbnail,
        localized_names = COALESCE(EXCLUDED.localized_names, ${BGG_BOARDGAME_TABLE}.localized_names),
        genres = EXCLUDED.genres,
        users_rated = EXCLUDED.users_rated,
        bayes_average = EXCLUDED.bayes_average,
        updated_at = EXCLUDED.updated_at,
        api_enriched_at = EXCLUDED.api_enriched_at
      `,
      [JSON.stringify(upsertRows), now],
    );
  } catch {
    return;
  }
}

export async function getBggBoardgamesByIds(
  ids: string[],
): Promise<Array<{ bgg_id: string; cover: string | null }>> {
  const sql = _getSqlClient();
  if (!sql || ids.length === 0) return [];
  try {
    return await sql`SELECT bgg_id, cover FROM my9_bgg_boardgame_v1 WHERE bgg_id = ANY(${ids})` as Array<{ bgg_id: string; cover: string | null }>;
  } catch {
    return [];
  }
}

export async function upsertBggBoardgameCovers(
  data: Array<{ bgg_id: string; cover: string; thumbnail: string | null }>,
): Promise<void> {
  const sql = _getSqlClient();
  if (!sql || data.length === 0) return;
  try {
    await sql.query(
      `UPDATE ${BGG_BOARDGAME_TABLE} SET
        cover = r.cover,
        thumbnail = COALESCE(r.thumbnail, ${BGG_BOARDGAME_TABLE}.thumbnail),
        updated_at = $2
      FROM jsonb_to_recordset($1::jsonb) AS r(bgg_id text, cover text, thumbnail text)
      WHERE ${BGG_BOARDGAME_TABLE}.bgg_id = r.bgg_id`,
      [JSON.stringify(data), Date.now()],
    );
  } catch {
    return;
  }
}
