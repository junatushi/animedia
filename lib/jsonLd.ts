// 構造化データ（JSON-LD）を <script type="application/ld+json"> の中身として安全に書き出す
// （2026-11-05導入・重大度中）。
//
// 【なぜ要るか】`JSON.stringify` は `<` `>` をそのまま出す。JSON-LDには Annict 由来の
// 作品名・声優名・制作会社名が入り、**Annictはコミュニティ編集**なので、誰かが作品名を
// `</script><script>…</script>` に書き換えると、そのページで任意のスクリプトが動く
// （ISRでその HTML が最長1週間配られる＝保存型XSS）。React は dangerouslySetInnerHTML の
// 中身をエスケープしないので、ここで潰すしかない。
//
// `<` `>` `&` と行区切り文字（U+2028/U+2029）を \uXXXX に置き換える。どれも JSON として
// 等価なので、検索エンジンが読む値は1文字も変わらない。
//
// **ページで `JSON.stringify` を直接 __html に渡さないこと。** `node scripts/check.ts` の
// 「JSON-LDの書き出し」節が `app/` と `components/` を走査して見張る。
// 素の `.ts` なのは scripts/check.ts から import して挙動まで検査するため。

const UNSAFE = /[<>&\u2028\u2029]/g;

function escapeChar(c: string): string {
  return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
}

/** JSON-LD を <script> の中に置いても途中で閉じられない文字列にする。 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE, escapeChar);
}
