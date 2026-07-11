"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// ログイン必須の「作品ID集合トグル」機能を共通化するフック。視聴済み(/api/watched)・
// 配信通知希望(/api/notify)など、GET(一覧)/POST/DELETE({workId})の同型APIを持つ
// 機能で使う。お気に入り（localStorageのみ・ログイン不要）は対象外。
//
// apiPath: 対象のAPIパス（例: "/api/watched"）
// onAdd: 追加が成功した時だけ呼ばれるコールバック（計測イベント等に使う。任意）
export function useLoginGatedWorkSet(apiPath: string, onAdd?: () => void) {
  const { user } = useAuth();
  const [items, setItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!user) {
      setItems(new Set());
      return;
    }
    let abort = false;
    fetch(apiPath)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!abort && Array.isArray(j?.workIds)) setItems(new Set(j.workIds));
      })
      .catch(() => {
        // 取得失敗時は空のまま（表示が出ないだけで、他の閲覧は影響しない）
      });
    return () => {
      abort = true;
    };
  }, [user, apiPath]);

  function toggle(id: number) {
    if (!user) {
      // Supabase未設定（外部セットアップ未完了）の間はボタン自体は表示されるが、
      // ここで何もしない（クリックしても例外にしない）。設定完了後は自動的に動く。
      if (!isSupabaseConfigured()) return;
      // 未ログイン時はそのままGoogleログインへ誘導する（別モーダルは作らず簡潔にする）。
      // redirectToにクエリ文字列を含めるとSupabaseのRedirect URL許可リストとの完全一致に
      // 失敗する事例があったため、クエリ無しの固定URLにしている。
      import("@/lib/supabase/client").then(({ createClient }) => {
        const supabase = createClient();
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
      });
      return;
    }

    const was = items.has(id);
    // 楽観的更新: サーバー応答を待たずに即座にUIへ反映する。
    setItems((prev) => {
      const next = new Set(prev);
      if (was) next.delete(id);
      else next.add(id);
      return next;
    });

    const req = was
      ? fetch(apiPath, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workId: id }) })
      : fetch(apiPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workId: id }) });

    req.then((r) => {
      if (!r.ok) {
        // 失敗したら楽観的更新を巻き戻す
        setItems((prev) => {
          const next = new Set(prev);
          if (was) next.add(id);
          else next.delete(id);
          return next;
        });
      } else if (!was && onAdd) {
        onAdd();
      }
    });
  }

  return { items, toggle };
}
