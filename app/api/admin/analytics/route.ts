// 自前計測（Supabase の analytics_events）の集計を JSON で返す運営者専用の窓口。
//
// 【なぜ要るか・2026-08-19】
// 集計は `/admin/analytics` の画面にしか無く、**ブラウザで開く以外に読む方法が無かった**。
// そのためセッション（Claude）は実測値を一度も読めておらず、
// 「未提携サービスへのクリックが多い順に提携する」（docs/affiliate-setup.md の
// 「順番を決め直すときの一次情報」）という判断が、ユーザーが手で数字を写すまで
// 止まったままだった。GSC と同じ形（GitHub Actions が取ってリポジトリに置き、
// セッションはコミット済みのJSONを読む）に載せるための入口がこれ。
// 取得と保存は `scripts/fetch-site-analytics.js`。
//
// 【守っていること】
// ・画面と**同じ集計**（`lib/adminAnalytics.ts`）を通す。ここで別集計を書くと
//   画面とJSONで数字がズレ、どちらが正か分からなくなる。
// ・認証は画面と同じ「固定シークレットの一致」。**不一致・未指定は404**（存在しない
//   ページと同じ扱い＝不一致の理由を教えない）。
// ・トークンはクエリではなく **`x-admin-token` ヘッダー**でも受ける。機械から叩く経路では
//   URLに秘密を載せない方が漏れにくい（ログ・リファラに残らない）ため、そちらを既定にする。
// ・**noindex**（robots.txt で /admin は除外済みだが、ここは /api 配下なので明示する）。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildSnapshot, MAX_ROWS, WINDOW_DAYS, type EventRow } from "@/lib/adminAnalytics";

// 集計対象は毎回最新にする（キャッシュされた古い数字を運営者に見せない）。
export const dynamic = "force-dynamic";

const NOINDEX = { "X-Robots-Tag": "noindex, nofollow" } as const;

export async function GET(request: Request) {
  const adminToken = process.env.ADMIN_DASHBOARD_TOKEN;
  // 未設定の間は「静かにスキップ」する（/api/track・watched・notify と同じ設計思想）。
  // ここを404にすると、セットアップ漏れと設定ミスを取り違える。
  if (!adminToken) {
    return NextResponse.json(
      { configured: false, reason: "ADMIN_DASHBOARD_TOKEN が未設定です（docs/operations.md「計測の見かた」）" },
      { headers: NOINDEX }
    );
  }

  const url = new URL(request.url);
  const provided = request.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (provided !== adminToken) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NOINDEX });
  }

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { configured: false, reason: "Supabaseが未設定です（analytics_events テーブルと環境変数）" },
      { headers: NOINDEX }
    );
  }

  const supabase = createServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);

  const { data, error } = await supabase
    .from("analytics_events")
    .select("event_name, event_data, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    // 取得失敗は500で返す。呼び出し側（fetch-site-analytics.js）が一時エラーとして
    // 再試行できるようにするため、200で「失敗」を返さない。
    return NextResponse.json({ error: error.message }, { status: 500, headers: NOINDEX });
  }

  return NextResponse.json(
    { configured: true, ...buildSnapshot((data ?? []) as EventRow[]) },
    { headers: NOINDEX }
  );
}
