// Bluesky（無料・投稿APIに料金がかからない）へ自動投稿する。
// 投稿内容は POST_KIND（digest=日次 / season=新シーズン告知）で切り替わる。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
// posts が複数（日曜のTOP5＋曜日紹介）のときは順番に投稿する。screenshot 指定がある投稿は
// サイトの実画面をスクリーンショットして添付する（2026-07-14導入。新規デザインは作らない）。
const { BskyAgent } = require("@atproto/api");
const { buildPost } = require("./lib/build-digest");
const { captureScreenshot } = require("./lib/capture-screenshot");

async function main() {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!identifier || !password) {
    console.log("Bluesky未設定のためスキップします（BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD が未登録）。");
    return;
  }

  const { posts } = await buildPost();
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier, password });

  for (const post of posts) {
    let embed;
    if (post.screenshot) {
      try {
        const png = await captureScreenshot(post.screenshot.url, post.screenshot.selector);
        const uploaded = await agent.uploadBlob(png, { encoding: "image/png" });
        embed = { $type: "app.bsky.embed.images", images: [{ image: uploaded.data.blob, alt: "アニメ視聴ガイドの画面" }] };
      } catch (err) {
        console.error("スクリーンショットの添付に失敗しました（画像なしで投稿を続行します）:", err);
      }
    }
    const res = await agent.post({ text: post.text, createdAt: new Date().toISOString(), ...(embed ? { embed } : {}) });
    console.log("Blueskyに投稿しました:", res.uri);
  }
}

main().catch((err) => {
  console.error("Bluesky投稿に失敗しました:", err);
  process.exit(1);
});
