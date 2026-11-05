// ログイン利用者の作品リスト（視聴済み `watched`・配信通知 `notify_requests`）の
// 追加・削除で共通の入力検証（2026-11-05導入）。
//
// 2つの route（app/api/watched・app/api/notify）は同じ形をしていて、どちらも
// ①ボディが壊れていると request.json() が例外を投げて500になる
// ②workId の値域を見ていない（小数・負数・巨大値が入る）
// ③1人が入れられる件数に上限が無い（通知バッチが登録された作品の数だけ Annict に問い合わせる）
// ④Supabase のエラー文（テーブル名・列名を含みうる）をそのまま返す
// という穴を共有していた。片方だけ直すことが無いよう、判定をここに置く。
// 素の `.ts` なのは scripts/check.ts から挙動を検査するため（route.ts は next/server 依存）。
import { parseWorkIdValue } from "./workId.ts";

/**
 * 1人あたりの登録件数の上限。1クールの作品数（実測で最大224）の倍あれば
 * 普通の使い方で当たることは無い。上限は通知バッチ（1件0.5秒の間隔で Annict に
 * 問い合わせる）が関数の時間制限に収まるかの防波堤でもある。
 */
export const MAX_ITEMS_PER_USER = 500;

/** ボディ `{ workId }` を読む。壊れたJSON・範囲外の値は null（400で返す）。 */
export async function readWorkIdBody(request: Request): Promise<number | null> {
  // 本来のボディは `{"workId":12345}` の十数バイト。巨大なボディは読まずに捨てる。
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > 1024) return null;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  return parseWorkIdValue((body as { workId?: unknown }).workId);
}

/** 利用者に返すエラー文。内部のエラー文は返さずログにだけ出す。 */
export function internalErrorBody(where: string, message: string): { error: string } {
  console.error(`${where}:`, message);
  return { error: "処理に失敗しました。時間をおいて再度お試しください。" };
}
