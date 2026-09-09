// 1ページの表示速度を実測する中核（2026-09-09に scripts/measure-pages.js から切り出し）。
//
// 手元の本番ビルドを測る measure-pages.js と、本番URLを毎日測る measure-production.js が
// **同じ条件・同じ指標**で測るために共有する。片方だけ条件を変えると、
// 「手元では速いのに本番では遅い」の原因が条件差なのか実体差なのか分からなくなる。
//
// 【scroll について】下までスクロールして「押してもいないページのために何が飛ぶか」を
// 数えるのがこの道具を作った理由（㊴。実測で120リクエスト・528KB）。ただし1回あたり
// 8秒ほど掛かるので、毎日の本番計測では代表1回だけに絞れるよう options で切れる。
const CPU_THROTTLE = 4;
const NET_KBPS = 1600;
const NET_LATENCY_MS = 150;
const SCROLL_STEPS = 24;

async function measure(chromium, url, options = {}) {
  const withScroll = options.withScroll !== false;
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
    // withScroll:false のときは測らない（値は null。**0 にしない**＝「測っていない」と
    // 「飛んでいない」を取り違えると、先読みの逆戻りを見逃す）。
    if (!withScroll) {
      return {
        ...m,
        loadRequests: atLoad,
        loadKB: Math.round(bytesAtLoad / 1024),
        scrollRequests: null,
        scrollKB: null,
        scrollPrefetch: null,
      };
    }
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

module.exports = { measure, CPU_THROTTLE, NET_KBPS, NET_LATENCY_MS, SCROLL_STEPS };
