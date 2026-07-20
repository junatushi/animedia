// ───────────────────────────────────────────────────────────────
// API ルート（収集①＋正規化②をつなぐ窓口）
//   GET /api/season?year=2026&season=spring
//   season は winter | spring | summer | autumn
//   トークンはここ（サーバー側）でだけ使われ、ブラウザには出ない。
// ───────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const season = searchParams.get("season");

  if (!year || !isValidYear(year) || !season || !isValidSeason(season)) {
    return NextResponse.json(
      { error: "year（4桁）と season（winter/spring/summer/autumn）を指定してください。" },
      { status: 400 }
    );
  }

  try {
    const body = await getSeasonData(year, season);
    // CDNエッジにもJSONを載せる（クエリ文字列ごとにキャッシュされる）。
    // s-maxage内はエッジが即応答、その後1日はstale-while-revalidateにより
    // 「古い値を即返しつつ裏で再取得」となるため、Vercelデータキャッシュが
    // 追い出されていても（過去年で実測5〜10秒コールドの原因）クライアントの
    // フェッチが再構築をブロックで待つことがなくなる（2026-07-21導入）。
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "取得に失敗しました。";
    const status = message.includes("ANNICT_TOKEN") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
