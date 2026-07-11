// 通知メール内の「配信通知をすべて停止する」リンクの着地点。ログイン不要
// （別端末・別ブラウザでメールを開いても解除できるように、署名付きトークンで検証する）。
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyUnsubscribeToken } from "@/lib/notifyUnsubscribeToken";
import { isSupabaseConfigured } from "@/lib/supabase/config";

function htmlPage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><title>配信通知の停止 | アニメ視聴ガイド</title>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#222">
<p>${message}</p>
<p><a href="https://animedia-khaki.vercel.app/">アニメ視聴ガイドに戻る</a></p>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return htmlPage("ただいまこの機能は準備中です。");
  }

  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");
  if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
    return htmlPage("リンクが無効です。お手数ですがサイト上で個別に解除してください。");
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("notify_requests").delete().eq("user_id", uid);
  if (error) {
    return htmlPage("解除に失敗しました。時間をおいて再度お試しください。");
  }

  return htmlPage("配信通知をすべて停止しました。");
}
