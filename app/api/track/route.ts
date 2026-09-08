// 匿名行動ログの記録エンドポイント。Vercel Web Analyticsの無料プランではカスタム
// イベントがダッシュボードに表示されない（Proプラン=月$20が必要）ため、既に
// 導入済みのSupabase（無料枠のPostgres）に自前で記録し、/admin/analyticsで見る。
// クッキー・IPアドレス・ユーザーIDは一切記録しない（匿名の行動イベントのみ）。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeEventData } from "@/lib/trackEventData";

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
  // 配信先ウィジェットの貼り付けコードがコピーされた（2026-08-06追加）。
  // 被リンク施策の実測用: コピー数 と、埋め込み経由の流入（?ref=embed）を突き合わせる。
  "embed_copy",
  // フッターのフォロー導線（2026-08-06追加。components/FollowLinks.tsx）
  "follow_click",
  // カレンダー購読リンクが押された（2026-08-07追加。app/calendar.ics）。
  // 購読は一度されると継続的に接触できるので、フォローと並べて効果を見る。
  "calendar_subscribe",
  // 視聴プラン（お気に入りを全部見るのに必要な最小のサービス組み合わせ）が開かれた
  // （2026-08-07追加。components/SeasonExplorer.tsx / lib/servicePlan.ts）。
  // 加入判断に最も近い操作なので、affiliate_click と並べて転換を見る。
  "plan_open",
  // 実利用者の表示速度（2026-09-06追加。components/WebVitals.tsx）。
  // data は { LCP, CLS, INP, FCP, TTFB, face } で、1ページビューにつき1件だけ届く。
  // このサイトは「2秒未満」を目標にしながら実利用者の速度を一度も測っていなかった
  // （PSIのラボ値はノイズ±300ms・CrUXにデータ無し・@vercel/analyticsはCWVを測らない）。
  "web_vitals",
  // 外から来た経路のホスト名（2026-09-06追加。同上）。
  // data は { ref: ホスト名, face }。**生のURLは保存しない**（検索語を含みうるため）。
  // これが無いと docs/ai-era-strategy-2026-08-13.md の「AI検索からの流入が
  // 月1件以上あるか」という判定が、実際に流入があっても0件のまま期限を迎える。
  "page_view",
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
  // dataは付随情報（例: { service: "d_anime" }）のみ想定。
  //
  // 【重要】ここは**無認証の口**で、しかも書いた値が
  // Supabase → lib/adminAnalytics.ts → content/analytics/site/<日付>.json → main へのコミット
  // と伝わり、docs/daily-ops.md が「毎日読む」と指示しているファイルに載る。
  // 以前は「プレーンオブジェクトか」しか見ておらず、**誰でも任意の文章を
  // リポジトリの「実測データ」に載せられた**（偽の流入元の捏造・指示の注入）。
  // 判定の中身と経緯は lib/trackEventData.ts の冒頭。**この検証を外さないこと。**
  const eventData = sanitizeEventData(data);

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
