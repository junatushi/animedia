// 「このページは日付を名乗ってよいか」を1箇所で決める（2026-09-14導入・重大度高）。
//
// ───────────────────────────────────────────────────────────────
// なぜ要るか
//
// それまで5つの面（作品・声優・ランキング・独占配信・サービス別）が、描画のたびに
// `new Date().toISOString().slice(0,10)` を呼んで**その瞬間の日付**を
//   ・可視テキスト（「〜時点」「配信情報の取得日: …」）
//   ・JSON-LD の dateModified / sdDatePublished
//   ・meta description
// の3箇所に焼き込んでいた。害が2つある。
//
// ①【事実として誤り】content/snapshots/ から描いている過去クールのページに
//   「2026-09-14時点」と書くのは嘘である。app/sitemap.ts は同じ理由で lastModified を
//   **全部捨てた**（「正確な更新時刻を持っていないのだから、申告しないのが正しい」
//   「不正確な lastmod はサイト全体の lastmod を無視させる」）。sitemapで正した誤りが、
//   より強い主張であるページ内の構造化データには残っていた。
//
// ②【無料枠を静かに食い潰す】Vercel は ISR の再生成で**出力が前回と1バイトも
//   変わらなければ Write を課金しない**。逆に時刻・乱数・生成IDが混ざっていると
//   「毎回変化あり」となり、中身が同じでもページ全体（HTML＋RSCペイロード）が
//   書き直される。ISR Writes は**回数ではなく 8KB 単位のバイト量**で数えるので、
//   1ページ 180KB のページが日付をまたぐだけで約23ユニット消える。
//   出典: https://vercel.com/kb/guide/how-to-reduce-isr-revalidation-costs
//         https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing
//
// ───────────────────────────────────────────────────────────────
// いまの規則
//
//   ・データ層（lib/getSeasonData.ts / lib/getWorkData.ts）が `fetchedAt` を返す。
//     Annict へ実際に問い合わせた日＝**unstable_cache の中で確定する**ので、
//     データが変わらない限り出力も変わらない。
//   ・スナップショット（放送終了済みの確定データ）から返したときは **null**。
//   ・ページは `canStateFetchDate(fetchedAt)` が true のときだけ日付を出す。
//     false のときは可視テキストからも JSON-LD からも**日付ごと消す**
//     （「不明」と書かない。書かないのが正しい）。
//
// 【やってはいけないこと】ページ側で `new Date()` を呼んで日付を作り直すこと。
// 検査は scripts/check.ts の「出力に『いまの日付』を混ぜない」節が、
// app/ 配下を**走査して**（名指しせずに）禁止する。
// ───────────────────────────────────────────────────────────────

// データ層が「取得日」として返す値。null は「静的な確定データなので取得日という
// 概念が無い」を表す（undefined も同じ扱い＝まだ fetchedAt を持っていない経路）。
export type FetchedAt = string | null | undefined;

// 日付を名乗ってよいか。
export function canStateFetchDate(fetchedAt: FetchedAt): fetchedAt is string {
  return typeof fetchedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fetchedAt);
}

// 「（2026-09-14時点）」のような括弧つきの注記。名乗れないときは空文字。
// 呼び出し側で `? :` を書き散らさないための小さな道具。
export function asOfNote(fetchedAt: FetchedAt): string {
  return canStateFetchDate(fetchedAt) ? `（${fetchedAt}時点）` : "";
}

// 「2026-09-14時点。」のように文中へ差し込む断片。名乗れないときは空文字。
export function asOfSentence(fetchedAt: FetchedAt): string {
  return canStateFetchDate(fetchedAt) ? `${fetchedAt}時点。` : "";
}

// JSON-LD へ dateModified / sdDatePublished を入れてよいときだけ
// `{ dateModified: "..." }` を返す。名乗れないときは空オブジェクト＝
// スプレッドしてもキーが増えない（「不明」を意味する値を入れない）。
export function dateModifiedLd(fetchedAt: FetchedAt): Record<string, string> {
  return canStateFetchDate(fetchedAt) ? { dateModified: fetchedAt } : {};
}
