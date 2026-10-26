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

import {
  KNOWN_FACES,
  KNOWN_OUT_KINDS,
  KNOWN_SECTIONS,
  normalizeSearchQuery,
  SEARCH_QUERY_RE,
} from "./trackEventData.ts";
import { isVitalsMetricKey } from "./vitalsDiagnostics.ts";

/** 集計の窓（日）。画面もJSONも同じ窓を見る。 */
export const WINDOW_DAYS = 30;
/**
 * 集計に読む行数の上限。Supabase無料枠を踏み抜かないための蓋。
 * 2026-10時点の実測は1日80〜110行（30日で約3,000行）なので、一時的な急増（10/2に
 * 自動アクセスが約900件まとまって来た）が重なっても窓全体が収まる大きさにしてある。
 */
export const MAX_ROWS = 10000;

/**
 * 1回の問い合わせで取りに行く行数。
 *
 * 【2026-10-21・重大度高】以前は `.limit(MAX_ROWS)` 1回で取っていたが、Supabase（PostgREST）は
 * **サーバー側の Max Rows（既定1000）で黙って切る**。エラーも警告も返らないので、
 * 2026-09-28から**13日以上「直近30日」ではなく「新しい順の1000行」だけを集計していた**
 * （rowCount が毎日ちょうど1000・truncated は false のまま。30日以内の記録が窓から消えていた）。
 * truncated の判定も `rows.length >= MAX_ROWS`（5000）だったので、1000で止まると永久に立たない。
 * いまは fetchWindowRows がページ単位で取り切る。
 */
export const PAGE_ROWS = 1000;

/** 1ページ分を取る関数。Supabase の `.range(from, to)` をそのまま渡す想定（境界は両端を含む）。 */
export type FetchPage = (
  from: number,
  to: number
) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/**
 * 窓の行を**サーバーの上限に関係なく**取り切る。
 *
 * **「要求より少なく返った＝最後のページ」と判定しないこと。** サーバーの Max Rows が
 * PAGE_ROWS より小さく設定されていると（例: 500）、毎回そこで「終わり」と誤認して
 * 今回と同じ形で黙って切れる。**空のページが返るまで**、実際に返った件数ぶんだけ進める
 * （最後に1回だけ空振りの問い合わせが増えるのが代償）。
 * 取得中に新しい行が入ると順序がずれて境界で重複しうるので、呼び出し側は
 * `created_at` の上端（取得開始時刻）も固定すること。
 */
