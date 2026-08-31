// 現在クールのページだけを「オンデマンドで」再検証するバッチ（2026-08-25導入）。
// GitHub Actions（.github/workflows/revalidate.yml）から1日2回、x-cron-secret ヘッダー付きで
// 叩かれる。人間のブラウザからは使わない。
//
// 【なぜ必要になったか】
// 2026-08-24にVercel Hobbyの ISR Writes 上限（30日で200,000）を296,449件で超過し、
// サイトがPausedになった。原因は「時間ベースのISR（revalidate=N秒）が、アクセスが薄く
// 分散した長い裾に対して機能していなかった」こと。
//
// 実測（超過時の30日）: Edge Requests 10,300件/日 に対し ISR Writes 9,882件/日 ＝ **96%**。
// つまりリクエストのほぼ全部が「キャッシュから配る」ではなく「作り直す」になっていた。
// sitemapに載せている約7,051ページへ1日10,300リクエストが分散すると、1ページあたりの
// 再訪間隔は平均16.4時間になる。revalidate がこれより短いと、訪問のたびに必ず期限切れに
// 当たり、毎回ISR書き込みが起きる。900秒でも3600秒でも16.4時間より遥かに短いので、
// **PR #97で900→3600に延ばしても書き込みは1件も減らなかった**（この点は当初の見積もりが
// 誤っていた。docs/operations.md の㉝-2に訂正を記録した）。
//
// 【この設計】
// 長い裾のページ（作品・声優・サービス別・過去クール）の revalidate を再訪間隔より
// 十分に長い1週間へ延ばし、**時間による再生成を実質止める**。そのうえで、本当に鮮度が
// 要るページ＝現在クールのぶんだけをここで明示的に指名して古くする。
// revalidatePath は「次にアクセスされたときに作り直す」印を付けるだけなので、
// 誰も見に来ないページは書き込みが発生しない（＝呼んだ数ぶん課金されるわけではない）。
//
// 対象を現在クールに絞る理由: 過去クールの内容は content/snapshots/ の確定データ由来で
// **動かない**。動かないものを定期的に作り直すのが今回の超過の本質だった。
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { currentYearSeason } from "@/lib/resolveSeasonParams";
import { getSeasonData } from "@/lib/getSeasonData";

// 秘密の照合とrevalidatePathはリクエストごとに必ず走らせる（キャッシュさせない）。
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 認証は既存のバッチ（/api/notify/run）と同じ秘密・同じヘッダーを使い回す。
  // 新しいシークレットを増やすと設定漏れでバッチが黙って止まるため。
  const cronSecret = process.env.NOTIFY_CRON_SECRET;
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { year, season } = currentYearSeason();

  // クール単位のページ。作品数に関わらず必ず対象にする。
  const paths: string[] = [
    "/",
    `/season/${year}/${season}`,
    `/rankings/${year}/${season}`,
    `/exclusive/${year}/${season}`,
  ];

  // 現在クールの作品ページ。getSeasonData はキャッシュ済みなので追加のAnnict往復は
  // 基本的に発生しない。取得に失敗してもクール単位のページの再検証は続ける
  // （1つの失敗で全部を巻き添えにしない＝CLAUDE.mdの外部API方針と同じ）。
  let workCount = 0;
  let seasonError: string | null = null;
  try {
    const data = await getSeasonData(year, season);
    for (const item of data.items) {
      paths.push(`/anime/${item.id}`);
    }
    workCount = data.items.length;
  } catch (e) {
    seasonError = e instanceof Error ? e.message : String(e);
  }

  // データ層（fetch / unstable_cache）はページの再検証では古くならないので、タグで別に
  // 指名する。これが無いとページだけ作り直され、中身は古いキャッシュのまま出てしまう。
  //   "annict"        … lib/annict.ts のGraphQL応答（TTL 1週間）
  //   "season-current"… lib/getSeasonData.ts の現在クール（TTL 1時間・安全網として据え置き）
  revalidateTag("annict");
  revalidateTag("season-current");

  for (const path of paths) {
    revalidatePath(path);
  }

  return NextResponse.json({
    year,
    season,
    works: workCount,
    revalidated: paths.length,
    ...(seasonError ? { seasonError } : {}),
  });
}
