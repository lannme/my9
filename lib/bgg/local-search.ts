import { _getSqlClient, _ensureSchema, BGG_BOARDGAME_TABLE } from "@/lib/share/storage";
import type { ShareSubject } from "@/lib/share/types";
import type { BggThingItem } from "@/lib/bgg/bgg-api";
import { bggToArray } from "@/lib/bgg/bgg-api";
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

function parseFloat0(raw?: string): number {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseInt0(raw?: string): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function extractLinksOfType(thing: BggThingItem, type: string): string[] {
  return bggToArray(thing.link)
    .filter((l) => l.type === type)
    .map((l) => l.value ?? "")
    .filter(Boolean);
}

function extractSuggestedNumplayers(thing: BggThingItem): unknown[] | null {
  const polls = bggToArray(thing.poll);
  const npPoll = polls.find((p) => p.name === "suggested_numplayers");
  if (!npPoll) return null;
  const entries: unknown[] = [];
  for (const r of bggToArray(npPoll.results)) {
    if (!r.numplayers) continue;
    const votes: Record<string, number> = {};
    for (const v of bggToArray(r.result)) {
      if (v.value && v.numvotes) votes[v.value] = parseInt0(v.numvotes);
    }
    entries.push({ numplayers: r.numplayers, ...votes });
  }
  return entries.length > 0 ? entries : null;
}

function extractPollWinner(thing: BggThingItem, pollName: string): string | null {
  const polls = bggToArray(thing.poll);
  const poll = polls.find((p) => p.name === pollName);
  if (!poll) return null;
  let maxVotes = 0;
  let winner: string | null = null;
  for (const r of bggToArray(poll.results)) {
    for (const v of bggToArray(r.result)) {
      const nv = parseInt0(v.numvotes);
      if (nv > maxVotes) {
        maxVotes = nv;
        winner = v.value || null;
      }
    }
  }
  return winner;
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
    mechanics: string | null;
    designers: string | null;
    artists: string | null;
    publishers: string | null;
    families: string | null;
    num_comments: number;
    average_weight: number;
    min_players: number | null;
    max_players: number | null;
    playing_time: number | null;
    min_playtime: number | null;
    max_playtime: number | null;
    min_age: number | null;
    owned: number;
    wanting: number;
    wishing: number;
    trading: number;
    stddev: number;
    median: number;
    num_weights: number;
    suggested_numplayers: string | null;
    suggested_playerage: string | null;
    language_dependence: string | null;
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

    const mechanics = thing ? extractLinksOfType(thing, "boardgamemechanic") : [];
    const designers = thing ? extractLinksOfType(thing, "boardgamedesigner") : [];
    const artists = thing ? extractLinksOfType(thing, "boardgameartist") : [];
    const publishers = thing ? extractLinksOfType(thing, "boardgamepublisher") : [];
    const families = thing ? extractLinksOfType(thing, "boardgamefamily") : [];

    const numComments = parseInt0(ratings?.numcomments?.value);
    const averageWeight = parseFloat0(ratings?.averageweight?.value);
    const minPlayers = parseInt0(thing?.minplayers?.value) || null;
    const maxPlayers = parseInt0(thing?.maxplayers?.value) || null;
    const playingTime = parseInt0(thing?.playingtime?.value) || null;
    const minPlaytime = parseInt0(thing?.minplaytime?.value) || null;
    const maxPlaytime = parseInt0(thing?.maxplaytime?.value) || null;
    const minAge = parseInt0(thing?.minage?.value) || null;
    const owned = parseInt0(ratings?.owned?.value);
    const wanting = parseInt0(ratings?.wanting?.value);
    const wishing = parseInt0(ratings?.wishing?.value);
    const trading = parseInt0(ratings?.trading?.value);
    const stddev = parseFloat0(ratings?.stddev?.value);
    const median = parseFloat0(ratings?.median?.value);
    const numWeights = parseInt0(ratings?.numweights?.value);
    const suggestedNumplayers = thing ? extractSuggestedNumplayers(thing) : null;
    const suggestedPlayerage = thing ? extractPollWinner(thing, "suggested_playerage") : null;
    const languageDependence = thing ? extractPollWinner(thing, "language_dependence") : null;

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
      mechanics: mechanics.length > 0 ? JSON.stringify(mechanics) : null,
      designers: designers.length > 0 ? JSON.stringify(designers) : null,
      artists: artists.length > 0 ? JSON.stringify(artists) : null,
      publishers: publishers.length > 0 ? JSON.stringify(publishers) : null,
      families: families.length > 0 ? JSON.stringify(families) : null,
      num_comments: numComments,
      average_weight: averageWeight,
      min_players: minPlayers,
      max_players: maxPlayers,
      playing_time: playingTime,
      min_playtime: minPlaytime,
      max_playtime: maxPlaytime,
      min_age: minAge,
      owned,
      wanting,
      wishing,
      trading,
      stddev,
      median,
      num_weights: numWeights,
      suggested_numplayers: suggestedNumplayers ? JSON.stringify(suggestedNumplayers) : null,
      suggested_playerage: suggestedPlayerage,
      language_dependence: languageDependence,
    });
  }

  if (upsertRows.length === 0) return;

  const now = Date.now();

  try {
    await sql.query(
      `
      INSERT INTO ${BGG_BOARDGAME_TABLE} (
        bgg_id, name, localized_names, year_published, cover, thumbnail, genres,
        users_rated, bayes_average, mechanics, designers, artists, publishers, families,
        num_comments, average_weight, min_players, max_players, playing_time,
        min_playtime, max_playtime, min_age, owned, wanting, wishing, trading,
        stddev, median, num_weights, suggested_numplayers, suggested_playerage,
        language_dependence, updated_at, api_enriched_at
      )
      SELECT
        r.bgg_id, r.name, r.localized_names::jsonb, r.year_published, r.cover, r.thumbnail,
        r.genres::jsonb, r.users_rated, r.bayes_average,
        r.mechanics::jsonb, r.designers::jsonb, r.artists::jsonb, r.publishers::jsonb, r.families::jsonb,
        r.num_comments, r.average_weight, r.min_players, r.max_players, r.playing_time,
        r.min_playtime, r.max_playtime, r.min_age, r.owned, r.wanting, r.wishing, r.trading,
        r.stddev, r.median, r.num_weights, r.suggested_numplayers::jsonb, r.suggested_playerage,
        r.language_dependence, $2::bigint, $2::bigint
      FROM jsonb_to_recordset($1::jsonb) AS r(
        bgg_id text,
        name text,
        localized_names text,
        year_published int,
        cover text,
        thumbnail text,
        genres text,
        users_rated int,
        bayes_average real,
        mechanics text,
        designers text,
        artists text,
        publishers text,
        families text,
        num_comments int,
        average_weight real,
        min_players int,
        max_players int,
        playing_time int,
        min_playtime int,
        max_playtime int,
        min_age int,
        owned int,
        wanting int,
        wishing int,
        trading int,
        stddev real,
        median real,
        num_weights int,
        suggested_numplayers text,
        suggested_playerage text,
        language_dependence text
      )
      ON CONFLICT (bgg_id) DO UPDATE SET
        name = EXCLUDED.name,
        cover = EXCLUDED.cover,
        thumbnail = EXCLUDED.thumbnail,
        localized_names = COALESCE(EXCLUDED.localized_names, ${BGG_BOARDGAME_TABLE}.localized_names),
        genres = EXCLUDED.genres,
        users_rated = EXCLUDED.users_rated,
        bayes_average = EXCLUDED.bayes_average,
        mechanics = COALESCE(EXCLUDED.mechanics, ${BGG_BOARDGAME_TABLE}.mechanics),
        designers = COALESCE(EXCLUDED.designers, ${BGG_BOARDGAME_TABLE}.designers),
        artists = COALESCE(EXCLUDED.artists, ${BGG_BOARDGAME_TABLE}.artists),
        publishers = COALESCE(EXCLUDED.publishers, ${BGG_BOARDGAME_TABLE}.publishers),
        families = COALESCE(EXCLUDED.families, ${BGG_BOARDGAME_TABLE}.families),
        num_comments = EXCLUDED.num_comments,
        average_weight = EXCLUDED.average_weight,
        min_players = EXCLUDED.min_players,
        max_players = EXCLUDED.max_players,
        playing_time = EXCLUDED.playing_time,
        min_playtime = EXCLUDED.min_playtime,
        max_playtime = EXCLUDED.max_playtime,
        min_age = EXCLUDED.min_age,
        owned = EXCLUDED.owned,
        wanting = EXCLUDED.wanting,
        wishing = EXCLUDED.wishing,
        trading = EXCLUDED.trading,
        stddev = EXCLUDED.stddev,
        median = EXCLUDED.median,
        num_weights = EXCLUDED.num_weights,
        suggested_numplayers = COALESCE(EXCLUDED.suggested_numplayers, ${BGG_BOARDGAME_TABLE}.suggested_numplayers),
        suggested_playerage = COALESCE(EXCLUDED.suggested_playerage, ${BGG_BOARDGAME_TABLE}.suggested_playerage),
        language_dependence = COALESCE(EXCLUDED.language_dependence, ${BGG_BOARDGAME_TABLE}.language_dependence),
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
