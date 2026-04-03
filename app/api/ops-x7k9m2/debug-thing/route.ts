import { NextResponse } from "next/server";
import { fetchThingItems, bggToArray } from "@/lib/bgg/bgg-api";

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

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing ?id= parameter" }, { status: 400 });
  }

  try {
    const response = await fetchThingItems({
      id,
      type: "boardgame",
      stats: 1,
    });

    const items = bggToArray(response.items?.item);
    const result = items.map((item) => ({
      id: item.id,
      type: item.type,
      image: item.image,
      thumbnail: item.thumbnail,
      name: item.name,
      description: typeof item.description === "string" ? item.description.slice(0, 200) + "..." : item.description,
      yearpublished: item.yearpublished,
      minplayers: item.minplayers,
      maxplayers: item.maxplayers,
      playingtime: item.playingtime,
      minage: item.minage,
      link: item.link,
      statistics: item.statistics,
    }));

    return NextResponse.json({ ok: true, raw: result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
