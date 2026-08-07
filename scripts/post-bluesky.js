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

  // 第2引数＝投稿先。Bluesky向けの本文（時間帯枠に合わせた短い導入・300字上限に収まる
  // 260字）で組み立てる。3SNSが同一本文だった状態の解消（2026-08-06）。
  const { posts } = await buildPost(new Date(), "bluesky");
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier, password });

  // 投稿は1件ずつ独立させる。1本目が落ちても2本目は投げ、最後にまとめて報告する
  // （2026-08-05追加。Threadsで「1本目の失敗＝その日は全滅」の事故が起きたため、
  // 同じ形をしている3スクリプトを揃えた。経緯は docs/operations.md の⑦-8）。
  const failures = [];

  for (const post of posts) {
    try {
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
    } catch (err) {
      failures.push(err);
      console.error(`Blueskyの1件が投稿できませんでした（残りは続行します）: ${err.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Bluesky投稿に失敗しました（${posts.length}件中${failures.length}件）。詳細は上のログを参照。`);
  }
}

main().catch((err) => {
  console.error("Bluesky投稿に失敗しました:", err);
  process.exit(1);
});
