// サーバー用Supabaseクライアント（Server Component / Route Handlerから使う）。
// 【2026-11-06・Next.js 16へ更新】next/headers の cookies() は非同期（16で同期アクセスは廃止）。
// そのためこの関数も async で、呼び出し側は必ず `await createClient()` と書く
// （await を忘れると Promise に .from() を呼んで実行時に落ちる。tsc が型で止める）。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

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
