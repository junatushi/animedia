// サーバー用Supabaseクライアント（Server Component / Route Handlerから使う）。
// 本プロジェクトのNext.js 14.2系ではnext/headersのcookies()は同期関数
// （Next 15以降で非同期化されたため、最新のSupabase公式ドキュメントの
// `await cookies()` 例をそのまま持ち込まないこと）。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server ComponentからはCookie書き込み不可（読み取り専用）。
            // セッションの更新自体はmiddleware側で行うため無視してよい。
          }
        },
      },
    }
  );
}
