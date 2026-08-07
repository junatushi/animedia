// 直近で「配信サービスが新しく登録された」と確定したものを返す公開API（2026-08-07導入）。
// 検知の仕組みと、なぜ通知に繋がないかは lib/serviceAdditions.ts と docs/operations.md ⑱-13。
//
// ここは読み出し専用。表示側（SNS投稿の下書き・将来のサイト内表示）が使う。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { siteUrl } from "@/lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "service_sightings";
/** 何日ぶんまで遡って返すか。古い追加は「新しく分かったこと」ではないので出さない。 */
const WINDOW_DAYS = 14;
const MAX_ITEMS = 50;

export async function GET() {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // 未設定の間は空で返す（呼び出し側を壊さない）。
    return NextResponse.json({ items: [], configured: false });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("work_id, work_title, service_short, reported_on")
    .not("reported_on", "is", null)
    .gte("reported_on", since)
    .order("reported_on", { ascending: false })
    .limit(MAX_ITEMS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      configured: true,
      items: (data ?? []).map((r) => ({
        workId: r.work_id,
        title: r.work_title,
        service: r.service_short,
        reportedOn: r.reported_on,
        url: `${siteUrl}/anime/${r.work_id}`,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        // 公開データとして第三者からも読めるようにする（/api/season 等と揃える）。
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    }
  );
}
