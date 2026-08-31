// リクエストごとにSupabaseの認証Cookieを更新するヘルパー。ルートのmiddleware.tsから呼ぶ。
// supabase.auth.getUser()を呼ぶことで、期限切れアクセストークンのリフレッシュが走る
// （getSession()だけではリフレッシュされないため、getUser()を使う）。
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "./config";

// Supabaseの認証Cookieが1つでも付いているか。@supabase/ssr が発行するCookie名は
// `sb-<プロジェクト参照>-auth-token` で、値が大きいときは `.0` `.1` … と分割される。
// プロジェクト参照は環境によって変わるので、名前の形だけで判定する。
// ここを厳しくしすぎる（＝ログイン中なのに素通ししてしまう）とセッションが更新されなく
// なるため、判定は「sb- で始まり auth-token を含む」という緩い条件にしてある。
export function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

export async function updateSession(request: NextRequest) {
  // Supabase未設定（外部セットアップ未完了）の間は何もせず素通しする。
  // ここでエラーを投げるとmiddlewareは全リクエストで走るため、サイト全体が
  // 500になってしまう（ログイン機能はまだ使えないが、他は今まで通り動くべき）。
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  // 認証Cookieを持たないリクエスト（未ログインの訪問者・検索クローラー・
  // キャッシュ温めのcurl）では、リフレッシュすべきセッションがそもそも存在しない。
  // それでも getUser() を呼ぶとSupabaseへのネットワーク往復が1回発生し、その待ち時間の
  // 間ずっと関数インスタンスが「実行中」として課金され続ける（Vercelの Fluid
  // Provisioned Memory は割当メモリ×稼働時間で、I/O待ち中も止まらない。Active CPU は
  // I/O待ちで止まるため、待つだけの処理はCPUを増やさずメモリだけを食う）。
  // 2026-08-25の実測では Provisioned Memory 489.1 GB-Hrs ÷ 2GB = 約245インスタンス時間に
  // 対し Active CPU は12時間しかなく、稼働時間の約95%がI/O待ちだった。middlewareは
  // 静的アセットを除く全リクエストで走るため、ここが待ち時間の主要な発生源になっていた。
  // Cookieが無いときに素通しすれば、ログイン中の利用者の挙動は一切変えずに
  // （＝セッション更新は今までどおり走る）、その往復だけを消せる。
  if (!hasAuthCookie(request)) {
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
