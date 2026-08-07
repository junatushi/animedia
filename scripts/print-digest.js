// 投稿本文を標準出力に出すだけのスクリプト。GitHub Actions（daily-digest.yml/season-announce.yml）
// からは環境変数 POST_KIND で呼ばれる。手元で新機能・修正を告知したい時は、以下のように
// コマンドライン引数でも指定できる（env指定と等価。手打ちの手間を減らすためのショートカット）:
//   node scripts/print-digest.js coverage
//   node scripts/print-digest.js feature "独占チップ" "配信サービスをAND条件で絞れるようになりました"
//
// 投稿先ごとの本文（2026-08-06導入）は --platform= で切り替える。既定は x（Xの手動投稿用）。
//   node scripts/print-digest.js --platform=mastodon
//   node scripts/print-digest.js --platform=all     … 全ての投稿先を続けて出す（目視確認用）
// 環境変数 DIGEST_PLATFORM でも同じ指定ができる（ワークフローの dry_run 用）。
const { buildPost, PLATFORMS } = require("./lib/build-digest");

const argv = process.argv.slice(2);
// --platform=... は位置引数と混ざらないよう先に抜き取る。
const platformArg = argv.find((a) => a.startsWith("--platform="));
const rest = argv.filter((a) => !a.startsWith("--platform="));
const platform = platformArg ? platformArg.slice("--platform=".length) : process.env.DIGEST_PLATFORM || "x";

const [argKind, argName, argDesc] = rest;
if (argKind) process.env.POST_KIND = argKind;
if (argName) process.env.FEATURE_NAME = argName;
if (argDesc) process.env.FEATURE_DESC = argDesc;

// 日曜はTOP5＋曜日紹介の2投稿になりうるため、区切り線を挟んで両方出す。
const joinPosts = (posts) => posts.map((p) => p.text).join("\n\n---\n\n");

async function main() {
  if (platform !== "all") {
    const { posts } = await buildPost(new Date(), platform);
    process.stdout.write(joinPosts(posts) + "\n");
    return;
  }
  // --platform=all: 投稿先ごとに本文がどう変わるかを1度に見比べるための出力。
  const chunks = [];
  for (const p of PLATFORMS) {
    const { posts } = await buildPost(new Date(), p);
    chunks.push(`===== ${p} =====\n${joinPosts(posts)}`);
  }
  process.stdout.write(chunks.join("\n\n") + "\n");
}

main().catch((err) => {
  console.error("投稿本文の生成に失敗しました:", err);
  process.exit(1);
});
