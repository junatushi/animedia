// ───────────────────────────────────────────────────────────────
// 作品1件の配信情報を返す公開API。
//   GET /api/work/{annictId}
//
// なぜ作るか（2026-08-06）:
//   既存の公開窓口は /api/season（クール一括）と /api/search-index（検索用の軽量索引）
//   だけで、「この作品はどこで配信されているか」を1件だけ引く手段が無かった。これは
//   埋め込みウィジェットを自作したい人・Discordボット等を作りたい人が最初に欲しがる形で、
//   外部で使われること自体が言及と被リンクの源になる（docs/operations.md ⑯）。
//
// 返す形は内部型（AnimeDetail）をそのまま出さず、外部に約束できる最小限に絞る。
// 内部の都合（検索用の creditNames など）が外部の互換性を縛らないようにするため。
// ───────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { apiSource } from "@/lib/attribution";
import { getWorkData } from "@/lib/getWorkData";
import { siteUrl } from "@/lib/siteUrl";
import { parseWorkId } from "@/lib/workId";
import { airingStatus, jstToday } from "@/lib/workAvailability";

// 【2026-08-25変更】900秒 → 3600秒（1時間）。Vercel Hobbyの ISR Writes 上限
// （30日で200,000）を296,449件で超過しプロジェクトがPausedになったため。再検証の間隔を
// 延ばすと、①再生成の回数がそのまま減る（ISR Writes・Fluid CPU・Provisioned Memoryの
// 3指標すべてに効く）②キャッシュが効いている時間が長くなるので**表示はむしろ速くなる**。
// ISRは期限切れ後も stale-while-revalidate で古いHTMLを即座に返しつつ裏で作り直すので、
// 期限を延ばしても訪問者が待たされる場面は増えない。Annictの配信情報はコミュニティ更新で
// 分単位に動くものではなく、1時間の鮮度で困る用途がこのサイトには無い。経緯はdocs/operations.md。
// 【2026-08-25変更（2回目）】3600 → 604800（1週間）。
// 同日に900→3600へ延ばしたが、**それでは書き込みは1件も減らない**ことが実測で判明した。
// 超過時の30日で Edge Requests 10,300件/日 に対し ISR Writes 9,882件/日＝96%。
// sitemapの約7,051ページへ1日10,300リクエストが分散すると1ページあたりの再訪間隔は
// 平均16.4時間になり、revalidateがそれより短い限り訪問のたびに必ず期限切れ＝毎回書き込みに
// なる。900秒でも3600秒でも16.4時間より遥かに短いので効果が無かった。
// そこで再訪間隔より十分長い1週間にして「時間による再生成」を止め、鮮度が要る現在クールは
// /api/revalidate（.github/workflows/revalidate.yml が1日2回叩く）で明示的に指名する方式に
// 変えた。表示速度は落ちない（stale-while-revalidateで古いHTMLを即座に返す設計は同じで、
// むしろキャッシュに当たる時間が長くなる）。経緯は docs/operations.md の㉝。
export const revalidate = 604800;

// 第三者のサイト・スクリプトから直接叩けるようにする（公開データとしての宣言）。
// 認証情報は載せないため Allow-Origin は * でよい。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseWorkId(params.id);
  if (id === null) {
    return NextResponse.json(
      { error: "作品ID（Annict の annictId）を整数で指定してください。" },
      { status: 400, headers: CORS }
    );
  }

  let item;
  try {
    item = await getWorkData(id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "取得に失敗しました。";
    return NextResponse.json(
      { error: message },
      { status: message.includes("ANNICT_TOKEN") ? 500 : 502, headers: CORS }
    );
  }
  if (!item) {
    return NextResponse.json({ error: "作品が見つかりません。" }, { status: 404, headers: CORS });
  }

  const checkedAt = jstToday();

  return NextResponse.json(
    {
      id: item.id,
      title: item.title,
      url: `${siteUrl}/anime/${item.id}`,
      officialSiteUrl: item.officialSiteUrl,
      media: item.media,
      watchers: item.watchers,
      // 見放題として判定できた国内配信サービス。key は lib/services.ts の正準キー。
      services: item.services.map((s) => ({ key: s.key, name: s.name, short: s.short })),
      // SERVICES に未登録のチャンネル名（＝「その他配信」）。名前のみ。
      otherServices: item.otherServices,
      // Annict に放送/配信の記録が1件でもあるか。services が空のとき
      // 「データ自体が無い」のか「TV放送のみ」なのかを区別するのに使う。
      hasBroadcastData: item.hasBroadcastData,
      broadcastStartDate: item.broadcastStartDate,
      broadcastWeekday: item.broadcastWeekday,
      broadcastTime: item.broadcastTime,
      // "airing"（現在クール以降）か "finished"（放送が終わったクール）か。
      // services は Annict の**番組表の記録**であって現在の配信可否の確認ではないため、
      // "finished" の作品に「配信中」と書くと未確認の主張になる。二次利用する側が
      // 同じ誤りを繰り返さずに済むよう、判定結果をそのまま公開する
      // （判定ロジックは lib/workAvailability.ts）。
      airingStatus: airingStatus(
        item.broadcastStartDate ?? item.releaseDate?.date ?? null,
        checkedAt
      ),
      // データの出所。二次利用する側が出典を書けるように明示する。
      // 定義は lib/attribution.ts に集約（/api/season とも同じ形にする）。
      source: apiSource(checkedAt),
    },
    {
      headers: {
        ...CORS,
        // 【2026-08-25変更】900 → 86400（1日）。理由は app/embed/anime/[id]/route.ts と同じ
        // （Route Handler なので revalidate ではなくこのヘッダが実効値。二次利用側から
        // 繰り返し叩かれる長い裾で、15分ごとに関数が起動していた）。
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
