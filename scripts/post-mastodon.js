// Mastodon（無料・投稿APIに料金がかからない）へ自動投稿する。
// 投稿内容は POST_KIND（digest=日次 / season=新シーズン告知）で切り替わる。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
// posts が複数（日曜のTOP5＋曜日紹介）のときは順番に投稿する。screenshot 指定がある投稿は
// サイトの実画面をスクリーンショットして添付する（2026-07-14導入。新規デザインは作らない）。
const { buildPost } = require("./lib/build-digest");
const { captureScreenshot } = require("./lib/capture-screenshot");

// media_id が処理完了する（GET /api/v1/media/:id が200を返す）まで待つ。Mastodonは
// 画像のサムネイル/blurhash生成を非同期で行い、処理中は206を返す。処理中のIDをそのまま
// statusesに渡すと画像が無言で添付されないことがある（実際にMastodonだけ添付が
// 効かなかった不具合の原因。2026-07-15確認）。
async function waitForMediaReady(instanceUrl, accessToken, mediaId, timeoutMs = 20000) {
  const base = instanceUrl.replace(/\/$/, "");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/v1/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 200) return;
    if (res.status !== 206) {
      throw new Error(`メディア処理状況の確認に失敗しました（${res.status}）: ${await res.text()}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("メディアの処理が時間内に完了しませんでした");
}

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
  // 202はまだ処理中（同期完了なら200）。どちらのケースも、statusesに使う前に
  // 処理完了を待つ（既に完了済みなら即座に200が返るのでコストは小さい）。
  await waitForMediaReady(instanceUrl, accessToken, json.id);
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
