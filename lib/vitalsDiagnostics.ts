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
// （2026-09-29実測。docs/operations.md の[58]）。
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
