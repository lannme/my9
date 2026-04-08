import { NextResponse } from "next/server";
import { fetchThingItems, bggToArray } from "@/lib/bgg/bgg-api";
import { getBggBoardgamesByIds, upsertBggBoardgameCovers } from "@/lib/bgg/local-search";

export const runtime = "nodejs";

const MAX_IDS = 20;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");

  if (!idsParam) {
    return NextResponse.json({ ok: false, error: "missing ids" }, { status: 400 });
  }

  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, covers: {} });
  }

  const covers: Record<string, string> = {};
  const missingIds: string[] = [];

  try {
    const rows = await getBggBoardgamesByIds(ids);
    for (const row of rows) {
      if (row.cover) {
        covers[row.bgg_id] = row.cover;
      } else {
        missingIds.push(row.bgg_id);
      }
    }

    const foundSet = new Set(rows.map((r) => r.bgg_id));
    for (const id of ids) {
      if (!foundSet.has(id)) {
        missingIds.push(id);
      }
    }
  } catch {
    for (const id of ids) {
      missingIds.push(id);
    }
  }

  if (missingIds.length === 0) {
    return NextResponse.json({ ok: true, covers });
  }

  try {
    const response = await fetchThingItems({
      id: missingIds.join(","),
      type: "boardgame",
      stats: 0,
    });

    const upsertData: Array<{ bgg_id: string; cover: string; thumbnail: string | null }> = [];

    for (const thing of bggToArray(response.items?.item)) {
      if (!thing.id) continue;
      const id = String(thing.id);
      const cover = thing.image || thing.thumbnail || null;
      if (cover) {
        covers[id] = cover;
        upsertData.push({
          bgg_id: id,
          cover,
          thumbnail: (typeof thing.thumbnail === "string" && thing.thumbnail) || null,
        });
      }
    }

    if (upsertData.length > 0) {
      upsertBggBoardgameCovers(upsertData).catch(() => {});
    }
  } catch {
    // BGG API failed, return what we have
  }

  return NextResponse.json(
    { ok: true, covers },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } },
  );
}
