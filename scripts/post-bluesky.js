// Bluesky（無料・投稿APIに料金がかからない）へ自動投稿する。
// 投稿内容は POST_KIND（digest=日次 / season=新シーズン告知）で切り替わる。
// Secrets未設定の間は「まだ設定されていない」ログを出してスキップする（失敗扱いにしない）。
const { BskyAgent } = require("@atproto/api");
const { buildPost } = require("./lib/build-digest");

async function main() {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!identifier || !password) {
    console.log("Bluesky未設定のためスキップします（BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD が未登録）。");
    return;
  }

  const { text } = await buildPost();
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier, password });
  const res = await agent.post({ text, createdAt: new Date().toISOString() });
  console.log("Blueskyに投稿しました:", res.uri);
}

main().catch((err) => {
  console.error("Bluesky投稿に失敗しました:", err);
  process.exit(1);
});
