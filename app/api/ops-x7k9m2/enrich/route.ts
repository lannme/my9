import { NextResponse } from "next/server";
import {
  fetchThingItems,
  bggToArray,
  type BggThingItem,
  type BggName,
  type BggLink,
} from "@/lib/bgg/bgg-api";
import { _getSqlClient, _ensureSchema, BGG_BOARDGAME_TABLE } from "@/lib/share/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30_000;
const RETRY_SHORT_DELAY_MS = 5_000;
const MAX_RETRIES = 2;

function stripHtml(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/<[^>]*>/g, "").trim();
}

function parseFloat0(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseInt0(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseRankValue(raw: string | undefined): number | null {
  if (!raw || raw === "Not Ranked") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const RANK_NAME_TO_COLUMN: Record<string, string> = {
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

function extractRanks(item: BggThingItem): Record<string, number | null> {
  const ranks: Record<string, number | null> = {};
  const rankItems = bggToArray(item.statistics?.ratings?.ranks?.rank);
  for (const r of rankItems) {
    const name = r.name;
    if (name && RANK_NAME_TO_COLUMN[name]) {
      ranks[RANK_NAME_TO_COLUMN[name]] = parseRankValue(r.value);
    }
  }
  return ranks;
}

function extractLinkValues(links: BggLink[], type: string, max = 20): string[] {
  return links
    .filter((l) => l.type === type)
    .map((l) => l.value ?? "")
    .filter(Boolean)
    .slice(0, max);
}

function extractSuggestedNumplayers(item: BggThingItem): unknown[] | null {
  const polls = bggToArray(item.poll);
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

function extractPollWinner(item: BggThingItem, pollName: string): string | null {
  const polls = bggToArray(item.poll);
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

type ItemData = {
  id: string;
  cover: string | null;
  thumbnail: string | null;
  primaryName: string | null;
  localizedNames: string[] | null;
  description: string | null;
  genres: string[] | null;
  mechanics: string[] | null;
  families: string[] | null;
  designers: string[] | null;
  artists: string[] | null;
  publishers: string[] | null;
  numComments: number;
  bayesAverage: number;
  average: number;
  usersRated: number;
  averageWeight: number;
  numWeights: number;
  stddev: number;
  median: number;
  owned: number;
  wanting: number;
  wishing: number;
  trading: number;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTime: number | null;
  minPlaytime: number | null;
  maxPlaytime: number | null;
  minAge: number | null;
  suggestedNumplayers: unknown[] | null;
  suggestedPlayerage: string | null;
  languageDependence: string | null;
  [key: string]: string | number | string[] | unknown[] | null;
};

function extractItemData(item: BggThingItem): ItemData | null {
  const id = item.id;
  if (!id) return null;

  const image = item.image || null;
  const thumb = item.thumbnail || null;

  const names = bggToArray(item.name) as BggName[];
  const primaryName = names.find((n) => n.type === "primary")?.value || null;

  const alternateNames = names
    .filter((n) => n.type === "alternate" && n.value)
    .map((n) => n.value!)
    .filter(Boolean);
  const localizedNames = alternateNames.length > 0 ? alternateNames : null;

  const rawDescription = typeof item.description === "string" ? item.description : "";
  const description = stripHtml(rawDescription).slice(0, 500) || null;

  const links = bggToArray(item.link) as BggLink[];
  const genres = extractLinkValues(links, "boardgamecategory", 10);
  const mechanics = extractLinkValues(links, "boardgamemechanic", 20);
  const families = extractLinkValues(links, "boardgamefamily", 15);
  const designers = extractLinkValues(links, "boardgamedesigner", 10);
  const artists = extractLinkValues(links, "boardgameartist", 10);
  const publishers = extractLinkValues(links, "boardgamepublisher", 10);

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

  const suggestedNumplayers = extractSuggestedNumplayers(item);
  const suggestedPlayerage = extractPollWinner(item, "suggested_playerage");
  const languageDependence = extractPollWinner(item, "language_dependence");

  const ranks = extractRanks(item);

  return {
    id: String(id),
    cover: image,
    thumbnail: thumb,
    primaryName,
    localizedNames,
    description,
    genres: genres.length > 0 ? genres : null,
    mechanics: mechanics.length > 0 ? mechanics : null,
    families: families.length > 0 ? families : null,
    designers: designers.length > 0 ? designers : null,
    artists: artists.length > 0 ? artists : null,
    publishers: publishers.length > 0 ? publishers : null,
    numComments,
    bayesAverage,
    average,
    usersRated,
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

type EnrichEvent = { event: string; data: Record<string, unknown> };

type EnrichTask = {
  status: "running" | "done" | "error";
  events: EnrichEvent[];
  startedAt: number;
  description: string;
};

let enrichTask: EnrichTask | null = null;

function pushEvent(task: EnrichTask, event: string, data: Record<string, unknown>) {
  task.events.push({ event, data });
}

async function runEnrichBackground(opts: {
  batchSize: number;
  limit: number;
  rankFrom: number;
  rankTo: number;
  forceMode: boolean;
}) {
  const { batchSize, limit, rankFrom, rankTo, forceMode } = opts;
  const rangeDesc = rankTo > 0 ? `rank ${rankFrom}~${rankTo}` : `rank ${rankFrom}+`;
  const task: EnrichTask = {
    status: "running",
    events: [],
    startedAt: Date.now(),
    description: `${rangeDesc}, limit=${limit}${forceMode ? ", force" : ""}`,
  };
  enrichTask = task;

  try {
    const sql = _getSqlClient();
    if (!sql || !(await _ensureSchema())) {
      pushEvent(task, "error", { error: "database not available" });
      task.status = "error";
      return;
    }

    const conditions: string[] = ["bgg_rank IS NOT NULL"];
    const params: (number | string)[] = [];
    let paramIdx = 1;

    conditions.push(`bgg_rank >= $${paramIdx}`);
    params.push(rankFrom);
    paramIdx++;

    if (rankTo > 0) {
      conditions.push(`bgg_rank <= $${paramIdx}`);
      params.push(rankTo);
      paramIdx++;
    }

    if (!forceMode) {
      conditions.push("api_enriched_at IS NULL");
    }

    const limitParam = `$${paramIdx}`;
    params.push(limit);

    const rows = (await sql.query(
      `SELECT bgg_id, bgg_rank FROM ${BGG_BOARDGAME_TABLE}
       WHERE ${conditions.join(" AND ")}
       ORDER BY bgg_rank ASC
       LIMIT ${limitParam}`,
      params
    )) as Array<{ bgg_id: string; bgg_rank: number }>;

    const totalFound = rows.length;
    const allIds = rows.map((r) => r.bgg_id);
    const allRanks = rows.map((r) => r.bgg_rank);
    const minRank = rows.length > 0 ? rows[0].bgg_rank : 0;
    const maxRank = rows.length > 0 ? rows[rows.length - 1].bgg_rank : 0;
    const batches: string[][] = [];
    const batchRanks: [number, number][] = [];
    for (let i = 0; i < allIds.length; i += batchSize) {
      batches.push(allIds.slice(i, i + batchSize));
      const slice = allRanks.slice(i, i + batchSize);
      batchRanks.push([slice[0], slice[slice.length - 1]]);
    }
    const totalBatches = batches.length;

    pushEvent(task, "start", { totalFound, totalBatches, minRank, maxRank });

    if (totalFound === 0) {
      pushEvent(task, "done", { totalFound: 0, totalFetched: 0, enriched: 0, failed: 0, skipped: 0, elapsedMs: 0, errors: [] });
      task.status = "done";
      return;
    }

    const startTime = Date.now();
    let totalFetched = 0;
    let enriched = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batchIds = batches[batchIdx];
      let batchEnriched = 0;
      let batchFailed = 0;
      let batchSkipped = 0;
      const batchErrors: string[] = [];

      let thingItems: BggThingItem[] = [];
      let fetched = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetchThingItems({
            id: batchIds.join(","),
            type: "boardgame",
            stats: 1,
          });
          thingItems = bggToArray(response.items?.item);
          totalFetched += batchIds.length;
          fetched = true;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < MAX_RETRIES) {
            const is429 = msg.includes("429");
            const delay = is429 ? RETRY_DELAY_MS : RETRY_SHORT_DELAY_MS;
            const label = is429 ? "429 限流" : "请求失败";
            const retryMsg = `batch#${batchIdx} ${label}(attempt ${attempt + 1}): ${msg}，${delay / 1000}s 后重试`;
            errors.push(retryMsg);
            batchErrors.push(retryMsg);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          const failMsg = `batch#${batchIdx} fetch 最终失败(${MAX_RETRIES + 1}次尝试): ${msg}`;
          errors.push(failMsg);
          batchErrors.push(failMsg);
          batchFailed += batchIds.length;
          failed += batchIds.length;
          if (batchIdx < batches.length - 1) {
            await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
          }
        }
      }

      if (fetched) {
        const itemMap = new Map<string, ItemData>();
        for (const item of thingItems) {
          const data = extractItemData(item);
          if (data) itemMap.set(data.id, data);
        }

        for (const bggId of batchIds) {
          const data = itemMap.get(bggId);
          if (!data) {
            skipped++;
            batchSkipped++;
            continue;
          }

          try {
            const now = Date.now();
            await sql.query(
              `UPDATE ${BGG_BOARDGAME_TABLE} SET
                cover = $1,
                thumbnail = $2,
                localized_names = $3,
                genres = $4,
                mechanics = $5,
                families = $6,
                designers = $7,
                artists = $8,
                publishers = $9,
                description = $10,
                num_comments = $11,
                bayes_average = $12,
                average = $13,
                users_rated = $14,
                bgg_rank = $15,
                abstracts_rank = $16,
                cgs_rank = $17,
                childrensgames_rank = $18,
                familygames_rank = $19,
                partygames_rank = $20,
                strategygames_rank = $21,
                thematic_rank = $22,
                wargames_rank = $23,
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
                data.mechanics ? JSON.stringify(data.mechanics) : null,
                data.families ? JSON.stringify(data.families) : null,
                data.designers ? JSON.stringify(data.designers) : null,
                data.artists ? JSON.stringify(data.artists) : null,
                data.publishers ? JSON.stringify(data.publishers) : null,
                data.description,
                data.numComments,
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
            batchEnriched++;
          } catch (dbErr) {
            const dbMsg = `bgg_id=${bggId} DB 写入失败: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`;
            errors.push(dbMsg);
            batchErrors.push(dbMsg);
            failed++;
            batchFailed++;
          }
        }
      }

      pushEvent(task, "batch", {
        batchIdx,
        totalBatches,
        rankRange: batchRanks[batchIdx],
        enriched: batchEnriched,
        failed: batchFailed,
        skipped: batchSkipped,
        errors: batchErrors.length > 0 ? batchErrors : [],
      });

      if (batchIdx < batches.length - 1) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }
    }

    const elapsedMs = Date.now() - startTime;
    pushEvent(task, "done", {
      totalFound,
      totalFetched,
      enriched,
      failed,
      skipped,
      elapsedMs,
      errors: errors.length > 0 ? errors.slice(0, 20) : [],
    });
    task.status = "done";
  } catch (err) {
    pushEvent(task, "error", { error: err instanceof Error ? err.message : "enrich failed" });
    task.status = "error";
  }
}

function isAuthorizedFromParams(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${cronSecret}`) return true;
  const { searchParams } = new URL(request.url);
  return searchParams.get("token") === cronSecret;
}

export async function POST(request: Request) {
  if (!isAuthorizedFromParams(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: false, error: "Please use GET with SSE for enrich operations" }, { status: 400 });
}

export async function GET(request: Request) {
  if (!isAuthorizedFromParams(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "status") {
    if (!enrichTask) {
      return NextResponse.json({ ok: true, status: "idle" });
    }
    return NextResponse.json({
      ok: true,
      status: enrichTask.status,
      description: enrichTask.description,
      eventCount: enrichTask.events.length,
      startedAt: enrichTask.startedAt,
      elapsedMs: Date.now() - enrichTask.startedAt,
    });
  }

  const subscribe = action === "subscribe";

  if (!subscribe) {
    if (enrichTask?.status === "running") {
      return NextResponse.json({
        ok: false,
        error: "enrich task already running",
        description: enrichTask.description,
        hint: "use action=subscribe to watch progress, or wait for it to finish",
      }, { status: 409 });
    }

    const rawBatchSize = searchParams.get("batchSize");
    const batchSize = rawBatchSize ? Math.max(1, Math.trunc(Number(rawBatchSize)) || 20) : 20;

    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Math.max(1, Math.trunc(Number(rawLimit)) || 200) : 200;

    const rawRankFrom = searchParams.get("rankFrom");
    const rankFrom = rawRankFrom ? Math.max(1, Math.trunc(Number(rawRankFrom)) || 1) : 1;

    const rawRankTo = searchParams.get("rankTo");
    const rankTo = rawRankTo ? Math.max(0, Math.trunc(Number(rawRankTo)) || 0) : 0;

    const rawForce = searchParams.get("force");
    const forceMode = rawForce === "1" || rawForce === "true";

    runEnrichBackground({ batchSize, limit, rankFrom, rankTo, forceMode });
  }

  if (!enrichTask) {
    return NextResponse.json({ ok: false, error: "no task to subscribe" }, { status: 404 });
  }

  const task = enrichTask;
  const rawCursor = searchParams.get("cursor");
  let cursor = rawCursor ? Math.max(0, Math.trunc(Number(rawCursor)) || 0) : 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed by client
        }
      };

      send("connected", {
        status: task.status,
        description: task.description,
        eventCount: task.events.length,
        cursor,
      });

      const POLL_INTERVAL = 300;
      const MAX_IDLE_MS = 10_000;
      let lastActivityAt = Date.now();

      while (true) {
        if (cursor < task.events.length) {
          const pending = task.events.slice(cursor);
          for (const ev of pending) {
            send(ev.event, ev.data);
            cursor++;
          }
          lastActivityAt = Date.now();
        }

        if (task.status !== "running") {
          break;
        }

        if (Date.now() - lastActivityAt > MAX_IDLE_MS) {
          send("heartbeat", { cursor, elapsed: Date.now() - task.startedAt });
          lastActivityAt = Date.now();
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      }

      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
