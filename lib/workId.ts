// URLの `[id]` セグメント（作品ID）の検証。
//
// ───────────────────────────────────────────────────────────────
// 【なぜこのファイルがあるか・2026-08-31の逆張り巡回で見つけた事故】
//
// 3つの窓口（作品ページ・公開API・埋め込み）が同じ検証を各自で書いていた:
//
//   const id = Number(params.id);
//   if (!Number.isInteger(id) || id <= 0) ...
//
// これは通ってはいけない値を通す。**`Number.isInteger` は「安全な整数か」ではなく
// 「整数値か」しか見ない**ので、`Number.MAX_SAFE_INTEGER` を超える値も通る。
// さらに `Number()` は10進数以外の表記も受け付ける。実測（本番）:
//
//   /api/work/99999999999999999999   → **502**（Number.isInteger(1e20) が true）
//   /embed/anime/99999999999999999999 → **502**
//   /anime/99999999999999999999      → 200 ＋ 本文「取得に失敗しました。」＋ <h1>なし
//   /anime/0x3374                    → 200（16進として 13172 に解決＝別URLで同じ作品）
//   /anime/1e5                       → 404（100000 に解決）
//   /anime/0013180 · /anime/13180.0  → 200（先頭ゼロ・小数点も同じ作品に解決）
//
// 実害は3つ:
//   ①公開APIが5xxを返す（/developers で二次利用を呼びかけている窓口が落ちる）
//   ②存在しないIDが 200 で返る＝ソフト404。ISRの書き込みも1件発生する（㉝と同じ経路）
//   ③同じ作品が複数のURLで200を返す。canonical は正規化後のIDを指すので索引上は
//     まとまるが、クロールされた分だけ無駄な書き込みが起きる
//
// 【したがっての規則】
//   **作品IDは10進数の文字列として厳密に検証する。`Number()` の解釈に任せない。**
//   3つの窓口はこの関数だけを使う（各自で `Number()` を書かない）。
//
// 検査は `node scripts/check.ts` の「作品IDの検証」節。経緯は docs/operations.md の㊲。
// ───────────────────────────────────────────────────────────────

/**
 * URLの `[id]` から作品ID（Annictのannict_id）を取り出す。
 *
 * 受け付けるのは**先頭が0でない1〜6桁の10進数**（1〜999,999）だけ。
 * Annictの作品IDは実測で5桁台（2026-11-05時点の最大は18,000台）なので6桁でも
 * 50倍以上の余裕があり、`Number.MAX_SAFE_INTEGER` からも遠い。
 *
 * 【2026-11-05・9桁→6桁】形は正しいが存在しないID（`/anime/123456789`）は、ページが
 * 描画されて Annict へ問い合わせ、notFound() の404がISRに書き込まれる（lib/routeGuard.ts の
 * #73101）。9桁だと**10億通り**を外から叩けたので、実データの範囲に近づけて1000分の1にした。
 * 実IDが上限に近づいたら `node scripts/check.ts` の「作品IDの値域」が先に落ちる
 * （実データの最大が上限の10%を超えたら）。上限を上げるときは正規表現の桁数だけ変える。
 *
 * 弾く例: "0" / "-1" / "0013180" / "13180.0" / "1e5" / "0x3374" /
 *         "99999999999999999999" / "１３１８０"（全角）/ "" / "13180 "
 *
 * @returns 妥当なら数値、そうでなければ null
 */
export function parseWorkId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * JSONのボディで受け取った作品ID（`{ workId: 13180 }`）を検証する（2026-11-05導入）。
 *
 * `/api/watched`・`/api/notify` は `typeof workId === "number"` しか見ておらず、
 * 小数・負数・`1e20` も通っていた。`/api/notify` に入った値は毎日の通知バッチ
 * （app/api/notify/run）が1件ずつ Annict に問い合わせるので、存在しないIDを大量に
 * 入れられるとバッチが時間切れになり、全員の通知が止まる。URLの `[id]` と同じ値域
 * （parseWorkId）に揃える。
 */
export function parseWorkIdValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return parseWorkId(String(value));
}

/** parseWorkId が受け付ける最大値（検査用。正規表現の桁数と一致させる）。 */
export const MAX_WORK_ID = 999_999;
