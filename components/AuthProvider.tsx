"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AuthContextValue = { user: User | null; loading: boolean };
const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

// SeasonExplorer・AuthWidget等がプロップスドリリングなしにログイン状態を読めるようにする。
export function useAuth() {
  return useContext(AuthContext);
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

    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}
