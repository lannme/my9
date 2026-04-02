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

type CsvRow = {
  bgg_id: string;
  name: string;
  year_published: number | null;
  bgg_rank: number | null;
  bayes_average: number;
  average: number;
  users_rated: number;
  is_expansion: boolean;
  abstracts_rank: number | null;
  cgs_rank: number | null;
  childrensgames_rank: number | null;
  familygames_rank: number | null;
  partygames_rank: number | null;
  strategygames_rank: number | null;
  thematic_rank: number | null;
  wargames_rank: number | null;
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseIntField(raw: string): number | null {
  if (!raw || raw === "0" || raw.toLowerCase() === "not ranked") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseRealField(raw: string): number {
  if (!raw) return 0;
  let n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) n = 0;
  if (n > 10) n = 10;
  return n;
}

function parseIntFieldDefault(raw: string, def: number): number {
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseBoolField(raw: string): boolean {
  return raw === "1";
}

function parseYearField(raw: string): number | null {
  if (!raw || raw === "0") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseRankField(raw: string): number | null {
  return parseIntField(raw);
}

function buildBatchUpsertQuery(rows: CsvRow[]): { query: string; params: (string | number | boolean | null)[] } {
  const nowMs = Date.now();
  const valueClauses: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  const COLS_PER_ROW = 18;
  let idx = 1;

  for (const row of rows) {
    const placeholders: string[] = [];
    for (let i = 0; i < COLS_PER_ROW; i++) {
      placeholders.push(`$${idx + i}`);
    }
    valueClauses.push(`(${placeholders.join(", ")})`);
    params.push(
      row.bgg_id,
      row.name,
      row.year_published,
      row.bgg_rank,
      row.bayes_average,
      row.average,
      row.users_rated,
      row.is_expansion,
      row.abstracts_rank,
      row.cgs_rank,
      row.childrensgames_rank,
      row.familygames_rank,
      row.partygames_rank,
      row.strategygames_rank,
      row.thematic_rank,
      row.wargames_rank,
      nowMs,
      nowMs
    );
    idx += COLS_PER_ROW;
  }

  const query = `
    INSERT INTO ${BGG_BOARDGAME_TABLE} (
      bgg_id, name, year_published, bgg_rank,
      bayes_average, average, users_rated, is_expansion,
      abstracts_rank, cgs_rank, childrensgames_rank, familygames_rank,
      partygames_rank, strategygames_rank, thematic_rank, wargames_rank,
      csv_imported_at, updated_at
    )
    VALUES ${valueClauses.join(",\n")}
    ON CONFLICT (bgg_id) DO UPDATE SET
      name = EXCLUDED.name,
      year_published = EXCLUDED.year_published,
      bgg_rank = EXCLUDED.bgg_rank,
      bayes_average = EXCLUDED.bayes_average,
      average = EXCLUDED.average,
      users_rated = EXCLUDED.users_rated,
      is_expansion = EXCLUDED.is_expansion,
      abstracts_rank = EXCLUDED.abstracts_rank,
      cgs_rank = EXCLUDED.cgs_rank,
      childrensgames_rank = EXCLUDED.childrensgames_rank,
      familygames_rank = EXCLUDED.familygames_rank,
      partygames_rank = EXCLUDED.partygames_rank,
      strategygames_rank = EXCLUDED.strategygames_rank,
      thematic_rank = EXCLUDED.thematic_rank,
      wargames_rank = EXCLUDED.wargames_rank,
      csv_imported_at = EXCLUDED.csv_imported_at,
      updated_at = EXCLUDED.updated_at
  `;

  return { query, params };
}

async function extractCsvText(request: Request): Promise<{ csvText: string; batchSize: number }> {
  let batchSize = 500;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw new Error("缺少 file 字段或文件无效");
    }
    const csvText = await file.text();
    const batchSizeRaw = formData.get("batchSize");
    if (batchSizeRaw) {
      const n = Number(batchSizeRaw);
      if (Number.isFinite(n) && n > 0) batchSize = Math.trunc(n);
    }
    return { csvText, batchSize };
  }

  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    const csvText = await request.text();
    return { csvText, batchSize };
  }

  throw new Error(`不支持的 Content-Type: ${contentType}，请使用 multipart/form-data 上传文件`);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sql = _getSqlClient();
  if (!sql || !(await _ensureSchema())) {
    return NextResponse.json({ ok: false, error: "database not available" }, { status: 503 });
  }

  let csvText: string;
  let batchSize: number;
  try {
    const result = await extractCsvText(request);
    csvText = result.csvText;
    batchSize = result.batchSize;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  if (!csvText.trim()) {
    return NextResponse.json(
      { ok: false, error: "CSV 文件内容为空" },
      { status: 400 },
    );
  }

  try {
    const lines = csvText.split(/\r?\n/);

    const startTime = Date.now();
    let headerMap: Record<string, number> | null = null;
    let batch: CsvRow[] = [];
    let totalRows = 0;
    let skippedRows = 0;
    let batchCount = 0;
    let upsertedRows = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

      if (!headerMap) {
        const headers = parseCsvLine(line).map((h) => h.trim().toLowerCase());
        headerMap = {};
        for (let i = 0; i < headers.length; i++) {
          headerMap[headers[i]] = i;
        }
        continue;
      }

      const fields = parseCsvLine(line);
      const get = (col: string) => {
        const colIdx = headerMap![col];
        return colIdx != null ? (fields[colIdx] ?? "").trim() : "";
      };

      const bggId = get("id");
      const name = get("name");

      if (!name || !/^\d+$/.test(bggId)) {
        skippedRows++;
        continue;
      }

      batch.push({
        bgg_id: bggId,
        name,
        year_published: parseYearField(get("yearpublished")),
        bgg_rank: parseRankField(get("rank")),
        bayes_average: parseRealField(get("bayesaverage")),
        average: parseRealField(get("average")),
        users_rated: parseIntFieldDefault(get("usersrated"), 0),
        is_expansion: parseBoolField(get("is_expansion")),
        abstracts_rank: parseRankField(get("abstracts_rank")),
        cgs_rank: parseRankField(get("cgs_rank")),
        childrensgames_rank: parseRankField(get("childrensgames_rank")),
        familygames_rank: parseRankField(get("familygames_rank")),
        partygames_rank: parseRankField(get("partygames_rank")),
        strategygames_rank: parseRankField(get("strategygames_rank")),
        thematic_rank: parseRankField(get("thematic_rank")),
        wargames_rank: parseRankField(get("wargames_rank")),
      });

      if (batch.length >= batchSize) {
        const { query, params } = buildBatchUpsertQuery(batch);
        await sql.query(query, params);
        upsertedRows += batch.length;
        batchCount++;
        totalRows += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      const { query, params } = buildBatchUpsertQuery(batch);
      await sql.query(query, params);
      upsertedRows += batch.length;
      batchCount++;
      totalRows += batch.length;
    }

    const elapsedMs = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      result: { totalRows, upsertedRows, skippedRows, batchCount, elapsedMs },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "import failed" },
      { status: 500 },
    );
  }
}
