// 匿名行動ログの記録エンドポイント。Vercel Web Analyticsの無料プランではカスタム
// イベントがダッシュボードに表示されない（Proプラン=月$20が必要）ため、既に
// 導入済みのSupabase（無料枠のPostgres）に自前で記録し、/admin/analyticsで見る。
// クッキー・IPアドレス・ユーザーIDは一切記録しない（匿名の行動イベントのみ）。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// クライアント（components/SeasonExplorer.tsx・components/ServiceMarks.tsx）が送る
// イベント名のみ許可する（任意の値の書き込みを防ぐ）。
const ALLOWED_EVENTS = new Set([
  "share_site",
  "share_work",
  "favorite_add",
  "watched_add",
  "notify_add",
  "filter_service",
  "filter_cast",
  "change_season",
  "affiliate_click",
  "official_link_click",
]);

export async function POST(request: Request) {
  // 外部セットアップ未完了（Supabase/service role key未設定）の間は静かに無視する。
  // ユーザーの操作（共有・お気に入り等）自体は計測の成否に関わらず動くべきなので、
  // ここでエラーを返してクライアント側の体験を邪魔しない。
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ skipped: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { event, data } = (body ?? {}) as { event?: unknown; data?: unknown };
  if (typeof event !== "string" || !ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  }
  // dataは付随情報（例: { service: "d_anime" }）のみ想定。プレーンオブジェクト以外は捨てる
  // （個人情報が紛れ込む余地を作らない。呼び出し元も文字列程度しか渡していない）。
  const eventData =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("analytics_events")
    .insert({ event_name: event, event_data: eventData });
  if (error) {
    // 計測の失敗はユーザー体験に影響させない（500を返さずログ的に握りつぶす）。
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}
