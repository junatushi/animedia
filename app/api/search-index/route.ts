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

// 対象シーズン文字列を作る。年セレクタ（lib/resolveSeasonParams.ts の validYears）は
// 「今年」なら未来クールも含めて丸ごと選べる（例: 現在7月でも2026年秋を選んで閲覧できる）
// ため、インデックスもそれに合わせて当年は4クール全部を含める。以前は「現在の暦月までの
// クール」で打ち切っていたが、それだと年内の未来クール（閲覧可能）だけがインデックスから
// 漏れ、そのクールを見ている時だけ「他のクールの作品」欄に重複/非対称なヒット数が出る
// 不具合があった（実例: 2026年秋を見ながら「ジョジョ」を検索すると、当年秋クールの現在
// データ＋インデックス側で見つかる別クール分が合算されて2件に見えるのに、他のクールから
// 見ると同じインデックスの上限が壁になり1件しか出なかった）。
function targetSeasons(now: Date): string[] {
  const year = now.getFullYear();
  const seasons: string[] = [];
  for (let y = year - PAST_YEARS; y <= year; y++) {
    for (let s = 0; s < SEASON_ORDER.length; s++) {
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
