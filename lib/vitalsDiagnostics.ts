// 実利用者の表示速度（web_vitals）に付ける補助指標を組み立てる（2026-09-29にWebVitals.tsxから分離）。
//
// 素の .ts に置いているのは `node scripts/check.ts` から import するため（NodeはJSXを解釈しない）。
// 検査は「この関数が作りうる最大の形」を実際に呼んで作り、それが lib/trackEventData.ts の
// 検証を1キーも落とされずに通ることを確かめる。送るキーを手で数えて検査に書き写すと、
// キーを足した日に上限（MAX_KEYS）で face ごと黙って落ちる（㊳）。
//
// ───────────────────────────────────────────────────────────────
// 【何を切り分けたいか】
// 作品・声優・サービス別の RUM は、FCP の p75 が約2.8〜3.1秒で、その差のほぼ全部が
// HTML_DL（HTML本体の受信時間）の p75 約1.9〜2.4秒に出ている。ところが
// ①これらのページのHTMLは圧縮後12〜15KBしかなく
// ②本番をcurlで取ると、キャッシュ HIT でも MISS でも最初のバイトから完了まで約15msで、
//   サーバーが描き終わるまで引き延ばしている（ストリーミング）わけでもない
// （2026-09-29実測。docs/operations.md の[59]）。
// 残る説明は「利用者の回線が遅い」か「端末側で受信の完了が遅れて記録される」かで、
// 既存の指標ではこの2つを区別できない。
//
//   ・HTML_TX … HTML本体の転送量（バイト。ヘッダー込み）。0ならキャッシュ・先読みから出ている。
//     「12〜15KB」という前提が実利用者でも成り立つかをまず確かめる
//   ・HTML_DL_4g / HTML_DL_slow / HTML_DL_na … HTML_DL を回線の種類で分けて複製する。
//     種類はブラウザ自身の推定（navigator.connection.effectiveType）で、
//     4g 以外（3g・2g・slow-2g）は slow。**API が無い端末は na**（iPhone の Safari は
//     この API を持たないので、na はほぼ iPhone と読める）。
//     4g でも HTML_DL が長ければ回線の帯域ではなく端末側、na だけ長ければ iPhone 固有、と切り分けられる
//   ・RTT … ブラウザが推定した往復遅延（ms）。回線の遅さを帯域とは別の軸で見る
//
// 既存の FCP_touch / LCP_touch と同じく、**キー名で分ければ集計側
// （lib/adminAnalytics.ts の vitalsP75）を変えずに面ごとの p75 が出る**。
// どれも既存の指標を置き換えない（既存の判定と時系列を途切れさせない）。
// ───────────────────────────────────────────────────────────────

/** Next.js（useReportWebVitals）が報告する指標。キー数の上限を検査するための最大の形に使う。 */
export const REPORTED_METRICS = ["CLS", "FCP", "FID", "INP", "LCP", "TTFB"] as const;

/** 補助指標の元になる、ブラウザから読んだ値。読めなかったものは undefined のまま渡す。 */
export type DiagnosticsInput = {
  /** PerformanceNavigationTiming の該当フィールド */
  nav?: { responseStart: number; responseEnd: number; transferSize?: number };
  /** `(pointer: coarse)` に一致したか */
  coarse?: boolean;
  /** navigator.connection（Chrome系だけが持つ） */
  connection?: { effectiveType?: string; rtt?: number };
};

/** 回線の種類。キー名の接尾辞になるので、lib/trackEventData.ts のキー名の形に収まる文字だけにする。 */
export function networkClass(connection: DiagnosticsInput["connection"]): "4g" | "slow" | "na" {
  const t = connection?.effectiveType;
  if (typeof t !== "string" || t === "") return "na";
  return t === "4g" ? "4g" : "slow";
}

export function buildDiagnostics(
  m: Record<string, number>,
  input: DiagnosticsInput
): Record<string, number> {
  const out: Record<string, number> = {};
  const nav = input.nav;
  if (nav && nav.responseEnd > 0 && nav.responseStart > 0 && nav.responseEnd >= nav.responseStart) {
    const dl = Math.round(nav.responseEnd - nav.responseStart);
    out.HTML_DL = dl;
    out[`HTML_DL_${networkClass(input.connection)}`] = dl;
    if (typeof nav.transferSize === "number" && Number.isFinite(nav.transferSize) && nav.transferSize >= 0) {
      out.HTML_TX = Math.round(nav.transferSize);
    }
  }
  const rtt = input.connection?.rtt;
  if (typeof rtt === "number" && Number.isFinite(rtt) && rtt >= 0) out.RTT = Math.round(rtt);
  if (typeof input.coarse === "boolean") {
    const kind = input.coarse ? "touch" : "mouse";
    if (typeof m.FCP === "number") out[`FCP_${kind}`] = m.FCP;
    if (typeof m.LCP === "number") out[`LCP_${kind}`] = m.LCP;
  }
  return out;
}

