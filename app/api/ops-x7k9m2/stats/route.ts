import { NextResponse } from "next/server";
import { _getSqlClient, _ensureSchema, BGG_BOARDGAME_TABLE } from "@/lib/share/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sql = _getSqlClient();
  if (!sql || !(await _ensureSchema())) {
    return NextResponse.json({ ok: false, error: "database not available" }, { status: 503 });
  }

  try {
    const countRows = (await sql.query(
      `SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE cover IS NOT NULL)::int AS with_cover,
        COUNT(*) FILTER (WHERE localized_name IS NOT NULL)::int AS with_localized_name,
        COUNT(*) FILTER (WHERE api_enriched_at IS NOT NULL)::int AS enriched_count,
        COUNT(*) FILTER (WHERE csv_imported_at IS NOT NULL)::int AS csv_imported_count,
        COUNT(*) FILTER (WHERE is_expansion = TRUE)::int AS expansion_count,
        COUNT(*) FILTER (WHERE is_expansion = FALSE)::int AS base_game_count
      FROM ${BGG_BOARDGAME_TABLE}`
    )) as Array<{
      total_count: number;
      with_cover: number;
      with_localized_name: number;
      enriched_count: number;
      csv_imported_count: number;
      expansion_count: number;
      base_game_count: number;
    }>;

    const topRankedRows = (await sql.query(
      `SELECT bgg_id, name, bgg_rank
      FROM ${BGG_BOARDGAME_TABLE}
      WHERE bgg_rank IS NOT NULL
      ORDER BY bgg_rank ASC
      LIMIT 1`
    )) as Array<{ bgg_id: string; name: string; bgg_rank: number }>;

    const stats = {
      ...(countRows[0] ?? {
        total_count: 0,
        with_cover: 0,
        with_localized_name: 0,
        enriched_count: 0,
        csv_imported_count: 0,
        expansion_count: 0,
        base_game_count: 0,
      }),
      top_ranked: topRankedRows[0] ?? null,
    };

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "query failed" },
      { status: 500 }
    );
  }
}
