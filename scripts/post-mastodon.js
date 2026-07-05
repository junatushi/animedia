// Mastodon（無料・投稿APIに料金がかからない）へ週次ダイジェストを自動投稿する。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
const { buildDigest } = require("./lib/build-digest");

async function main() {
  const instanceUrl = process.env.MASTODON_INSTANCE_URL; // 例: https://mstdn.jp
  const accessToken = process.env.MASTODON_ACCESS_TOKEN;

  if (!instanceUrl || !accessToken) {
    console.log("Mastodon未設定のためスキップします（MASTODON_INSTANCE_URL / MASTODON_ACCESS_TOKEN が未登録）。");
    return;
  }

  const { text } = await buildDigest();
  const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v1/statuses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: text, visibility: "public" }),
  });

  if (!res.ok) {
    throw new Error(`Mastodon投稿に失敗しました（${res.status}）: ${await res.text()}`);
  }
  const json = await res.json();
  console.log("Mastodonに投稿しました:", json.url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
