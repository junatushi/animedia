// 行動ログ共通処理（クライアント側から呼ぶ）。Vercel Web Analytics（無料プランは
// カスタムイベントがダッシュボードに出ない）に加えて、自前の /api/track にも送る
// （Supabase無料枠に記録し、/admin/analyticsで見る）。
// 計測はユーザー操作の成否に影響してはいけないため、失敗しても握りつぶす（catchのみ）。
// 送れるイベント名は app/api/track/route.ts の ALLOWED_EVENTS で許可制。
import { track } from "@vercel/analytics";

export function logEvent(event: string, data?: Record<string, string | number | boolean | null>) {
  track(event, data);
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
    keepalive: true,
  }).catch(() => {
    // オフライン・Supabase未設定時等は無視する（体験は既存のtrack()同様に壊さない）
  });
}
