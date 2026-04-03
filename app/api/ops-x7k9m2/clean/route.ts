import { NextResponse } from "next/server";
import { _getSqlClient, _ensureSchema, BGG_BOARDGAME_TABLE } from "@/lib/share/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLEANABLE_FIELDS: Record<string, string> = {
  localized_names: "localized_names",
  cover: "cover",
  thumbnail: "thumbnail",
  genres: "genres",
  mechanics: "mechanics",
  families: "families",
  designers: "designers",
  artists: "artists",
  publishers: "publishers",
  description: "description",
  num_comments: "num_comments",
  api_enriched_at: "api_enriched_at",
};

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${cronSecret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sql = _getSqlClient();
  if (!sql || !(await _ensureSchema())) {
    return NextResponse.json({ ok: false, error: "database not available" }, { status: 503 });
  }

  let fields: string[];
  try {
    const body = await request.json();
    if (!Array.isArray(body.fields) || body.fields.length === 0) {
      return NextResponse.json(
        { ok: false, error: "请指定要清洗的字段 fields[]" },
        { status: 400 },
      );
    }
    fields = body.fields;
  } catch {
    return NextResponse.json(
      { ok: false, error: "无法解析请求体" },
      { status: 400 },
    );
  }

  const invalidFields = fields.filter((f) => !CLEANABLE_FIELDS[f]);
  if (invalidFields.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `不支持清洗的字段: ${invalidFields.join(", ")}`,
        allowed: Object.keys(CLEANABLE_FIELDS),
      },
      { status: 400 },
    );
  }

  try {
    const setClauses = fields.map((f) => `${CLEANABLE_FIELDS[f]} = NULL`);
    const includesEnrichFields = fields.some(
      (f) => f !== "api_enriched_at",
    );
    if (includesEnrichFields && !fields.includes("api_enriched_at")) {
      setClauses.push("api_enriched_at = NULL");
    }
    setClauses.push("updated_at = $1");

    const whereCond = fields.map((f) => `${CLEANABLE_FIELDS[f]} IS NOT NULL`).join(" OR ");
    const countResult = await sql.query(
      `SELECT COUNT(*)::int AS cnt FROM ${BGG_BOARDGAME_TABLE} WHERE ${whereCond}`,
      [],
    ) as Array<{ cnt: number }>;
    const affectedRows = countResult[0]?.cnt ?? 0;

    if (affectedRows > 0) {
      await sql.query(
        `UPDATE ${BGG_BOARDGAME_TABLE} SET ${setClauses.join(", ")} WHERE ${whereCond}`,
        [Date.now()],
      );
    }

    return NextResponse.json({
      ok: true,
      result: {
        fields,
        affectedRows,
        resetEnrich: includesEnrichFields && !fields.includes("api_enriched_at"),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "clean failed" },
      { status: 500 },
    );
  }
}
