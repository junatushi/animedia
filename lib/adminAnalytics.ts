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
  web_vitals: "表示速度の実測（1ページビュー1件）",
  page_view: "外部からの流入（リファラあり）",
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

/**
 * 実利用者の表示速度（web_vitals）を、面ごと・指標ごとに p75 で出す。
 *
 * **なぜ平均ではなく p75 か**: Google の Core Web Vitals の判定も p75 で、
 * 平均は少数の極端に遅い回線に引きずられる。
 *
 * **件数を必ず一緒に返すこと。** このサイトの実トラフィックは小さく
 * （GSC実測で作品ページ81ページ・28日で77クリック）、数件の p75 を
 * 「速くなった／遅くなった」の根拠にすると㉞・㊶と同じ「少数からの一般化」を
 * 繰り返すことになる。読む側が件数を見て判断できるようにする。
 */
export function vitalsP75(
  rows: EventRow[]
): { face: string; metric: string; p75: number; count: number }[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    if (row.event_name !== "web_vitals") continue;
    const d = row.event_data;
    if (!d) continue;
    const face = typeof d.face === "string" ? d.face : "other";
    for (const [metric, value] of Object.entries(d)) {
      if (metric === "face") continue;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const key = `${face}\u0000${metric}`;
      const arr = buckets.get(key);
      if (arr) arr.push(value);
      else buckets.set(key, [value]);
    }
  }
  const out: { face: string; metric: string; p75: number; count: number }[] = [];
  for (const [key, values] of buckets) {
    const [face, metric] = key.split("\u0000");
    values.sort((a, b) => a - b);
    // 最近傍順位法。値が1件なら その値自身が p75 になる。
    const idx = Math.min(values.length - 1, Math.ceil(values.length * 0.75) - 1);
    out.push({ face, metric, p75: values[Math.max(0, idx)], count: values.length });
  }
  // 面 → 指標 の順に並べて、画面でもJSONでも同じ並びになるようにする。
  return out.sort((a, b) => a.face.localeCompare(b.face) || a.metric.localeCompare(b.metric));
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
  /** 実利用者の表示速度。面ごと・指標ごとの p75 と件数（2026-09-06追加）。 */
  vitals: { face: string; metric: string; p75: number; count: number }[];
  /** 外から来た経路のホスト名の多い順（同上）。AI検索からの流入もここに出る。 */
  referrers: [string, number][];
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
    vitals: vitalsP75(rows),
    referrers: countByDataField(rows, "page_view", "ref"),
  };
}