export async function fetchWindowRows(
  fetchPage: FetchPage
): Promise<{ rows: EventRow[]; error: string | null }> {
  const rows: EventRow[] = [];
  while (rows.length < MAX_ROWS) {
    const from = rows.length;
    const to = Math.min(from + PAGE_ROWS, MAX_ROWS) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, error: error.message };
    const page = (data ?? []) as EventRow[];
    if (page.length === 0) break;
    // 要求した幅より多く返る＝範囲指定が効いていない（毎回同じ行が返る）。黙って重複させない。
    if (page.length > to - from + 1) {
      return { rows, error: `範囲指定が効いていない（${from}〜${to} を要求して ${page.length} 行が返った）` };
    }
    rows.push(...page.slice(0, MAX_ROWS - rows.length));
  }
  return { rows, error: null };
}

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
  page_view: "外部からの流入（リファラまたは ?ref= あり）",
  nav: "サイト内の移動（ページ種別間）",
  outbound_click: "外部リンク（公式サイト・出典など）をクリック",
  seen: "画面に出た欄（移動せず閉じたページ）",
  search: "検索欄で検索（入力が止まった時点で1件）",
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
    // 自動アクセスは除く（2026-10-21）。10/2 の約900件で p75 が見かけ上よくなった。
    // ua を持たない古い行（〜10/21）は区別できないので従来どおり入れる。
    if (isBotRow(row)) continue;
    const face = typeof d.face === "string" && KNOWN_FACES.has(d.face) ? d.face : "other";
    for (const [metric, value] of Object.entries(d)) {
      // 指標名は送る側が作る名前だけ（2026-10-26）。形の合う任意のキー名を数値つきで送ると、
      // それが「指標名」としてコミットされるJSONに出ていた。
      if (!isVitalsMetricKey(metric)) continue;
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

/** web_vitals / nav に付く端末の大まかな種類が bot か（lib/vitalsDiagnostics.ts の agentClass）。 */
function isBotRow(row: EventRow): boolean {
  return row.event_data?.ua === "bot";
}

/**
 * 2つのフィールドの組ごとの件数（多い順・上位 limit 件）。自動アクセスの行は除く。
 * 「どの流入元がどの面に着地したか」（web_vitals の src×face）と
 * 「どの面からどの面へ移ったか」（nav の from×face）に使う。
 */
export function countPairs(
  rows: EventRow[],
  eventName: string,
  a: string,
  b: string,
  limit = 30
): [string, string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_name !== eventName || isBotRow(row)) continue;
    const x = row.event_data?.[a];
    const y = row.event_data?.[b];
    if (typeof x !== "string" || typeof y !== "string") continue;
    const key = `${x}\u0000${y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, limit)
    .map(([key, n]) => {
      const [x, y] = key.split("\u0000");
      return [x, y, n];
    });
}

/**
 * 3つ以上のフィールドの組ごとの件数（多い順・上位 limit 件）。countPairs の一般形。自動アクセスは除く。
 * 「どの面の、どの欄のリンクから、どの面へ移ったか」（nav の from×via×face）に使う。
 */
export function countTuples(
  rows: EventRow[],
  eventName: string,
  fields: string[],
  allow: Record<string, Set<string>>,
  limit = 30
): (string | number)[][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_name !== eventName || isBotRow(row)) continue;
    const values = fields.map((f) => row.event_data?.[f]);
    if (!values.every((v) => typeof v === "string")) continue;
    // 一覧にある値だけ数える（lib/trackEventData.ts の KNOWN_*。自由文・作り物の単語をJSONに出さない）。
    if (!fields.every((f, i) => !allow[f] || allow[f].has(values[i] as string))) continue;
    const key = values.join("\u0000");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, limit)
    .map(([key, n]) => [...key.split("\u0000"), n]);
}

/**
 * 面ごとに、どの欄が画面に出たか（2026-10-26導入）。
 * `seen`（カンマ区切りの欄の一覧）は、離脱した面なら web_vitals か seen、移動した面なら nav に付く
 * （nav の面は移動**元**＝from）。1ページにつき1回だけ付けて送るので、二重には数えない。
 * 返すのは [面, 欄, 画面に出たページ数, その面のページ数]。分母は seen を持つ行だけ
 * （= data-nav の欄があるページ。古い行・欄の無いページは入らない）。
 * 「押されない」が「見られていない」からか「見ても押さない」からかを、navVia と並べて切り分ける。
 */
export function sectionsSeen(rows: EventRow[]): [string, string, number, number][] {
  const views = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (isBotRow(row)) continue;
    const d = row.event_data;
    if (!d || typeof d.seen !== "string") continue;
    let face: unknown;
    if (row.event_name === "nav") face = d.from;
    else if (row.event_name === "web_vitals" || row.event_name === "seen") face = d.face;
    else continue;
    // 面も欄も一覧にあるものだけ（件数に上限が無くても行数は 面×欄 で頭打ちになる）。
    if (typeof face !== "string" || !KNOWN_FACES.has(face)) continue;
    views.set(face, (views.get(face) ?? 0) + 1);
    if (d.seen === "-") continue;
    for (const section of new Set(d.seen.split(","))) {
      if (!KNOWN_SECTIONS.has(section)) continue;
      const key = `${face}\u0000${section}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen.entries()]
    .map(([key, n]): [string, string, number, number] => {
      const [face, section] = key.split("\u0000");
      return [face, section, n, views.get(face) ?? 0];
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || b[2] - a[2] || a[1].localeCompare(b[1]));
}

