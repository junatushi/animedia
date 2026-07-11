// ブラウザ用Supabaseクライアント。ログイン状態の購読（onAuthStateChange）や
// クライアントコンポーネントからのOAuth開始（signInWithOAuth）に使う。
// anon keyのみを使い、行レベルセキュリティ（RLS）でユーザーごとのデータ分離を担保する
// 設計のため、ブラウザに露出しても安全（service role keyはどこにも置かない）。
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
