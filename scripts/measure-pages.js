// 表示の速さを実測する道具（2026-09-03導入）。
//
// 【なぜ要るか】このリポジトリには「速くしたつもり」を検算する手段が無かった。
// 実際、2026-08-25には「revalidateを900→3600秒に延ばせばISR Writesが減る」と書いて
// 1件も減らず、2026-09-02には「取得データを158KB→36KBに減らせばCPUも減る」と書いて
// 0.85ms（予算の0.3%）しか減らなかった。どちらも**測らずに推測した**のが原因。
// 表示の速さも同じで、「JSを減らした」「HTMLを減らした」は**体感が速くなった証拠に
// ならない**（実測: 初期JSを181KB→117KBにしてもFCPは変わらなかった。効いたのは
// バイト数とリクエスト数のほうだった）。
//
// 【何を測るか】ローカルの本番ビルドに対して、スマホ相当の条件
// （CPU 4倍スロットル・回線1.6Mbps/遅延150ms・iPhone相当のビューポート）で
//   ・FCP / LCP（出るまで）
//   ・TBT相当（ロングタスクの50ms超過分の合計＝操作をブロックする時間）
//   ・最長タスク・DOMノード数
//   ・初期表示のリクエスト数とバイト数
//   ・**下までスクロールしたときに増えるリクエスト数とバイト数**（＝リンクの先読み）
// を出す。最後の1つがこの道具を作った理由で、画面を見ても絶対に気づけない
// （実測: 変更前はスクロールだけで120リクエスト・528KBが飛んでいた。docs/operations.md ㊴）。
//
// 【使い方】ネットワークには出ないが**ブラウザが要る**ので手元（PC）で動かす:
//   npm run build && npx next start -p 3100
//   node scripts/measure-pages.js http://localhost:3100/season/2025/summer [他のURL...]
// Chromiumの場所は PLAYWRIGHT_CHROMIUM_PATH で上書きできる（既定はplaywrightの管理下）。
//
// 【companionテストが無い理由】この道具は何かを禁止・保証するものではなく、数字を
// 出すだけなので「静かに間違った合格を出す」壊れ方が無い（ブラウザが無ければ例外で落ちる）。
// CIにも `npm run check` にも入れない（ブラウザが要るため）。
// 計測の中核は scripts/lib/measure-page.js が持つ（本番計測 measure-production.js と共有）。
const { measure, CPU_THROTTLE, NET_KBPS, NET_LATENCY_MS } = require("./lib/measure-page.js");

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error(
      "使い方: node scripts/measure-pages.js <URL> [URL...]\n" +
        "  先に `npm run build && npx next start -p 3100` を動かしておくこと。"
    );
    process.exitCode = 1;
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error(
      "playwright が見つからない。`npm install` を済ませた環境（PC）で実行すること。"
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `条件: CPU ${CPU_THROTTLE}倍スロットル / 回線 ${NET_KBPS}kbps・遅延${NET_LATENCY_MS}ms / 390×844\n`
  );
  const head = [
    "URL".padEnd(44),
    "FCP".padStart(7),
    "LCP".padStart(7),
    "load".padStart(7),
    "TBT".padStart(7),
    "最長".padStart(7),
    "DOM".padStart(7),
    "初期KB".padStart(8),
    "巡回後KB".padStart(9),
    "先読み".padStart(7),
  ].join("");
  console.log(head);
  for (const url of urls) {
    const r = await measure(chromium, url);
    console.log(
      [
        url.replace(/^https?:\/\/[^/]+/, "").slice(0, 43).padEnd(44),
        `${r.fcp}ms`.padStart(7),
        `${r.lcp}ms`.padStart(7),
        `${r.load}ms`.padStart(7),
        `${r.blockingMs}ms`.padStart(7),
        `${r.maxTaskMs}ms`.padStart(7),
        String(r.domNodes).padStart(7),
        `${r.loadKB}KB`.padStart(8),
        `${r.scrollKB}KB`.padStart(9),
        `${r.scrollPrefetch}件`.padStart(7),
      ].join("")
    );
  }
  console.log(
    "\n※ 数字は1回ぶん。実行ごとに±15%程度ぶれるので、比較するときは3〜5回の中央値で見ること。"
  );
}

main();