/** 検索語を JSON に載せる最小の回数。1回だけの語は出さない（個人の入力をそのまま公開しない）。 */
export const SEARCH_MIN_COUNT = 2;

/**
 * 検索欄の利用（2026-10-26導入）。
 * summary はすべての検索（bot を除く）の件数と、何も見つからなかった件数。
 * queries は **SEARCH_MIN_COUNT 回以上**検索された語だけ（[語, 回数, 0件だった回数]・多い順・上位30）。
 * 語は集計の側でも normalizeSearchQuery と同じ形かを確かめ直す（DBには門番を入れる前の行も残りうる）。
 * 「0件」は絞り込み（サービス・声優・お気に入り）を掛けていない検索で、今のクールにも
 * 他のクールにも1件も無かったもの（他のクールの索引が読めていない検索は数えない）。
 */
export function searchUsage(rows: EventRow[]): {
  summary: { searches: number; zeroHit: number };
  queries: [string, number, number][];
} {
  let searches = 0;
  let zeroHit = 0;
  const byQuery = new Map<string, [number, number]>();
  for (const row of rows) {
    if (row.event_name !== "search" || isBotRow(row)) continue;
    const d = row.event_data;
    if (!d || typeof d.q !== "string") continue;
    searches++;
    const miss = d.hits === 0 && d.other === 0 && d.f !== 1;
    if (miss) zeroHit++;
    if (!SEARCH_QUERY_RE.test(d.q) || normalizeSearchQuery(d.q) !== d.q) continue;
    const cur = byQuery.get(d.q) ?? [0, 0];
    cur[0]++;
    if (miss) cur[1]++;
    byQuery.set(d.q, cur);
  }
  const queries = [...byQuery.entries()]
    .filter(([, [n]]) => n >= SEARCH_MIN_COUNT)
    .sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([q, [n, miss]]): [string, number, number] => [q, n, miss]);
  return { summary: { searches, zeroHit }, queries };
}

function rowSpan(rows: EventRow[]): { oldestAt: string | null; newestAt: string | null } {
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const row of rows) {
    const t = Date.parse(row.created_at);
    if (!Number.isFinite(t)) continue;
    if (oldest === null || t < oldest) oldest = t;
    if (newest === null || t > newest) newest = t;
  }
  return {
    oldestAt: oldest === null ? null : new Date(oldest).toISOString(),
    newestAt: newest === null ? null : new Date(newest).toISOString(),
  };
}

/** JST の日付（YYYY-MM-DD）。運用（Issue・コミットの日付）がJSTなので合わせる。 */
function jstDate(t: number): string {
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 日ごと・イベントごとの件数。EVENT_LABELS に無いイベントは出さない（画面と同じ許可制）。
 * **最初と最後の日は途中までの値**（窓の端は日の途中・最後の日は今日）なので `partial` を付ける。
 * GSC の途中の週と同じで、印が無いと完全な日と並べて「減った」と読んでしまう。
 */
export function dailyCounts(
  rows: EventRow[]
): { date: string; partial: boolean; counts: Record<string, number> }[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const row of rows) {
    if (!(row.event_name in EVENT_LABELS)) continue;
    const t = Date.parse(row.created_at);
    if (!Number.isFinite(t)) continue;
    const date = jstDate(t);
    const counts = byDate.get(date) ?? {};
    counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
    byDate.set(date, counts);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts], i, all) => ({ date, partial: i === 0 || i === all.length - 1, counts }));
}

