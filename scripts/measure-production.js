#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────
// 本番の表示速度を毎日測って記録する（2026-09-09導入）
//
//   node scripts/measure-production.js
//   BASE=http://localhost:3100 node scripts/measure-production.js   （手元で試す）
//
// 【なぜ要るか】
// このサイトは「表示を2秒未満にする」を目標に掲げているのに、**本番の表示速度を
// 一度も継続して測っていなかった**。使えるはずだったものは全部ふさがっている:
//
//   ・セッション（Claude）の作業環境 … 本番URLへ出られない（プロキシが403）。
//     ローカル本番ビルドは実データ・実画像を描けないので、そこで測れるのは
//     「空に近いページの速さ」だけ（docs/operations.md の㊶）
//   ・PageSpeed Insights … 人が手で開く必要があり、ラボ値のノイズが±300ms級
//   ・CrUX … トラフィックが閾値に届かずデータが無い
//   ・RUM（components/WebVitals.tsx・2026-09-09に本番投入） … 実利用者の真値だが、
//     検索からの流入が**1日5.4クリック**しかないので p75 が意味を持つまで時間が掛かる
//
// つまり「いま速いのか」に答えられる手段が1つも無かった。本番へ到達できるのは
// GitHub Actions なので、GSC・行動ログと同じ形（Actionsが取ってリポジトリに置き、
// セッションはコミット済みのJSONを読む）に載せる。読むのは scripts/speed-report.js。
//
// 【設計の要点】
// ①**対象URLは走査して導出する**（㊳）。`scripts/lib/route-samples.js` が app/ を歩き、
//   実在する名前・IDで動的セグメントを埋める。新しいページ種別を足すと自動で対象に入り、
//   埋められないセグメントは「測っていない」として画面に出続ける。
//   robots.txt が拒否している面（/admin）は除く＝これも app/robots.ts から読む。
// ②**条件は measure-pages.js と同一**（`scripts/lib/measure-page.js` が1箇所で持つ）。
//   手元と本番で条件が違うと、差が条件差なのか実体差なのか分からない。
// ③**1URLにつき3回測って中央値**を採る。1回の値は±15%ぶれるので、
//   1回の数字を時系列に並べるとノイズを改善と読み違える。
// ④**スクロール計測は1回だけ**（8秒/回掛かるため）。測らなかった回は 0 ではなく null。
// ⑤**一時的な失敗は再試行、恒久的な失敗は即座に失敗**（基本ルール）。
//   本番が落ちていれば落ちる＝それは検知したい事象そのもの。
// ⑥**測定そのものが本番に負荷を掛ける**ことを忘れない。12URL×3回＝36リクエスト/日で、
//   ISR Writes（実測1日約12,700）に対しては誤差だが、対象を増やすときは考えること。
// ───────────────────────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");
const { sampleUrls } = require("./lib/route-samples.js");
const { measure, CPU_THROTTLE, NET_KBPS, NET_LATENCY_MS } = require("./lib/measure-page.js");

const REPO = path.join(__dirname, "..");
const BASE = process.env.BASE || "https://animedia-khaki.vercel.app";
const OUT_DIR = path.join(REPO, "content/analytics/speed");
const RUNS = Number(process.env.SPEED_RUNS || 3);
const MAX_ATTEMPTS = 3;

class PermanentError extends Error {}

function jstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一時的な失敗（ネットワークの揺れ・起動直後のタイムアウト）だけ再試行する。
// 404 は「そのURLがもう無い」＝恒久的なので即座に失敗させる（黙って0件にしない）。
async function measureWithRetry(chromium, url, options) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await measure(chromium, url, options);
      // load が0のままなら描画に到達していない＝数字として使えない。
      if (!r.load) throw new Error("loadEventEnd が 0（描画に到達していない）");
      return r;
    } catch (e) {
      lastErr = e;
      if (e instanceof PermanentError) throw e;
      if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright が見つからない。`npm install` を済ませた環境で実行すること。");
    process.exitCode = 1;
    return;
  }

  const { urls, skipped } = sampleUrls();
  console.log(`本番の表示速度: ${BASE}`);
  console.log(`条件: CPU ${CPU_THROTTLE}倍 / 回線 ${NET_KBPS}kbps・遅延${NET_LATENCY_MS}ms / 390×844 / ${RUNS}回の中央値`);
  console.log(`対象: ${urls.length} 面（app/ の走査から導出）`);
  // 測れなかった面を黙って落とさない。**静かに対象から外れる**のがこの種の道具の
  // いちばん危ない壊れ方（毎日緑のまま無力化する）。
  for (const s of skipped) console.log(`  ⚠ 測っていない: ${s}`);
  console.log("");

  const pages = [];
  const failures = [];
  for (const u of urls) {
    const full = BASE.replace(/\/$/, "") + u.path;
    const runs = [];
    try {
      for (let i = 0; i < RUNS; i++) {
        // スクロール（先読みの計測）は最初の1回だけ。8秒/回掛かるため。
        runs.push(await measureWithRetry(chromium, full, { withScroll: i === 0 }));
      }
    } catch (e) {
      // 1面の失敗で残りを巻き添えにしない（基本ルール②）。
      failures.push(`${u.face}: ${e.message}`);
      console.log(`✗ ${u.face.padEnd(11)} 測定できず（${e.message}）`);
      continue;
    }
    const row = {
      face: u.face,
      routePath: u.routePath,
      path: u.path,
      runs: runs.length,
      lcp: median(runs.map((r) => r.lcp)),
      fcp: median(runs.map((r) => r.fcp)),
      ttfb: median(runs.map((r) => r.ttfb)),
      load: median(runs.map((r) => r.load)),
      blockingMs: median(runs.map((r) => r.blockingMs)),
      domNodes: median(runs.map((r) => r.domNodes)),
      loadKB: median(runs.map((r) => r.loadKB)),
      // スクロール系は1回しか測っていないので中央値ではなく、その1回の値。
      scrollKB: runs[0].scrollKB,
      scrollPrefetch: runs[0].scrollPrefetch,
    };
    pages.push(row);
    console.log(
      `  ${row.face.padEnd(11)} LCP ${String(row.lcp).padStart(5)}ms  FCP ${String(row.fcp).padStart(5)}ms  ` +
        `TTFB ${String(row.ttfb).padStart(4)}ms  TBT ${String(row.blockingMs).padStart(5)}ms  ${String(row.loadKB).padStart(4)}KB`
    );
  }

  if (pages.length === 0) {
    // 全滅は「速度0件」ではなく計測の失敗。空のファイルを置くと、
    // 読む側（speed-report.js）が「その日は測れた」と誤読する。
    console.error("全ての面で測定に失敗した。ファイルは書かない。");
    process.exitCode = 1;
    return;
  }

  const result = {
    fetchedAt: new Date().toISOString(),
    base: BASE,
    conditions: { cpuThrottle: CPU_THROTTLE, netKbps: NET_KBPS, latencyMs: NET_LATENCY_MS, runs: RUNS },
    // 測れなかったものを結果に残す（後から「その日は何面だったか」を数えられるように）。
    skipped,
    failures,
    pages,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${jstDate()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`\n書き出し: ${path.relative(REPO, outPath)}`);
  if (failures.length > 0) {
    console.log(`⚠ ${failures.length} 面が測定できていない（合計は過小です）`);
  }
}

main().catch((e) => {
  console.error(e instanceof PermanentError ? `恒久的なエラー: ${e.message}` : `失敗: ${e.message}`);
  process.exit(1);
});
