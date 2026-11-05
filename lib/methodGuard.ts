// ページ（route handler 以外）に届いた POST などを、描画させずに断る（2026-11-05導入・重大度高）。
//
// 【なぜ要るか】Next.js 14 はサポートが終わっており、2025〜2026年に出た勧告の多くは
// 14系に修正版が無い（scripts/lib/security-acknowledged.js）。そのうち Server Actions と
// RSC の要求の逆シリアライズに関わるもの（DoS・SSRF・内部エンドポイントの露出）は、
// **ページへの POST（Next-Action ヘッダー付き）**が入口になる。このサイトは Server Actions を
// 1つも使っておらず（`"use server"` が無い。scripts/check.ts が見張る）、ページは GET と HEAD
// しか受けない。なので入口そのものを middleware で閉じる。
// 重い要求で関数を長く走らせられると Active CPU（無料枠4時間）を直接削られるので、
// 無料枠を守る意味もある。
//
// - `/api/` 配下は対象外（route handler が自分で受けるメソッドを決める。POSTを受ける窓口がある）。
// - `Next-Action` ヘッダーは**どのパスでも**断る（Server Actions を使っていないので正当な要求は無い）。
// 素の `.ts` なのは scripts/check.ts から挙動を検査するため。

const PAGE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 断るなら返すHTTPステータス（400 か 405）。通すなら null。
 * @param headers `Headers` 互換（`get` だけ使う）
 */
export function rejectedMethodStatus(
  method: string,
  pathname: string,
  headers: { get(name: string): string | null }
): 400 | 405 | null {
  if (headers.get("next-action") !== null) return 400;
  if (pathname.startsWith("/api/")) return null;
  return PAGE_METHODS.has(method.toUpperCase()) ? null : 405;
}
