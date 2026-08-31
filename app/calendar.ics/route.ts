import { getSeasonData } from "@/lib/getSeasonData";
import { SERVICES, splitRentalServices } from "@/lib/services";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import { buildCalendar, type CalendarWork } from "@/lib/calendar";
import { currentYearSeason } from "@/lib/resolveSeasonParams";

// 放送・配信スケジュールの iCalendar 配信（2026-08-07導入）。
// 経緯・設計理由は lib/calendar.ts の冒頭コメントと docs/growth-strategy-2026-08.md。
//
// 購読URL:
//   /calendar.ics                  … 今期の全作品
//   /calendar.ics?service=d_anime  … 今期のうち、そのサービスで見られる作品だけ
//
// ディレクトリ名にドットを含めるのは app/feed.xml/route.ts と同じ書き方。
//
// キャッシュ: 放送予定は日単位でしか動かないので、シーズンデータと同じ 900 秒。
// 購読クライアント（Googleカレンダー等）は数時間〜1日に1回しか取りに来ないため、
// これで十分に新しい。
// 【2026-08-25変更】900秒 → 3600秒（1時間）。Vercel Hobbyの ISR Writes 上限
// （30日で200,000）を296,449件で超過しプロジェクトがPausedになったため。再検証の間隔を
// 延ばすと、①再生成の回数がそのまま減る（ISR Writes・Fluid CPU・Provisioned Memoryの
// 3指標すべてに効く）②キャッシュが効いている時間が長くなるので**表示はむしろ速くなる**。
// ISRは期限切れ後も stale-while-revalidate で古いHTMLを即座に返しつつ裏で作り直すので、
// 期限を延ばしても訪問者が待たされる場面は増えない。Annictの配信情報はコミュニティ更新で
// 分単位に動くものではなく、1時間の鮮度で困る用途がこのサイトには無い。経緯はdocs/operations.md。
export const revalidate = 3600;

const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serviceKey = url.searchParams.get("service");
  const service = serviceKey ? SERVICES.find((s) => s.key === serviceKey) ?? null : null;
  // 存在しないサービスキーが来たら 404（薄い・意味のないカレンダーを配らない）。
  if (serviceKey && !service) {
    return new Response("Unknown service key", { status: 404 });
  }

  const { year, season } = currentYearSeason();

  let works: CalendarWork[] = [];
  try {
    const data = await getSeasonData(year, season);
    for (const it of data.items) {
      if (service) {
        // 「見放題で見られる」ものだけを対象にする。レンタル/都度課金は
        // 「このサービスを契約していれば見られる」ではないのでカレンダーには入れない。
        const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
        if (!streaming.some((s) => s.key === service.key)) continue;
      }
      works.push({
        id: it.id,
        title: it.title,
        services: it.services.map((s) => ({ key: s.key, short: s.short })),
        otherServices: it.otherServices ?? [],
        broadcastStartDate: it.broadcastStartDate,
        broadcastTime: it.broadcastTime,
      });
    }
  } catch {
    // Annictが落ちているときに壊れたカレンダーで購読者の予定表を上書きしないよう、
    // 空のカレンダーではなく 503 を返す（購読クライアントは前回の内容を保持する）。
    return new Response("Upstream unavailable", { status: 503 });
  }

  const body = buildCalendar(works, {
    serviceName: service?.name ?? null,
    seasonLabel: `${year}年${SEASON_LABEL[season] ?? ""}`,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // 購読リンクとして開かれるので inline（ダウンロード保存を強制しない）。
      "Content-Disposition": 'inline; filename="animedia.ics"',
      // 【2026-08-25変更】900 → 3600。カレンダー購読アプリの取得間隔はおおむね
      // 1時間以上なので、15分で切らす意味が無かった。
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      // 公開データなので、他サイトのカレンダーツールからも読めるようにする。
      "Access-Control-Allow-Origin": "*",
    },
  });
}
