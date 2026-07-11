// リクエストごとにSupabaseの認証Cookieを更新するヘルパー。ルートのmiddleware.tsから呼ぶ。
// supabase.auth.getUser()を呼ぶことで、期限切れアクセストークンのリフレッシュが走る
// （getSession()だけではリフレッシュされないため、getUser()を使う）。
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "./config";

export async function updateSession(request: NextRequest) {
  // Supabase未設定（外部セットアップ未完了）の間は何もせず素通しする。
  // ここでエラーを投げるとmiddlewareは全リクエストで走るため、サイト全体が
  // 500になってしまう（ログイン機能はまだ使えないが、他は今まで通り動くべき）。
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}
