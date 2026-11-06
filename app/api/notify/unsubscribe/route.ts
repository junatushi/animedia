// 通知メール内の「配信通知をすべて停止する」リンクの着地点。ログイン不要
// （別端末・別ブラウザでメールを開いても解除できるように、署名付きトークンで検証する）。
//
// 【2026-11-05】GET では**消さない**。確認ボタン（POST）を押したときだけ消す。
// 以前は GET を開いた瞬間に削除していたため、メールのセキュリティ製品（リンクを先に
// 開いて安全か確かめる）が通知を勝手に全部止めてしまいうる形だった。
// POST はメールクライアントの「ワンクリック解除」（RFC 8058。本文 `List-Unsubscribe=One-Click`、
// uid と token はURLのクエリ）にもそのまま対応する（ヘッダーは app/api/notify/run/route.ts が付ける）。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyUnsubscribeToken } from "@/lib/notifyUnsubscribeToken";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { siteUrl } from "@/lib/siteUrl";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// URLにトークンが載るので、リファラで外へ漏らさない・キャッシュさせない・索引させない。
const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function htmlPage(bodyHtml: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>配信通知の停止 | アニメ視聴ガイド</title>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#222">
${bodyHtml}
<p><a href="${siteUrl}/">アニメ視聴ガイドに戻る</a></p>
</body></html>`,
    { status, headers: PAGE_HEADERS }
  );
}

const INVALID = "<p>リンクが無効です。お手数ですがサイト上で個別に解除してください。</p>";

function readCredentials(url: URL): { uid: string; token: string } | null {
  const uid = url.searchParams.get("uid");
  const token = url.searchParams.get("token");
  if (!uid || !token || uid.length > 128 || token.length > 256) return null;
  if (!verifyUnsubscribeToken(uid, token)) return null;
  return { uid, token };
}

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return htmlPage("<p>ただいまこの機能は準備中です。</p>");
  }

  const url = new URL(request.url);
  const cred = readCredentials(url);
  if (!cred) return htmlPage(INVALID, 400);

  // ここでは消さない（確認だけ）。送り先は同じURL（クエリに uid と token が入っている）。
  const action = `/api/notify/unsubscribe?uid=${encodeURIComponent(cred.uid)}&token=${encodeURIComponent(cred.token)}`;
  return htmlPage(
    `<p>配信通知をすべて停止しますか？</p>
<form method="post" action="${escapeHtml(action)}">
<button type="submit" style="font-size:16px;padding:10px 20px">すべて停止する</button>
</form>`
  );
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return htmlPage("<p>ただいまこの機能は準備中です。</p>");
  }

  const cred = readCredentials(new URL(request.url));
  if (!cred) return htmlPage(INVALID, 400);

  const supabase = createServiceClient();
  const { error } = await supabase.from("notify_requests").delete().eq("user_id", cred.uid);
  if (error) {
    console.error("notify/unsubscribe:", error.message);
    return htmlPage("<p>解除に失敗しました。時間をおいて再度お試しください。</p>", 500);
  }

  return htmlPage("<p>配信通知をすべて停止しました。</p>");
}
