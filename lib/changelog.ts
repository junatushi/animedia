// サイトの更新履歴（新しい順）。「このサイトは動いている」ことを伝え、再訪の動機にする。
// 大きめの機能・修正だけ手で数件残す（全コミットは載せない）。
// app/page.tsx の更新履歴表示と app/feed.xml/route.ts のRSS配信の両方から参照する。
export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  text: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  { date: "2026-07-05", text: "作品ごとの共有ボタン・今期の注目作ランキング・更新履歴を追加" },
  { date: "2026-07-05", text: "お気に入り登録・配信サービスのAND絞り込み・並び替え（人気/五十音）を追加" },
  { date: "2026-07-05", text: "YouTubeを配信サービスとして追加、メ〜テレの誤分類を修正" },
  { date: "2026-07-04", text: "一部作品が重複表示される不具合を修正" },
];
