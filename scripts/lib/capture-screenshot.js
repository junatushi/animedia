// SNS投稿に添付するサイト実画面のスクリーンショットを撮る（daily-digest.yml専用）。
// 新規デザインは作らず、指定URL（?view=calendar&day=.. / ?ranking=open で該当画面を
// 直接開ける。components/SeasonExplorer.tsx参照）の指定要素をそのまま撮る。
const { chromium } = require("playwright");

async function captureScreenshot(url, selector) {
  const browser = await chromium.launch();
  try {
    // 曜日によっては放送作品が多く縦に長くなる。clipでの切り出しはビューポート内でしか
    // 撮れないため、余裕を持って高さを確保する（撮る範囲自体は後段のboundingBoxで絞る）。
    const page = await browser.newPage({
      viewport: { width: 720, height: 2400 },
      deviceScaleFactor: 2,
    });
    await page.goto(url, { waitUntil: "networkidle" });
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout: 20000 });
    // locator.screenshot() の「安定待ち」中に再レンダリングが挟まると
    // "Element is not attached to the DOM" になることがあるため、座標を取ってから
    // page.screenshot({clip}) で直接切り出す（要素の再アタッチ待ちに巻き込まれない）。
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(`要素の位置が取得できませんでした（selector: ${selector}）`);
    }
    return await page.screenshot({ type: "png", clip: box });
  } finally {
    await browser.close();
  }
}

module.exports = { captureScreenshot };
