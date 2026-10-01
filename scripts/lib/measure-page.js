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

// **擬似遅延をリクエストの手前で当てる**（2026-09-29修正・重大度高）。
// それまでは遅延も帯域も `Network.emulateNetworkConditions` に渡していたが、
// Chromiumのこの実装は遅延を**応答が始まったあと**に効かせるので、
// `PerformanceNavigationTiming.responseStart`（＝計測しているTTFB）に**一切乗らない**。
// 結果、`latencyMs: 150` と記録しながらTTFBは実測で16〜89ms（10日分の全断面）になり、
// 同じレポートに並ぶRUMのTTFB（実測 p75 で273〜874ms）と**比べられない数字**を
// 「TTFB」という同じ名前で出していた。合成計測が毎日「全面が目標を満たす」と報告する一方
// RUMでは4面中3面が2秒超、という食い違いの一因。
// 局所実験（127.0.0.1・副資源16件のページ・計17リクエスト）での実測:
//   条件なし            ttfb   3ms / fcp  36ms / load   59ms
//   CDPに遅延を渡す     ttfb   8ms / fcp 372ms / load  937ms  ← 遅延はloadには出るがTTFBに出ない
//   リクエスト手前で待つ ttfb 160ms / fcp 356ms / load  781ms  ← TTFBが正直になり、FCP/LCPは同帯
// 帯域はCDP側が正しく効いている（対照とloadが59ms→937ms）ので**そのまま残す**。
// 遅延だけをPlaywrightのrouteに移し、CDPへは `latency: 0` を渡す（二重計上を防ぐ）。
// **両方に遅延を書かないこと**（実測でFCPが356ms→516msに膨らむ＝実体より遅く見える）。
// 記録するJSONには `latencyMode` を残す（古い断面と区別できないと、
// TTFBが30ms→180msに跳ねた日を「悪化」と誤読する）。
const LATENCY_MODE = "perRequest";

// **`htmlDl`（responseEnd − responseStart）を必ず記録する**（2026-09-29追加・重大度高）。
// App Router はストリーミングで返すので、**ヘッダーは先に流れ、本文は後から作られる**。
// そのため「サーバーが本文を作るのに何秒掛かったか」は `responseStart`（＝TTFB）に
// **一切現れない**。局所実験（127.0.0.1・本文を作るのに2,000ms掛かるサーバー）:
//   ストリーミング（殻を先に流す）   ttfb   35ms / htmlDl 2000ms / fcp 124ms
//   非ストリーミング（全部あとで）   ttfb 2005ms / htmlDl    8ms
// つまり**TTFBが平坦でも、その場生成のコストは存在しうる**。
// 実際、同じレポートのRUMは `HTML_DL` の p75 が1,940〜2,353msで、
// 目標を外している3面の遅さの大半がここに入っていた（TTFBは273〜874ms）。
// 合成計測はこの指標を1つも記録しておらず、**RUMが問題だと言っている場所を
// 一度も測っていなかった**。`ttfb` だけ見て「キャッシュから返っている」と
// 結論しないこと（2026-09-29に一度その誤りをやった）。
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
      // 遅延は下の route で当てる（この値を0以外に戻すと二重計上になる）。
      latency: 0,
      downloadThroughput: (NET_KBPS * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    // 往復の遅延を「応答が始まる前」に当てる。文書リクエストも副資源も同じだけ待たせる
    // （実ネットワークでは1往復ぶんを各リクエストが払う）。
    await context.route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, NET_LATENCY_MS));
      try {
        await route.continue();
      } catch {
        // ページが先に遷移・終了したリクエストは続行できない。ここで落とすと
        // 面ごとの計測が丸ごと失敗するので、その1件だけ諦める。
      }
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

    const response = await page.goto(url, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2500);

    // **文書応答の `x-vercel-cache` を記録する**（2026-10-01追加・重大度高）。
    // これが無かったせいで「初回だけ遅い」の原因を3回続けて誤って名指しした
    // （事前生成のせいだと書いて、完全静的なページでも同じだけ遅いことで否定された。
    // 経緯は docs/operations.md の[60]）。
    // Vercelはこのヘッダーで**その応答がキャッシュから出たのか作り直したのか**を返す:
    //   HIT       … キャッシュから配った（その場生成していない）
    //   STALE     … 期限切れを配りつつ裏で作り直した（訪問者は待っていない）
    //   PRERENDER … ビルド時の成果物から配った
    //   MISS      … キャッシュに無く、**その場で作って待たせた**
    //   BYPASS    … キャッシュを通さない（動的）
    // つまり「初回が遅い」の原因が**その場生成かどうか**は、この1つで確実に分かれる。
    // 本番以外（ローカルの next start など）では付かないので null になる＝
    // **0や"miss"に倒さない**（「付いていない」と「MISSだった」を混ぜると誤読する）。
    let cache = null;
    try {
      const h = response ? response.headers() : {};
      const raw = h["x-vercel-cache"] || h["X-Vercel-Cache"] || "";
      cache = raw ? String(raw).toLowerCase() : null;
    } catch {
      // 応答が消えている場合は不明のまま（null）。
    }

    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const long = window.__perf?.long ?? [];
      return {
        ttfb: Math.round(nav.responseStart || 0),
        // 本文を作り終えるまでの時間。ストリーミングなので ttfb には出ない（上の注記）。
        htmlDl: Math.round((nav.responseEnd || 0) - (nav.responseStart || 0)),
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
        cache,
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
      cache,
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

module.exports = { measure, CPU_THROTTLE, NET_KBPS, NET_LATENCY_MS, LATENCY_MODE, SCROLL_STEPS };
