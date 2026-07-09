// 配信先には含まれるが「見放題（サブスク内）」ではなく「レンタル/都度課金」扱いの
// サービスを、作品ごとに人力で記録する一覧。dアニメストア・Amazonプライム等の実際の
// 作品ページで確認できたサービスのみ追加する（推測で埋めない。CLAUDE.mdの方針に準拠）。
//
// ここに載ったサービスは、カード一覧・作品ページ本体の配信チップからは除外され、
// 作品ページの「レンタル作品」欄に別枠で表示される。
//
// key: Annict の annictId（作品ID）
// value: lib/services.ts の SERVICES と対応する service key（例: "d_anime", "prime"）の配列
//
// synopsis等（content/works/{id}.json）とは別ファイルにしているのは、カード一覧
// （軽量なクライアント側データ）でも参照するため。imageIds.ts と同じ考え方。
export const RENTAL_SERVICES: Record<number, string[]> = {};
