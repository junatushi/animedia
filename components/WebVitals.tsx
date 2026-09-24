"use client";

// 実利用者の表示速度（Core Web Vitals）と、外部リファラのホスト名を記録する
// （2026-09-06導入）。
//
// ───────────────────────────────────────────────────────────────
// 【なぜ要るか】
// このサイトは「表示を2秒未満にする」という目標を掲げながら、**実利用者の速度を
// 一度も測っていなかった**。使える計測は次のとおりで、どれも判定に足りない:
//
//   ・PageSpeed Insights のラボ値 … ノイズが±300ms級（**変更していない**作品ページが
//     −234ms動いた実測がある）。50ms級の改善を判定できない
//   ・CrUX … このサイトのデータが無い（トラフィックが閾値に届かない）
//   ・@vercel/analytics … CWVは測っていない（それは別製品の @vercel/speed-insights で、
//     このリポジトリには入っていない）。しかもダッシュボードはセッションから読めない
//   ・ローカル実測 … この環境は実データ・実画像の入った画面を描けない（㊶）
//
// リファラも同じで、`app/api/track/route.ts` も `middleware.ts` も
// **リファラを一度も記録していなかった**。そのため
// `docs/ai-era-strategy-2026-08-13.md` の「AI検索からの流入が月1件以上あるか」という
// 判定条件は、**実際に流入があっても0件のまま期限（2026-11-13）を迎える**状態だった。
//
// 【設計上の約束】
// ①**初期JSを重くしない**のがこのサイトの方針（ログイン用JSを遅延読込にしている）。
//   ここで使う `useReportWebVitals` は Next.js 同梱なので**新しい依存は増えない**。
//   実測の増分は commit メッセージに残す。
// ②**1ページビューにつき送信は最大2件**。指標が確定するたびに送るとページビュー×5件に
//   なり、Supabaseへの往復＝Fluid Provisioned Memory（I/O待ちも課金される・㉝④）を
//   無駄に食う。指標は溜めておき、ページを離れるときに1件だけ送る。
// ③**リファラは「ホスト名」だけ**を送る。生のURLは検索語などを含みうるので保存しない。
//   自サイト内の遷移は送らない（外から来たときだけ）。
// ④面（ページ種別）は**先頭セグメントだけ**をその場で求める。
//   `scripts/lib/gsc-page-type.js` を import してはいけない
//   （`vercel.json` が `scripts/` をデプロイ対象外にしている前提が崩れる。
//   その前提は `node scripts/check.ts` が検査している）。
// ───────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";

// 面（ページ種別）。SEOレポートの「面」と同じ粒度に揃えるが、
// 分類そのものは共有しない（上の④）。知らない接頭辞は "other" に落とす。
const FACES = new Set([
  "anime",
  "season",
  "person",
  "service",
  "studio",
  "director",
  "rankings",
  "exclusive",
  "developers",
]);

function faceOf(pathname: string): string {
  const first = pathname.split("/")[1] ?? "";
  if (first === "") return "home";
  return FACES.has(first) ? first : "other";
}

// 送信は sendBeacon を優先する。ページを離れる瞬間でも届きやすく、
// fetch(keepalive) より取りこぼしが少ない。使えない環境では fetch に落とす。
function send(event: string, data: Record<string, string | number>) {
  const body = JSON.stringify({ event, data });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/track", blob)) return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 計測の失敗は体験に影響させない（既存の lib/logEvent.ts と同じ方針）。
  }
}

// FCP/LCP が遅いときに「どこで遅いか」を切り分ける補助指標（2026-09-24追加）。
// 合成計測は全面 LCP 600ms未満なのに、RUM の p75 は作品・声優・サービス別で
// FCP 2.8〜3.2秒あった。TTFB の p75 は 0.3〜1.0秒なので、差の約2秒は
// 「HTMLが届いてから描くまで」にあるが、端末の違いなのか回線の違いなのかを
// RUM が区別できず、手元のラボでは再現しなかった（同一条件で FCP が 328〜2,324ms とぶれる）。
//   ・HTML_DL … HTML本体の受信にかかった時間（responseEnd − responseStart）。
//     大きければ回線、小さいのに FCP が遅ければ端末側（解析・レイアウト・描画）。
//   ・FCP_touch / LCP_touch と FCP_mouse / LCP_mouse … 同じ値を操作手段で分けて複製する。
//     集計（lib/adminAnalytics.ts の vitalsP75）は数値のキーを指標として面ごとに
//     p75 を取るので、キー名で分ければ集計側を変えずにスマホとPCを分けて見られる。
// どれも既存の FCP/LCP を置き換えない（既存の判定と時系列を途切れさせない）。
// キー数は最大で 6指標＋face＋3＝10（lib/trackEventData.ts の MAX_KEYS は12）。
function diagnostics(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.responseEnd > 0 && nav.responseStart > 0 && nav.responseEnd >= nav.responseStart) {
      out.HTML_DL = Math.round(nav.responseEnd - nav.responseStart);
    }
    const kind = window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
    if (typeof m.FCP === "number") out[`FCP_${kind}`] = m.FCP;
    if (typeof m.LCP === "number") out[`LCP_${kind}`] = m.LCP;
  } catch {
    // 補助指標が取れなくても本体の指標は送る
  }
  return out;
}

export default function WebVitals() {
  // 指標が確定するたびにここへ溜め、離脱時に1件だけ送る。
  const metrics = useRef<Record<string, number>>({});
  const sent = useRef(false);

  useReportWebVitals((metric) => {
    // 値は小数以下が長いので丸める。CLS だけは小さい値なので3桁残す。
    metrics.current[metric.name] =
      metric.name === "CLS" ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value);
  });

  useEffect(() => {
    const face = faceOf(window.location.pathname);

    // ── ① 外部リファラのホスト名（ページを開いた直後に1回だけ）
    // すぐ離脱する人の分も取りたいので、離脱時ではなくここで送る。
    try {
      const ref = document.referrer;
      if (ref) {
        const host = new URL(ref).hostname;
        // 自サイト内の遷移は送らない（外から来た経路だけを知りたい）。
        if (host && host !== window.location.hostname) {
          send("page_view", { ref: host, face });
        }
      }
    } catch {
      // referrer が壊れた値でも計測以外に影響させない
    }

    // ── ② Core Web Vitals（離脱時にまとめて1件）
    const flush = () => {
      if (sent.current) return;
      const m = metrics.current;
      // 1つも確定していないなら送らない（空行を作らない）。
      if (Object.keys(m).length === 0) return;
      sent.current = true;
      send("web_vitals", { ...m, ...diagnostics(m), face });
    };

    // visibilitychange(hidden) が最も確実。pagehide も併せて張る
    // （iOS Safari は visibilitychange を飛ばすことがある）。
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  return null;
}
