import { neon } from "@neondatabase/serverless";
import type { PersonalityResult, PersonalityCacheRow } from "@/lib/personality/types";
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION, type GameInput } from "@/lib/personality/prompt";
import type { ShareSubject } from "@/lib/share/types";

const PERSONALITY_TABLE = "my9_personality_v1";
const BGG_BOARDGAME_TABLE = "my9_bgg_boardgame_v1";

function getLlmConfig() {
  return {
    apiKey: process.env.LLM_API_KEY || "",
    baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    model: process.env.LLM_MODEL || "deepseek-chat",
  };
}

function getSqlClient() {
  const host = process.env.NEON_DATABASE_PGHOST_UNPOOLED || process.env.NEON_DATABASE_PGHOST;
  const user = process.env.NEON_DATABASE_PGUSER;
  const password = process.env.NEON_DATABASE_PGPASSWORD || process.env.NEON_DATABASE_POSTGRES_PASSWORD;
  const database = process.env.NEON_DATABASE_PGDATABASE || process.env.NEON_DATABASE_POSTGRES_DATABASE;
  if (!host || !user || !password || !database) return null;
  const port = process.env.NEON_DATABASE_PGPORT || "5432";
  const sslmode = process.env.NEON_DATABASE_PGSSLMODE || "require";
  return neon(`postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=${sslmode}`);
}

async function getCachedPersonality(
  contentHash: string,
): Promise<PersonalityCacheRow | null> {
  const sql = getSqlClient();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT content_hash, prompt_version, kind, personality, model,
             input_tokens, output_tokens, latency_ms, created_at
      FROM ${sql.unsafe(PERSONALITY_TABLE)}
      WHERE content_hash = ${contentHash}
        AND prompt_version = ${PROMPT_VERSION}
      LIMIT 1
    `;
    if (!rows.length) return null;
    const row = rows[0];
    return {
      content_hash: row.content_hash as string,
      prompt_version: row.prompt_version as string,
      kind: row.kind as string,
      personality: (typeof row.personality === "string"
        ? JSON.parse(row.personality)
        : row.personality) as PersonalityResult,
      model: row.model as string,
      input_tokens: row.input_tokens as number | null,
      output_tokens: row.output_tokens as number | null,
      latency_ms: row.latency_ms as number | null,
      created_at: Number(row.created_at),
    };
  } catch {
    return null;
  }
}

export async function getCachedPersonalityResult(
  contentHash: string,
): Promise<PersonalityResult | null> {
  const cached = await getCachedPersonality(contentHash);
  return cached?.personality ?? null;
}

async function saveCachedPersonality(row: PersonalityCacheRow): Promise<void> {
  const sql = getSqlClient();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO ${sql.unsafe(PERSONALITY_TABLE)}
        (content_hash, prompt_version, kind, personality, model, input_tokens, output_tokens, latency_ms, created_at)
      VALUES (
        ${row.content_hash}, ${row.prompt_version}, ${row.kind},
        ${JSON.stringify(row.personality)}, ${row.model},
        ${row.input_tokens}, ${row.output_tokens}, ${row.latency_ms},
        ${row.created_at}
      )
      ON CONFLICT (content_hash) DO UPDATE SET
        prompt_version = EXCLUDED.prompt_version,
        personality = EXCLUDED.personality,
        model = EXCLUDED.model,
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        latency_ms = EXCLUDED.latency_ms,
        created_at = EXCLUDED.created_at
    `;
  } catch {
    /* best-effort */
  }
}

interface BggRow {
  mechanics: string[] | null;
  designers: string[] | null;
  families: string[] | null;
  average_weight: number | null;
  min_players: number | null;
  max_players: number | null;
  playing_time: number | null;
  description: string | null;
}

function bggRowToEnrichment(row: BggRow): GameInput["enrichment"] {
  return {
    mechanics: row.mechanics ?? undefined,
    designers: row.designers ?? undefined,
    families: row.families ?? undefined,
    average_weight: row.average_weight ?? undefined,
    min_players: row.min_players ?? undefined,
    max_players: row.max_players ?? undefined,
    playing_time: row.playing_time ?? undefined,
    description: row.description ?? undefined,
  };
}

