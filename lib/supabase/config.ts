// Supabase未設定（.env.localにNEXT_PUBLIC_SUPABASE_URL/ANON_KEYがまだ無い）状態を
// 各所で安全に検知するための共通チェック。ユーザーが外部セットアップ（Supabase
// プロジェクト作成・Google OAuth登録等）を終えるまでの間、ログイン機能まわりの
// コードが例外を投げて匿名閲覧まで巻き込んで壊すことがないようにするために使う。
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// 認証Cookieの名前かどうか。@supabase/ssr が発行するCookie名は
// `sb-<プロジェクト参照>-auth-token` で、値が大きいときは `.0` `.1` … と分割される。
// プロジェクト参照は環境によって変わるので、名前の形だけで判定する。
//
// 【なぜ1箇所に置くか】この判定は**サーバー（middleware）とブラウザ（AuthProvider）の
// 両方**が使う。どちらも「認証Cookieが無いリクエスト/訪問者では、Supabaseに触る処理を
// まるごと省く」ための門番で、片方だけ条件がズレると
// ①ログイン中なのにセッションが更新されない（middleware側が緩すぎ/厳しすぎ）
// ②ログイン中なのにログイン状態が画面に出ない（ブラウザ側が厳しすぎ）
// という、どちらも「ログインした人にだけ起きる」＝気づきにくい壊れ方になる。
// 判定は「sb- で始まり auth-token を含む」という緩い条件のまま共有する。
export function isAuthCookieName(name: string): boolean {
  return name.startsWith("sb-") && name.includes("auth-token");
}
