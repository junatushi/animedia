// 現在クール＋次クールのページだけを「オンデマンドで」再検証するバッチ（2026-08-25導入。
// 2026-09-03に次クールを追加）。GitHub Actions（.github/workflows/revalidate.yml）から
// 1日2回、x-cron-secret ヘッダー付きで叩かれる。人間のブラウザからは使わない。
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
import { currentYearSeason, nextYearSeason } from "@/lib/resolveSeasonParams";
import { getSeasonData } from "@/lib/getSeasonData";
import { workCacheTag } from "@/lib/annict";

// 秘密の照合とrevalidatePathはリクエストごとに必ず走らせる（キャッシュさせない）。
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 認証は既存のバッチ（/api/notify/run）と同じ秘密・同じヘッダーを使い回す。
  // 新しいシークレットを増やすと設定漏れでバッチが黙って止まるため。
  const cronSecret = process.env.NOTIFY_CRON_SECRET;
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 【2026-10-01追加】対象クールを1つに絞れるようにする（`?scope=current` / `?scope=next`）。
  // 省略時は従来どおり両方＝後方互換（ワークフロー以外から叩かれても壊れない）。
  //
  // 分けた理由は2つある。
  // ①この窓口は対象作品を数えるために getSeasonData を呼ぶ。今期はライブ取得なので
  //   キャッシュが冷えていると**1クールで数十秒**かかる（2026-10-01実測で33.8〜39.9秒）。
  //   2クールを1リクエストでやるとサーバーレス関数の実行上限に当たりうる。
  // ②下の `warm` を使って呼び出し側がクールごとに「消す→温める」を完結させられる
  //   （片方のクールの温めが失敗しても、もう片方は温まった状態で終わる）。
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== null && scope !== "current" && scope !== "next") {
    // 黙って「両方」に倒さない（綴り間違いが、効いていないのに成功として記録される）。
    return NextResponse.json({ error: "scope must be 'current' or 'next'" }, { status: 400 });
  }

  const { year, season } = currentYearSeason();
  // 次クールも対象にする（2026-09-03追加）。2026-08-31から次クールの作品ページと
  // シーズンページをsitemapに載せている（app/sitemap.ts）。配信先の発表は9月中旬〜
  // 10月上旬に集中する（docs/next-season-coverage.md）ので、いちばん内容が動く時期の
  // ページを1週間TTLに任せると古い情報を出し続ける。対象の作り方をsitemapと
  // 揃えるため nextYearSeason は lib/resolveSeasonParams.ts の共有版を使う。
  const nx = nextYearSeason(Number(year), season);
  const allTargets = [
    { scope: "current", year, season },
    { scope: "next", year: String(nx.year), season: nx.season },
  ];
  const targets = scope ? allTargets.filter((t) => t.scope === scope) : allTargets;

  // クール単位のページ。作品数に関わらず必ず対象にする（＝ここは作品数が増えても伸びない）。
  // トップは今期を出すので、今期が対象のときだけ入れる。
  const seasonPaths: string[] = scope === "next" ? [] : ["/"];
  for (const t of targets) {
    seasonPaths.push(
      `/season/${t.year}/${t.season}`,
      `/rankings/${t.year}/${t.season}`,
      `/exclusive/${t.year}/${t.season}`
    );
  }
  const paths: string[] = [...seasonPaths];

  // 対象クールの作品ページ。getSeasonData はキャッシュ済みなので追加のAnnict往復は
  // 基本的に発生しない。取得に失敗してもクール単位のページの再検証は続ける
  // （1つの失敗で全部を巻き添えにしない＝CLAUDE.mdの外部API方針と同じ）。
  //
  // 【2026-09-03変更】作品のデータ層は一律の "annict" ではなく**作品ごとのタグ**で
  // 古くする。従来は revalidateTag("annict") 1回で全作品のキャッシュを捨てており、
  // 過去クール1,961件のページまで12時間ごとに作り直されていた（実測で /anime/[id] が
  // 全ルート中Active CPU 1位・起動回数の71%）。ここで名指しする作品だけが対象になる。
  const workTags: string[] = [];
  let workCount = 0;
  const seasonErrors: string[] = [];
  for (const t of targets) {
    try {
      const data = await getSeasonData(t.year, t.season);
      for (const item of data.items) {
        paths.push(`/anime/${item.id}`);
        workTags.push(workCacheTag(item.id));
      }
      workCount += data.items.length;
    } catch (e) {
      seasonErrors.push(`${t.year}-${t.season}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // データ層（fetch / unstable_cache）はページの再検証では古くならないので、タグで別に
  // 指名する。これが無いとページだけ作り直され、中身は古いキャッシュのまま出てしまう。
  //   "annict"        … lib/annict.ts のクール一括・索引の応答（TTL 1週間）
  //   "season-current"… lib/getSeasonData.ts の現在クール（TTL 1時間・安全網として据え置き）
  //   annict-work-<id>… 対象クールの作品1件ぶん（lib/annict.ts の workCacheTag）
  //
  // 【2026-10-01】**共有のタグは scope=next では古くしない。**
  // "annict" と "season-current" は**今期と次クールの両方**が同じ1枚を使う
  // （lib/getSeasonData.ts の getCachedCurrentYearSeasonData は年で分けていない）。
  // クールごとに分けて呼ぶとき、2回目でもう一度古くすると
  // **1回目に温めたぶんが冷える**（温めた意味が消える）。
  // 呼び出し側は current → next の順に叩くので、1回目の古くしでどちらのクールの
  // データも対象になり、next 側は自分のぶんを温め直すだけでよい。
  // `?scope=next` だけを単独で叩いた場合、共有データの鮮度は時間ベースのTTL
  // （CURRENT_YEAR_REVALIDATE）に委ねる。
  if (scope !== "next") {
    revalidateTag("annict");
    revalidateTag("season-current");
  }
  // 作品1件ぶんのタグはクールごとに別物なので、どちらのscopeでも必ず古くする。
  for (const tag of workTags) {
    revalidateTag(tag);
  }

  for (const path of paths) {
    revalidatePath(path);
  }

  // 【2026-10-01追加】**消したあとに温める先**を呼び出し側へ返す。
  //
  // revalidatePath / revalidateTag は Vercel では対象を**消す**（staleにして裏で作り直す
  // のではない）。アクセスが薄いサイトでは消えたまま数時間残り、**次に来た1人が
  // その場生成の全額を払う**。2026-10-01の計測で今期の4面の初回が33.8〜39.9秒に
  // なったのがこれで、同じ計測の中で消去対象でない今期面（/service/…）だけが0.77秒だった。
  //
  // 温めるのは**クール単位の面だけ**（作品ページは件数に比例するので入れない＝
  // 作品数が増えてもこの窓口の仕事は増えない）。作品ページのコールドコストは
  // lib/withTimeout.ts の上限で抑える。
  //   data … /api/season を先に叩いてデータ層（unstable_cache）を温める。
  //          ページを直接温めるより先にこれを通すと、ページ側の温めが軽くなる。
  //          **必ず `?` を含む形で返す**（呼び出し側が `&_warm=<時刻>` を足して
  //          CDNキャッシュを避け、関数が確実に走るようにする。`/api/season` は
  //          s-maxage 付きなので、そのまま叩くと関数が走らずデータ層が温まらない）。
  //   pages… 上の seasonPaths と同一（ここで別に並べるとズレる）。
  return NextResponse.json({
    year,
    season,
    seasons: targets.map((t) => `${t.year}-${t.season}`),
    works: workCount,
    revalidated: paths.length,
    warm: {
      data: targets.map((t) => `/api/season?year=${t.year}&season=${t.season}`),
      pages: seasonPaths,
    },
    ...(seasonErrors.length ? { seasonErrors } : {}),
  });
}