export type AnalyticsSnapshot = {
  windowDays: number;
  /** 何行を集計したか。MAX_ROWS と同じなら**打ち切られている**＝合計を過小に読まないこと。 */
  rowCount: number;
  truncated: boolean;
  /**
   * 実際に集計した行の最古・最新（2026-10-21追加）。窓の端（windowDays日前）より最古が
   * 新しければ、その期間には本当に記録が無い。打ち切りを件数だけでなく**期間で**確かめるための値。
   */
  oldestAt: string | null;
  newestAt: string | null;
  /** 日（JST）ごとのイベント件数（2026-10-21追加）。前日の断面との差から推定しなくて済むように。 */
  daily: { date: string; partial: boolean; counts: Record<string, number> }[];
  events: { event: string; label: string; last7: number; last30: number }[];
  filterService: [string, number][];
  officialClicks: [string, number][];
  affiliateClicks: [string, number][];
  /** 実利用者の表示速度。面ごと・指標ごとの p75 と件数（2026-09-06追加）。 */
  vitals: { face: string; metric: string; p75: number; count: number }[];
  /** 外から来た経路のホスト名の多い順（同上）。AI検索からの流入もここに出る。 */
  referrers: [string, number][];
  /**
   * 以下は 2026-10-21 追加。どれも ua / src / tag / nav を送り始めた日より前の行には無い
   * （＝窓に古い行が残っている間は件数が過小。oldestAt と合わせて読む）。
   *
   * agents … ページビュー（web_vitals）の端末の大まかな種類（bot＝自動アクセス）
   * landings … [流入元, 着地した面, 件数]。流入元は外部ホスト名／direct／internal。bot は除く
   * refTags … `?ref=<媒体>` で来た件数（返信・埋め込みのリンク）。bot は除く
   * navigations … [移動元の面, 移動先の面, 件数]。画面内（クライアント側）の移動だけ。bot は除く。
   *   ページを読み込み直すサイト内の移動は landings の src=internal に入る（移動元の面は持たない）
   *   ので、回遊は**両方を足して**読む。navigations だけだと過小になる
   * referrers も 2026-10-21 から bot を除く（page_view に ua が付いた行のみ。それ以前の行は区別できない）
   */
  agents: [string, number][];
  landings: [string, string, number][];
  refTags: [string, number][];
  navigations: [string, string, number][];
  /**
   * 以下は 2026-10-26 追加（どれも送り始めた日より前の行には無い）。bot は除く。
   *
   * navVia … [移動元の面, 押したリンクがあった欄, 移動先の面, 件数]。欄は data-nav の値。
   *   戻る・進む・欄の外のリンクでは欄が付かないので、navigations の合計より少ない
   * outbound … [面, 外部リンクの種類, 件数]。種類は data-out の値（official＝作品の公式サイト、
   *   source＝出典など）。配信サービスのバッジは official_link_click 側で数えるのでここには入らない
   * sectionsSeen … [面, 欄, 画面に出たページ数, その面のページ数]（sectionsSeen の説明）
   * search … 検索の件数と、SEARCH_MIN_COUNT 回以上検索された語（searchUsage の説明）
   */
  navVia: (string | number)[][];
  outbound: (string | number)[][];
  sectionsSeen: [string, string, number, number][];
  search: { summary: { searches: number; zeroHit: number }; queries: [string, number, number][] };
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
  const humans = rows.filter((row) => !isBotRow(row));
  return {
    windowDays: WINDOW_DAYS,
    rowCount: rows.length,
    truncated: rows.length >= MAX_ROWS,
    ...rowSpan(rows),
    daily: dailyCounts(rows),
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
    referrers: countByDataField(humans, "page_view", "ref"),
    agents: countByDataField(rows, "web_vitals", "ua"),
    landings: countPairs(rows, "web_vitals", "src", "face"),
    refTags: countByDataField(humans, "page_view", "tag"),
    // 面は一覧にある値だけ（2026-10-26。形の合う作り物の面で行を埋められないように）。
    navigations: countTuples(rows, "nav", ["from", "face"], { from: KNOWN_FACES, face: KNOWN_FACES }) as [
      string,
      string,
      number,
    ][],
    navVia: countTuples(rows, "nav", ["from", "via", "face"], { from: KNOWN_FACES, via: KNOWN_SECTIONS, face: KNOWN_FACES }),
    outbound: countTuples(rows, "outbound_click", ["face", "kind"], { face: KNOWN_FACES, kind: KNOWN_OUT_KINDS }),
    sectionsSeen: sectionsSeen(rows),
    search: searchUsage(rows),
  };
}
