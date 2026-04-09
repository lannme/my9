import { NextRequest, NextResponse } from "next/server";
import { getShare } from "@/lib/share/storage";
import { analyzePersonality, getCachedPersonalityResult } from "@/lib/personality/analyze";
import {
  toCompactSharePayload,
  createContentHash,
} from "@/lib/share/compact";
import type { PersonalityApiResponse } from "@/lib/personality/types";

export const runtime = "nodejs";

function resolveContentHash(share: {
  kind: string;
  creatorName: string | null;
  games: Array<unknown | null>;
}) {
  const { payload } = toCompactSharePayload(
    share.games as Parameters<typeof toCompactSharePayload>[0],
  );
  return createContentHash({
    kind: share.kind,
    creatorName: share.creatorName,
    payload,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse<PersonalityApiResponse>> {
  try {
    const shareId = request.nextUrl.searchParams.get("shareId")?.trim();
    if (!shareId) {
      return NextResponse.json({ ok: false, error: "缺少 shareId" }, { status: 400 });
    }

    const share = await getShare(shareId);
    if (!share) {
      return NextResponse.json({ ok: false });
    }

    const contentHash = resolveContentHash(share);
    const personality = await getCachedPersonalityResult(contentHash);

    if (personality) {
      return NextResponse.json({ ok: true, personality, cached: true });
    }

    return NextResponse.json({ ok: false });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<PersonalityApiResponse>> {
  try {
    const body = await request.json();
    const { shareId } = body ?? {};

    if (typeof shareId !== "string" || !shareId.trim()) {
      return NextResponse.json({ ok: false, error: "缺少 shareId" }, { status: 400 });
    }

    const share = await getShare(shareId.trim());
    if (!share) {
      return NextResponse.json({ ok: false, error: "分享页面未找到" }, { status: 404 });
    }

    const filledCount = share.games.filter((g) => g !== null).length;
    if (filledCount < 3) {
      return NextResponse.json({ ok: false, error: "至少需要填写3个格子才能分析" }, { status: 400 });
    }

    const contentHash = resolveContentHash(share);

    const { personality, cached } = await analyzePersonality({
      contentHash,
      kind: share.kind,
      creatorName: share.creatorName,
      games: share.games,
    });

    return NextResponse.json({
      ok: true,
      personality,
      cached,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "分析失败";
    console.error("[personality] analyze error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
