// 自前計測（Supabase の analytics_events）の集計ロジック。
//
// 【なぜ lib に出したか・2026-08-19】
// これまで集計は `app/admin/analytics/page.tsx` の中だけにあり、
// **ブラウザでログイン相当（?token=...）して画面を見る以外に読む方法が無かった**。
// そのためセッション（Claude）からは実測値を一切読めず、
// 「未提携サービスへのクリックが多い順に提携する」（docs/affiliate-setup.md）という
// 判断を、毎回ユーザーが手で数字を書き写すまで進められなかった。
//
// GSC と同じ解き方をする（docs/operations.md の「実測サマリ」）:
//   外向き通信ができる GitHub Actions から取り、リポジトリにJSONを置く。
//   セッションは**コミット済みのJSONを読むだけ**でよくなる。
// そのために画面（page.tsx）とJSON窓口（app/api/admin/analytics/route.ts）が
// **同じ集計**を通る必要があるので、ここに1箇所だけ置く。
// 素の `.ts` なのは `node scripts/check.ts` から import して検査するため
// （`.tsx` は Node が JSX を解釈できない＝lib/workTitle.ts と同じ理由）。

/** 集計の窓（日）。画面もJSONも同じ窓を見る。 */
export const WINDOW_DAYS = 30;
/** 1回の問い合わせで読む上限行数。Supabase無料枠を踏み抜かないための蓋。 */
export const MAX_ROWS = 5000;

export type EventRow = {
  event_name: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
};

/**
 * ダッシュボードに出すイベントと日本語ラベル。
 * **ここに無いイベントは画面にもJSONにも現れない**（表もグラフもこのキーから作る）。
 * 2026-08-06に affiliate_click / official_link_click が抜けていて、
 * 2026-07-19から記録されていたのにどこにも出ていなかった前例があるので、
 * `app/api/track/route.ts` の ALLOWED_EVENTS を増やしたらここも必ず足すこと。
 */
export const EVENT_LABELS: Record<string, string> = {
  share_site: "サイト全体を共有",
  share_work: "作品を共有",
  favorite_add: "お気に入り登録",
  watched_add: "視聴済みに登録",
  notify_add: "配信通知を登録",
  filter_service: "配信サービスで絞り込み",
  filter_cast: "声優で絞り込み",
  change_season: "シーズン切り替え",
  follow_click: "SNSフォロー導線をクリック",
  calendar_subscribe: "カレンダー購読をクリック",
  plan_open: "視聴プランを開いた",
  affiliate_click: "広告リンクをクリック（提携済み）",
  official_link_click: "公式サイトへ（未提携）",
  embed_copy: "埋め込みコードをコピー",
};

export function countBy(rows: EventRow[], since: Date | null): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (since && new Date(row.created_at) < since) continue;
    counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
  }
  return counts;
}

/**
 * event_data に識別子が付くイベントの、値ごとの内訳
 * （例: どの配信サービスのバッジが押されたか）。多い順・上位10件。
 */
export function countByDataField(rows: EventRow[], eventName: string, field: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_name !== eventName) continue;
    const value = row.event_data?.[field];
    if (typeof value !== "string") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

export type AnalyticsSnapshot = {
  windowDays: number;
  /** 何行を集計したか。MAX_ROWS と同じなら**打ち切られている**＝合計を過小に読まないこと。 */
  rowCount: number;
  truncated: boolean;
  events: { event: string; label: string; last7: number; last30: number }[];
  filterService: [string, number][];
  officialClicks: [string, number][];
  affiliateClicks: [string, number][];
};

/**
 * 画面とJSONが共有する集計本体。
 *
 * **個人を識別しうる値は一切通さない**（入力の analytics_events 自体が
 * IPアドレス・Cookie・ユーザーIDを持たない設計だが、ここでも event_data から
 * 取り出すのは countByDataField で明示した項目だけに限る）。
 */
export function buildSnapshot(rows: EventRow[], now = new Date()): AnalyticsSnapshot {
  const totalCounts = countBy(rows, null);
  const last7Counts = countBy(rows, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  return {
    windowDays: WINDOW_DAYS,
    rowCount: rows.length,
    truncated: rows.length >= MAX_ROWS,
    events: Object.keys(EVENT_LABELS).map((event) => ({
      event,
      label: EVENT_LABELS[event],
      last7: last7Counts[event] ?? 0,
      last30: totalCounts[event] ?? 0,
    })),
    filterService: countByDataField(rows, "filter_service", "service"),
    officialClicks: countByDataField(rows, "official_link_click", "service"),
    affiliateClicks: countByDataField(rows, "affiliate_click", "service"),
  };
}
