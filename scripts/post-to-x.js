// GitHub Actions の手動実行（workflow_dispatch）から X（旧Twitter）へ投稿するスクリプト。
// 認証情報は GitHub Secrets 経由の環境変数からのみ読み、リポジトリには一切含めない。
// ローカルの `npm run dev` / `npm run build` からは呼ばれない（このアプリの実行には無関係）。
const { TwitterApi } = require("twitter-api-v2");

async function main() {
  const message = process.env.POST_MESSAGE;
  if (!message || !message.trim()) {
    console.error("投稿本文が空です（POST_MESSAGE が未設定）。");
    process.exit(1);
  }

  const required = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`未設定の Secrets があります: ${missing.join(", ")}`);
    console.error("リポジトリの Settings → Secrets and variables → Actions で登録してください。");
    process.exit(1);
  }

  const client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  });

  const res = await client.v2.tweet(message);
  console.log("投稿しました:", `https://x.com/i/web/status/${res.data.id}`);
}

main().catch((err) => {
  console.error("投稿に失敗しました:", err);
  process.exit(1);
});
