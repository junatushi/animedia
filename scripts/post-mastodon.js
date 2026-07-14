// Mastodon（無料・投稿APIに料金がかからない）へ自動投稿する。
// 投稿内容は POST_KIND（digest=日次 / season=新シーズン告知）で切り替わる。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
// posts が複数（日曜のTOP5＋曜日紹介）のときは順番に投稿する。screenshot 指定がある投稿は
// サイトの実画面をスクリーンショットして添付する（2026-07-14導入。新規デザインは作らない）。
const { buildPost } = require("./lib/build-digest");
const { captureScreenshot } = require("./lib/capture-screenshot");

async function uploadMedia(instanceUrl, accessToken, png) {
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "screenshot.png");
  const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v2/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`メディアアップロードに失敗しました（${res.status}）: ${await res.text()}`);
  }
  const json = await res.json();
  return json.id;
}

async function main() {
  const instanceUrl = process.env.MASTODON_INSTANCE_URL; // 例: https://mstdn.jp
  const accessToken = process.env.MASTODON_ACCESS_TOKEN;

  if (!instanceUrl || !accessToken) {
    console.log("Mastodon未設定のためスキップします（MASTODON_INSTANCE_URL / MASTODON_ACCESS_TOKEN が未登録）。");
    return;
  }

  const { posts } = await buildPost();

  for (const post of posts) {
    let mediaIds;
    if (post.screenshot) {
      try {
        const png = await captureScreenshot(post.screenshot.url, post.screenshot.selector);
        const mediaId = await uploadMedia(instanceUrl, accessToken, png);
        mediaIds = [mediaId];
      } catch (err) {
        console.error("スクリーンショットの添付に失敗しました（画像なしで投稿を続行します）:", err);
      }
    }

    const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v1/statuses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: post.text, visibility: "public", ...(mediaIds ? { media_ids: mediaIds } : {}) }),
    });

    if (!res.ok) {
      throw new Error(`Mastodon投稿に失敗しました（${res.status}）: ${await res.text()}`);
    }
    const json = await res.json();
    console.log("Mastodonに投稿しました:", json.url);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
