"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isAuthCookieName, isSupabaseConfigured } from "@/lib/supabase/config";

type AuthContextValue = { user: User | null; loading: boolean };
const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

// SeasonExplorer・AuthWidget等がプロップスドリリングなしにログイン状態を読めるようにする。
export function useAuth() {
  return useContext(AuthContext);
}

// ブラウザ側に認証Cookieが1つでも付いているか。@supabase/ssr のブラウザクライアントは
// セッションをCookieに置く（httpOnlyではないのでJSから見える）ため、supabase-js を
// 読み込む前に「ログインしている可能性があるか」だけを判定できる。
// 判定の規則は lib/supabase/config.ts の isAuthCookieName（middlewareと同じ）。
function hasAuthCookie(): boolean {
  try {
    return document.cookie
      .split(";")
      .some((c) => isAuthCookieName(c.trim().split("=")[0] ?? ""));
  } catch {
    // document.cookie が触れない環境（Cookieを無効にしたブラウザ等）では
    // 未ログイン扱いにする。匿名閲覧はログイン無しで完全に動く。
    return false;
  }
}

// ログイン状態をアプリ全体に配布するプロバイダ。app/layout.tsxで{children}をラップする。
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Supabase未設定（外部セットアップ未完了）の間は、未ログイン状態のまま固定する。
    // ここでcreateClient()を呼ぶとURL未設定で例外になり、匿名閲覧まで巻き込んで壊れる。
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    // 【表示速度のための門番（2026-09-03導入）】認証Cookieが無い訪問者＝未ログインでは
    // supabase-js（実測 gzip 約51KB・生188KB）を**1バイトも読み込まない**。
    // 以前はこのファイルが createClient を静的importしていたため、supabase-js が
    // トップ・シーズン一覧の初期JS（実測181KB）に常時含まれ、閲覧するだけの人が
    // ダウンロード・パース・実行のコストを毎回払っていた。ログイン機能を使うのは
    // 視聴済み・配信通知だけで、匿名閲覧・検索・お気に入りはログイン無しで完全に動く。
    // Cookieが無ければ getUser() の結果は必ず「未ログイン」なので、挙動は変わらない。
    // （middlewareが同じ規則で素通しするのと対になっている。lib/supabase/middleware.ts）
    if (!hasAuthCookie()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    // ログイン中の人だけが、初回描画の後に supabase-js を取りに行く（動的import）。
    // components/useLoginGatedWorkSet.ts が先に使っているのと同じ形。
    import("@/lib/supabase/client")
      .then(({ createClient }) => {
        if (cancelled) return;
        const supabase = createClient();

        supabase.auth.getUser().then(({ data }) => {
          if (cancelled) return;
          setUser(data.user);
          setLoading(false);
        });

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ?? null);
        });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch(() => {
        // 読み込みに失敗しても匿名閲覧は続けられるべきなので、未ログイン扱いで確定する。
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}
