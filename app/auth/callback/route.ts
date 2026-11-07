// GoogleでのOAuth認証後のコールバック。authorization codeをセッションに交換し、
// 元居たページ（next）または トップページへ戻す。
//
// 【2026-11-05】`next` は lib/safeRedirect.ts の safeNextPath で**このサイトの中のパスだけ**に絞る。
// 以前は `${origin}${next}` の連結で、`next=@evil.example` が外部サイトへのリダイレクトになっていた。
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/safeRedirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), origin);

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/?auth_error=1", origin));
}
