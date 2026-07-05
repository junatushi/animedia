// Bluesky（無料・投稿APIに料金がかからない）へ週次ダイジェストを自動投稿する。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
const { BskyAgent } = require("@atproto/api");
const { buildDigest } = require("./lib/build-digest");

async function main() {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!identifier || !password) {
    console.log("Bluesky未設定のためスキップします（BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD が未登録）。");
    return;
  }

  const { text } = await buildDigest();
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier, password });
  const res = await agent.post({ text, createdAt: new Date().toISOString() });
  console.log("Blueskyに投稿しました:", res.uri);
}

main().catch((err) => {
  console.error("Bluesky投稿に失敗しました:", err);
  process.exit(1);
});
