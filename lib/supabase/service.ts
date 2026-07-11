import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// service-role（secret）key専用のSupabaseクライアント。RLSを無視して全ユーザーの
// データを読み書きできるため、cronから叩かれる app/api/notify/run/route.ts
// からのみ使う（他のルート・コンポーネントからは絶対に使わない）。
// "server-only" によりクライアントコンポーネントへ誤って import された場合は
// ビルドエラーになる（ブラウザバンドルへのキー混入を防ぐ）。
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