async function fetchBggEnrichments(bggIds: string[]): Promise<Map<string, BggRow>> {
  const sql = getSqlClient();
  const result = new Map<string, BggRow>();
  if (!sql || !bggIds.length) return result;
  try {
    const rows = await sql`
      SELECT bgg_id, mechanics, designers, families, average_weight,
             min_players, max_players, playing_time, description
      FROM ${sql.unsafe(BGG_BOARDGAME_TABLE)}
      WHERE bgg_id = ANY(${bggIds})
    `;
    for (const r of rows) {
      result.set(r.bgg_id as string, {
        mechanics: r.mechanics as string[] | null,
        designers: r.designers as string[] | null,
        families: r.families as string[] | null,
        average_weight: r.average_weight as number | null,
        min_players: r.min_players as number | null,
        max_players: r.max_players as number | null,
        playing_time: r.playing_time as number | null,
        description: r.description as string | null,
      });
    }
  } catch {
    /* best-effort */
  }
  return result;
}

function validatePersonalityResult(data: unknown): PersonalityResult | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.tags) || !obj.tags.length) return null;
  if (!obj.dimensions || typeof obj.dimensions !== "object") return null;
  if (typeof obj.summary !== "string" || !obj.summary) return null;
  if (!obj.mbti || typeof obj.mbti !== "object") return null;
  if (!obj.aesthetics || typeof obj.aesthetics !== "object") return null;

  const dims = obj.dimensions as Record<string, unknown>;
  const requiredDims = [
    "strategicDepth", "socialOrientation",
    "classicVsModern", "mainstreamVsNiche", "euroVsAmeritrash",
  ];
  for (const key of requiredDims) {
    if (typeof dims[key] !== "number") return null;
  }

  const mbti = obj.mbti as Record<string, unknown>;
  if (typeof mbti.type !== "string" || typeof mbti.label !== "string") return null;
  if (!mbti.dimensions || typeof mbti.dimensions !== "object") return null;

  const aes = obj.aesthetics as Record<string, unknown>;
  if (typeof aes.themeStyle !== "string" || typeof aes.artStyle !== "string") return null;

  return data as PersonalityResult;
}

async function callLlm(
  games: GameInput[],
  creatorName: string | null,
): Promise<{
  personality: PersonalityResult;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}> {
  const config = getLlmConfig();
  if (!config.apiKey) throw new Error("LLM_API_KEY not configured");

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(games, creatorName);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Empty response from LLM");

  const parsed = JSON.parse(content);
  const validated = validatePersonalityResult(parsed);
  if (!validated) throw new Error("Invalid personality result structure");

  return {
    personality: validated,
    model: json?.model || config.model,
    inputTokens: json?.usage?.prompt_tokens ?? null,
    outputTokens: json?.usage?.completion_tokens ?? null,
  };
}

export async function analyzePersonality(params: {
  contentHash: string;
  kind: string;
  creatorName: string | null;
  games: Array<ShareSubject | null>;
}): Promise<{ personality: PersonalityResult; cached: boolean }> {
  const cached = await getCachedPersonality(params.contentHash);
  if (cached) {
    return { personality: cached.personality, cached: true };
  }

  const filledGames = params.games
    .map((g, i) => (g ? { slot: i + 1, subject: g } : null))
    .filter((g): g is { slot: number; subject: ShareSubject } => g !== null);

  if (!filledGames.length) {
    throw new Error("没有可供分析的游戏数据");
  }

  const bggIds = filledGames
    .map((g) => String(g.subject.id))
    .filter((id) => /^\d+$/.test(id));

  const enrichments = await fetchBggEnrichments(bggIds);

  const gameInputs: GameInput[] = filledGames.map((g) => {
    const row = enrichments.get(String(g.subject.id));
    return {
      slot: g.slot,
      subject: g.subject,
      enrichment: row ? bggRowToEnrichment(row) : null,
    };
  });

  const startMs = Date.now();
  const result = await callLlm(gameInputs, params.creatorName);
  const latencyMs = Date.now() - startMs;

  const cacheRow: PersonalityCacheRow = {
    content_hash: params.contentHash,
    prompt_version: PROMPT_VERSION,
    kind: params.kind,
    personality: result.personality,
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: latencyMs,
    created_at: Date.now(),
  };
  await saveCachedPersonality(cacheRow);

  return { personality: result.personality, cached: false };
}
