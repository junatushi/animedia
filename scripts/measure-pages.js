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
const CPU_THROTTLE = 4;
const NET_KBPS = 1600;
const NET_LATENCY_MS = 150;
const SCROLL_STEPS = 24;

async function measure(chromium, url) {
  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    // LCP・ロングタスクはバッファに残らないので、読み込み前に監視を仕掛ける。
    await page.addInitScript(() => {
      window.__perf = { lcp: 0, long: [] };
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__perf.long.push(e.duration);
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // 対応していないブラウザでは指標が0になるだけ。
      }
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: NET_LATENCY_MS,
      downloadThroughput: (NET_KBPS * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });

    const reqs = [];
    page.on("requestfinished", async (r) => {
      let size = 0;
      try {
        const s = await r.sizes();
        size = s.transferSize || s.responseBodySize || 0;
      } catch {
        // 応答が消えている場合はサイズ不明として0で数える。
      }
      const h = r.headers();
      reqs.push({ size, rsc: Boolean(h["rsc"] || h["next-router-prefetch"]) });
    });

    await page.goto(url, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2500);

    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const long = window.__perf?.long ?? [];
      return {
        ttfb: Math.round(nav.responseStart || 0),
        load: Math.round(nav.loadEventEnd || 0),
        fcp: fcp ? Math.round(fcp.startTime) : 0,
        lcp: Math.round(window.__perf?.lcp || 0),
        blockingMs: Math.round(long.reduce((s, d) => s + Math.max(0, d - 50), 0)),
        maxTaskMs: Math.round(long.reduce((mx, d) => Math.max(mx, d), 0)),
        domNodes: document.getElementsByTagName("*").length,
      };
    });

    const atLoad = reqs.length;
    const bytesAtLoad = reqs.reduce((s, r) => s + r.size, 0);

    // 下までスクロールして、押してもいないページのために何が飛ぶかを数える。
    for (let i = 0; i < SCROLL_STEPS; i++) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(220);
    }
    await page.waitForTimeout(2500);
    const scrolled = reqs.slice(atLoad);

    return {
      ...m,
      loadRequests: atLoad,
      loadKB: Math.round(bytesAtLoad / 1024),
      scrollRequests: scrolled.length,
      scrollKB: Math.round(scrolled.reduce((s, r) => s + r.size, 0) / 1024),
      scrollPrefetch: scrolled.filter((r) => r.rsc).length,
    };
  } finally {
    await browser.close();
  }
}

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
