// アニメ配信の「需要シグナル」収集に使う正準クエリ集と対象ソース。
// 収集は Claude(WebSearch) 側が行うため、このファイルは「毎回どこを・どう検索するか」を
// 固定して再現性を持たせるための設定（＝運用手順の一部）。node scripts/demand-scan.js --print-queries で出せる。
//
// 方針（CLAUDE.md / outreach-scout と同じ思想）:
//   - 検索エンジン経由の公開情報のみ。各サイトへ直接スクレイピングはしない（低負荷・ToS安全）。
//   - 直近1週間が目安。WebSearch側で期間を絞れるならそれを使う。
//   - 収集結果は content/demand/raw/<YYYY-MM-DD>.jsonl に1行1ヒットで保存する。

// 収集対象ソース（source フィールドに入れる値と、WebSearchで site: を添える際のヒント）。
const SOURCES = [
  { source: "chiebukuro", label: "Yahoo!知恵袋", siteHint: "site:detail.chiebukuro.yahoo.co.jp" },
  { source: "x", label: "X(旧Twitter)", siteHint: "site:x.com OR site:twitter.com" },
  { source: "5ch", label: "5ch/掲示板まとめ", siteHint: "site:5ch.net OR 5chまとめ" },
  { source: "reddit", label: "Reddit", siteHint: "site:reddit.com r/anime" },
  { source: "web", label: "一般Web(ブログ/Q&A)", siteHint: "" },
];

// (A) 作品の配信先の困りごと系クエリ。<season> は呼び出し時に今期ラベル等へ置換する想定。
const WHERE_TO_WATCH_QUERIES = [
  "今期アニメ どこで配信 見れない",
  "アニメ 配信されてない どこで見る",
  "この作品 配信 どこ サブスク",
  "見逃し 配信 どこ アニメ 今期",
  "独占配信 見れない アニメ",
  "地上波ない アニメ 配信 どこ",
];

// (B) 配信サービスへの需要系クエリ。
const SERVICE_DEMAND_QUERIES = [
  "アニメ サブスク おすすめ どれ",
  "dアニメストア 加入 迷う 解約",
  "Netflix アニメ 入るべき 解約",
  "U-NEXT アマプラ アニメ 比較 どっち",
  "ABEMA プレミアム アニメ 課金 迷う",
  "アニメ 配信サービス 乗り換え コスパ",
  "配信サービス 値上げ アニメ どれ",
];

// 収集の目安件数（1クエリあたり）。負荷配慮でWebSearchの1バッチに留める。
const PER_QUERY_LIMIT = 10;
const WINDOW_DAYS = 7;

module.exports = {
  SOURCES,
  WHERE_TO_WATCH_QUERIES,
  SERVICE_DEMAND_QUERIES,
  PER_QUERY_LIMIT,
  WINDOW_DAYS,
};