/**
 * 集計（lib/adminAnalytics.ts の vitalsP75）が指標として数えてよいキー名（2026-10-26）。
 * REPORTED_METRICS と buildDiagnostics が作る名前だけ。補助指標を足したらここも直す
 * （node scripts/check.ts が両方の実際の出力を全部通して確かめる）。
 */
const VITALS_METRIC_RE =
  /^(CLS|FCP|FID|INP|LCP|TTFB)$|^(FCP|LCP)_(touch|mouse)$|^HTML_DL(_(4g|slow|na))?$|^HTML_TX$|^RTT$/;
export function isVitalsMetricKey(key: string): boolean {
  return VITALS_METRIC_RE.test(key);
}

/**
 * 端末の大まかな種類（2026-10-21追加）。**人と自動アクセスを分けるため**に送る。
 *
 * 経緯: 2026-10-02 に、検索からの流入を伴わない自動アクセスが約900件まとまって来て、
 * 実利用者の表示速度（vitals の p75）が見かけ上よくなった（データセンター級の回線で
 * 取られた値が混ざって希釈された）。当時は人と区別する手段が無く、件数と特徴から
 * 推定するしかなかった。
 *
 * **生の User-Agent は送らない**（端末の特定に近づくため。プライバシーポリシーにも
 * 「大まかな種類」と書いてある）。iPadOS は既定で Mac の UA を名乗るので、
 * Macintosh かつタッチ点が2以上なら ios に寄せる。
 */
export type AgentClass = "bot" | "ios" | "android" | "desktop" | "other";

// `(?<!cu)` は Android 端末の CUBOT（例: "CUBOT X30"）を自動アクセスに誤分類しないため
// （2026-10-21の反証レビューで実測）。
const BOT_UA_RE =
  /(?<!cu)bot\b|(?<!cu)bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|inspectiontool|preview|facebookexternalhit|phantomjs|puppeteer|playwright|selenium/i;

export function agentClass(input: { userAgent?: string; webdriver?: boolean; maxTouchPoints?: number }): AgentClass {
  const ua = input.userAgent ?? "";
  if (input.webdriver === true || BOT_UA_RE.test(ua)) return "bot";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/macintosh/i.test(ua) && (input.maxTouchPoints ?? 0) > 1) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/windows|macintosh|x11|cros|linux/i.test(ua)) return "desktop";
  return "other";
}

/**
 * そのページビューがどこから来たか（2026-10-21追加）。外部ならホスト名、
 * リファラが無ければ "direct"、自サイト内のハードな遷移なら "internal"。
 * page_view（外部だけ）と違って**全部の着地に付く**ので、直接流入の数と
 * 「どの流入元がどの面に着地したか」を web_vitals だけで数えられる。
 */
export function landingSource(referrer: string, ownHost: string): string {
  if (!referrer) return "direct";
  try {
    // 末尾ドット付きの完全修飾名（example.com.）は送る形の検査で落ちるので外す。
    const host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return "direct";
    return host === ownHost.toLowerCase() ? "internal" : host;
  } catch {
    return "direct";
  }
}

/** `?ref=<媒体>`（lead-finder の返信・埋め込み `?ref=embed`）を、送ってよい形に揃える。合わなければ null。 */
export function refTag(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("ref");
    if (!v) return null;
    const t = v.toLowerCase();
    return /^[a-z0-9_-]{1,24}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * web_vitals で送る形を組み立てる（2026-10-21）。**face・ua・src を必ず先頭に置く**
 * （lib/trackEventData.ts の MAX_KEYS は先頭から数えるので、末尾に置くと補助指標を
 * 足した日にそこだけ黙って落ちる）。components/WebVitals.tsx と node scripts/check.ts の
 * 両方がこの関数を通すので、キーを足しても検査は手で書き写した形とズレない。
 */
export function vitalsPayload(
  head: { face: string; ua: string; src: string; seen?: string },
  metrics: Record<string, number>,
  diagnostics: Record<string, number>
): Record<string, string | number> {
  // seen（画面に出た欄・2026-10-26）も先頭側に置く。末尾だと上限で落ちたとき欄の集計だけが黙って欠ける。
  return {
    face: head.face,
    ua: head.ua,
    src: head.src,
    ...(head.seen ? { seen: head.seen } : {}),
    ...metrics,
    ...diagnostics,
  };
}

/**
 * いまのブラウザの agentClass（2026-10-26）。WebVitals と検索欄の計測が同じ判定を使うための入口。
 * navigator が無い・読めない環境では "other"。
 */
export function currentAgent(): AgentClass {
  try {
    return agentClass({
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver,
      maxTouchPoints: navigator.maxTouchPoints,
    });
  } catch {
    return "other";
  }
}
