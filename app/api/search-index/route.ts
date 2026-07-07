// クール横断キーワード検索用の軽量インデックスを返すAPI。
// programs/casts のような重いデータは含めず、タイトル・読み仮名・年・季節だけを
// 直近数年分まとめて返す。日次でしか変わらないので revalidate を長めに取る。
import { NextResponse } from "next/server";
import { fetchWorksIndex } from "@/lib/annict";

// 1日1回だけ実データを取り直す（＝Annictへの問い合わせも実質1日1回）。
export const revalidate = 86400;

const SEASON_ORDER = ["winter", "spring", "summer", "autumn"] as const;

// 直近何年分をインデックス化するか（当年＋過去 PAST_YEARS 年）。
const PAST_YEARS = 2;

function currentSeasonIndex(month: number): number {
  if (month <= 3) return 0; // winter
  if (month <= 6) return 1; // spring
  if (month <= 9) return 2; // summer
  return 3; // autumn
}

// 当年の現在クールまで、過去 PAST_YEARS 年分を遡って対象シーズン文字列を作る。
function targetSeasons(now: Date): string[] {
  const year = now.getFullYear();
  const curIdx = currentSeasonIndex(now.getMonth() + 1);
  const seasons: string[] = [];
  for (let y = year - PAST_YEARS; y <= year; y++) {
    for (let s = 0; s < SEASON_ORDER.length; s++) {
      // 当年は現在クールまで（未来クールは含めない）。
      if (y === year && s > curIdx) break;
      seasons.push(`${y}-${SEASON_ORDER[s]}`);
    }
  }
  return seasons;
}

export async function GET() {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "ANNICT_TOKEN 未設定" }, { status: 500 });
  }

  try {
    const seasons = targetSeasons(new Date());
    const entries = await fetchWorksIndex(seasons, token);
    return NextResponse.json(
      { count: entries.length, entries },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "取得に失敗しました" },
      { status: 502 }
    );
  }
}
