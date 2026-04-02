import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
  }

  let body: { password?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
  }

  if (body.password === cronSecret) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
}
