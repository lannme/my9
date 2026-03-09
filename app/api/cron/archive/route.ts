import { NextResponse } from "next/server";
import { archiveHotSharesToColdStorage } from "@/lib/share/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

const DEFAULT_OLDER_THAN_DAYS = parsePositiveInt(process.env.MY9_ARCHIVE_OLDER_THAN_DAYS, 30);
const DEFAULT_BATCH_SIZE = parsePositiveInt(process.env.MY9_ARCHIVE_BATCH_SIZE, 500);
const DEFAULT_CLEANUP_TREND_DAYS = parsePositiveInt(process.env.MY9_ARCHIVE_CLEANUP_TREND_DAYS, 190);

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
      },
      { status: 401 }
    );
  }

  try {
    const result = await archiveHotSharesToColdStorage({
      olderThanDays: DEFAULT_OLDER_THAN_DAYS,
      batchSize: DEFAULT_BATCH_SIZE,
      cleanupTrendDays: DEFAULT_CLEANUP_TREND_DAYS,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      config: {
        olderThanDays: DEFAULT_OLDER_THAN_DAYS,
        batchSize: DEFAULT_BATCH_SIZE,
        cleanupTrendDays: DEFAULT_CLEANUP_TREND_DAYS,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "archive failed",
      },
      { status: 500 }
    );
  }
}

