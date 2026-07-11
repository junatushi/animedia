// Supabase未設定（.env.localにNEXT_PUBLIC_SUPABASE_URL/ANON_KEYがまだ無い）状態を
// 各所で安全に検知するための共通チェック。ユーザーが外部セットアップ（Supabase
// プロジェクト作成・Google OAuth登録等）を終えるまでの間、ログイン機能まわりの
// コードが例外を投げて匿名閲覧まで巻き込んで壊すことがないようにするために使う。
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
