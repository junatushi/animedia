"use client";

import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useAuth } from "./AuthProvider";

// ヘッダー用のログイン/ログアウトウィジェット（ThemeToggleと同じ自己完結クライアント
// ウィジェットの形）。ログインは任意で、既存の閲覧・検索・お気に入り等はログイン無しでも
// 今まで通り完全に動作する（視聴済み機能だけがこのログイン状態を必要とする）。
export default function AuthWidget() {
  const { user, loading } = useAuth();

  // Supabase未設定（外部セットアップ未完了）の間は、壊れたログインボタンを
  // 見せるより何も出さない方が良い。設定が完了すると自動的に表示される。
  if (!isSupabaseConfigured()) {
    return null;
  }

  async function signIn() {
    // redirectToにクエリ文字列（元居たページへの復帰用）を含めると、Supabase側の
    // Redirect URL許可リストとの完全一致に失敗し、登録したSite URL（本番ドメイン）へ
    // フォールバックしてしまう事例があったため、常にクエリ無しの固定URLに戻す
    // （ログイン後は常にトップページに戻る。動作優先でシンプルにしている）。
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  if (loading) {
    return <span className="auth-widget auth-widget-loading" aria-hidden="true" />;
  }

  if (user) {
    const name = (user.user_metadata?.name as string | undefined) ?? user.email ?? "ログイン中";
    return (
      <div className="auth-widget">
        <span className="auth-widget-name" title={user.email ?? undefined}>
          {name}
        </span>
        <button type="button" className="auth-widget-btn" onClick={signOut}>
          ログアウト
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="auth-widget-btn" onClick={signIn}>
      Googleでログイン
    </button>
  );
}
